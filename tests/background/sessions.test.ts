// 会话与链的绑定（Codex 在 #59 指出的两条 P1）
import { describe, expect, it } from 'vitest'
import { createSessionRouter } from '@/entrypoints/background/sessions'
import type { TranslationTransport } from '@/providers/transport'

/** 只记帐的假 transport：认得出是哪一条，并记下被撤过哪些 scope */
function fakeTransport(name: string, cancelled: string[] = []): TranslationTransport & { name: string; cancelled: string[] } {
  return {
    name,
    cancelled,
    translate: async () => ({ ok: true, result: { segments: [], provider: name }, cached: 0 }),
    cancel: async scope => { cancelled.push(`${name}:${scope}`); return 1 },
    status: async () => ({ providerId: name, available: true, maxBatchChars: 1, maxBatchItems: 1, preservesMarkup: true, chain: [name], engine: { id: name, displayName: name } }),
  } as TranslationTransport & { name: string; cancelled: string[] }
}

const nameOf = (t: TranslationTransport) => (t as unknown as { name: string }).name

describe('createSessionRouter', () => {
  it('一次会话认准开始时的那条链：配置中途变更不换引擎，之后开始的会话才用新链', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = createSessionRouter(async () => current)

    expect(nameOf(await router.forCall('session-1', 1))).toBe('旧链')
    // 用户在 popup 里换了提示词 / 目标语言，background 重建了链
    current = second
    // 进行中的会话继续走旧链——否则同一轮译文会中途换提示词或换语言
    expect(nameOf(await router.forCall('session-1', 1))).toBe('旧链')
    // 另一个标签页新开的会话拿到新链
    expect(nameOf(await router.forCall('session-2', 2))).toBe('新链')
  })

  it('不带 scope 的调用（设置页连接测试）永远用当前那条链，也不记账', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = createSessionRouter(async () => current)
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('旧链')
    current = second
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('新链')
    expect(router.bound()).toEqual([])
  })

  it('撤掉 scope 时用它绑定的那条链，不是当前那条：否则撤的是新队列，旧队列继续发请求', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = createSessionRouter(async () => current)
    await router.forCall('session-1', 1)
    current = second
    expect(await router.drop(['session-1'])).toBe(1)
    expect(first.cancelled).toEqual(['旧链:session-1'])
    expect(second.cancelled).toEqual([])
    expect(router.bound()).toEqual([])
  })

  it('没绑过的 scope 也照撤：worker 中途重启过，绑定丢了但队列里可能还有它的任务', async () => {
    const only = fakeTransport('链')
    const router = createSessionRouter(async () => only)
    expect(await router.drop(['幽灵会话'])).toBe(1)
    expect(only.cancelled).toEqual(['链:幽灵会话'])
  })

  it('标签页关闭：撤掉挂在它上面的会话，别的标签页不受影响', async () => {
    const t = fakeTransport('链')
    const router = createSessionRouter(async () => t)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    expect(await router.dropTab(1)).toBe(1)
    expect(t.cancelled).toEqual(['链:session-1'])
    expect(router.bound()).toEqual(['session-2'])
    // 没有会话的标签页关掉是无操作
    expect(await router.dropTab(99)).toBe(0)
  })

  it('同一标签页出现新 scope：上一轮没走 endRun（导航 / 刷新），把它撤掉', async () => {
    const t = fakeTransport('链')
    const router = createSessionRouter(async () => t)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 1)
    expect(t.cancelled).toEqual(['链:session-1'])
    expect(router.bound()).toEqual(['session-2'])
  })

  it('rebindAll 把进行中的会话迁到新链：只给用户显式动作用（下载完语言包）', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = createSessionRouter(async () => current)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    current = second
    // 不迁的话，popup 承诺的「接下来的段落会用离线引擎」落空
    router.rebindAll(second)
    expect(nameOf(await router.forCall('session-1', 1))).toBe('新链')
    expect(nameOf(await router.forCall('session-2', 2))).toBe('新链')
    // 绑定关系（含 tabId）保留：迁完之后关标签页照样撤得掉
    expect(await router.dropTab(1)).toBe(1)
    expect(second.cancelled).toEqual(['新链:session-1'])
  })

  it('不同标签页的同名 scope 互不影响（会话 id 本来就唯一，这条是护栏）', async () => {
    const t = fakeTransport('链')
    const router = createSessionRouter(async () => t)
    await router.forCall('s', 1)
    await router.forCall('s', 1)
    expect(router.bound()).toEqual(['s'])
    expect(t.cancelled).toEqual([])
  })

  it('onDrop：撤 scope 时连带撤掉别的按 scope 排队的东西（图片 OCR，§15.2），条数计入返回值', async () => {
    const transport = fakeTransport('链')
    const dropped: string[] = []
    const router = createSessionRouter(async () => transport, { onDrop: scope => { dropped.push(scope); return 2 } })
    await router.forCall('s1', 1)
    await router.forCall('s2', 2)
    expect(await router.drop(['s1'])).toBe(3) // transport 撤 1 + onDrop 撤 2
    expect(await router.dropTab(2)).toBe(3)
    expect(dropped).toEqual(['s1', 's2'])
  })

  it('bind：只记 tab 关联、同步返回、不建链；之后 dropTab 撤得到，forCall 再填链并保留 tab', async () => {
    const transport = fakeTransport('链')
    let built = 0
    const dropped: string[] = []
    const router = createSessionRouter(async () => { built++; return transport }, { onDrop: scope => { dropped.push(scope); return 1 } })
    router.bind('s1', 7)
    expect(built).toBe(0)
    expect(router.bound()).toEqual(['s1'])
    expect(nameOf(await router.forCall('s1', 7))).toBe('链')
    expect(built).toBe(1)
    expect(await router.dropTab(7)).toBe(2) // transport 撤 1 + onDrop 撤 1
    expect(dropped).toEqual(['s1'])
    expect(router.bound()).toEqual([])
    // 同一标签页出现新 scope：bind 也撤旧的
    router.bind('s2', 8)
    router.bind('s3', 8)
    await Promise.resolve()
    expect(router.bound()).toEqual(['s3'])
  })
})
