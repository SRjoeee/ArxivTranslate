// 会话与链的绑定（Codex 在 #59 指出的两条 P1）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionRouter } from '@/entrypoints/background/sessions'
import type { TranslationTransport } from '@/providers/transport'

/** 只记帐的假 transport：认得出是哪一条，并记下被撤过哪些 scope */
function fakeTransport(name: string, cancelled: string[] = []): TranslationTransport & { name: string; cancelled: string[] } {
  return {
    name,
    cancelled,
    translate: async () => ({ ok: true, result: { segments: [], provider: name }, cached: 0 }),
    cancel: async (scope, options) => { cancelled.push(`${name}:${scope}${options?.remember === false ? ':soft' : ''}`); return 1 },
    status: async () => ({ providerId: name, available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags' as const, targetLanguage: 'cmn', promptId: 'default', chain: [name], demotions: [], engine: { id: name, displayName: name } }),
  } as TranslationTransport & { name: string; cancelled: string[] }
}

const nameOf = (t: TranslationTransport) => (t as unknown as { name: string }).name

afterEach(() => vi.useRealTimers())

describe('createSessionRouter', () => {
  it('同文档换 hash 不算跳走：到点问页面，它说还在就不撤', async () => {
    // `tabs.onUpdated` 的 loading 分不出「换了个 hash」和「跳到别的网址」——实测两种情况 changeInfo
    // 都只有 {status:'loading'}。当场撤会把一个还活着的页面判死：用户点正文里的引用跳到参考文献，
    // 那一整块的译文全部 aborted（2026-09-09 实测 86 块全失败）
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const router = createSessionRouter(async () => transport, { stillThere: async () => 'same' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    // 跳到新位置之后，视口观察器立刻为新露出来的块发请求——但这**不**取消撤销：
    // 真跳走时旧文档也能再发一两条（Codex 在 #143 指出）。判据是到点问页面自己
    await router.forCall('session-1', 7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual([])
    expect(router.bound()).toEqual(['session-1'])
  })

  it('页面自己说还在：宽限到点也不撤，哪怕这段时间一个请求都没有', async () => {
    // 跳到一个已经翻好的位置就不会有新请求，靠「有没有请求」判断不出来。页面自己分得清：
    // 它还在就还答得出同一个会话 id（Codex 在 #143 指出）
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const asked: [number, string][] = []
    const router = createSessionRouter(async () => transport, {
      stillThere: async (tabId, scope) => { asked.push([tabId, scope]); return 'same' },
    })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(asked).toEqual([[7, 'session-1']])
    expect(transport.cancelled).toEqual([])
    expect(router.bound()).toEqual(['session-1'])
  })

  it('旧文档在跳走途中又发了一条请求：撤销照常进行', async () => {
    // 真跳走时旧文档往往还能再发一两条消息，那只证明新文档还没接管。要是让它取消掉按住的撤销，
    // 新文档一提交 content script 就没了、也没人再武装一次，旧会话的队列会一直跑（Codex 在 #143 指出）
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const router = createSessionRouter(async () => transport, { stillThere: async () => 'other' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await router.forCall('session-1', 7) // 旧文档最后一条
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['链:session-1'])
  })

  it('旧文档在提交前答了「还在」：complete 时再问一次，这次答的是新会话就撤掉', async () => {
    // 跨文档导航提交得慢时，loading 之后旧文档还活着、还答得出同一个会话 id，撤销就被放掉了；
    // 而它随后就没了，再没人问第二次（Codex 在 #143 指出）。background 在 complete 时再按一次
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    let answer: 'same' | 'other' | 'unknown' = 'same'
    const router = createSessionRouter(async () => transport, { stillThere: async () => answer })
    await router.forCall('session-1', 7)

    // loading：旧文档还在，答「还在」——不撤
    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.cancelled).toEqual([])

    // complete：新文档已经就位，答的是别的会话——撤，而且是确定的终结
    answer = 'other'
    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.cancelled).toEqual(['链:session-1'])
  })

  it('标签页还在加载时不采信「还在」，等它落定再问', async () => {
    // 跨文档导航提交得慢时，正在离开的旧文档也答得出同一个会话。只等 `complete` 不行——
    // 目的地的 load 卡住时那个事件根本不会来（Codex 在 #143 指出）。判据换成「标签页还在加载吗」
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    let loading = true
    let answer: 'same' | 'other' | 'unknown' = 'same'
    const asked: string[] = []
    const router = createSessionRouter(async () => transport, {
      stillThere: async () => { asked.push(answer); return answer },
      stillLoading: async () => loading,
    })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(4000)
    expect(transport.cancelled).toEqual([]) // 还在加载，不下结论
    expect(asked).toHaveLength(1)

    // 导航终于提交了：新文档答的是别的会话
    loading = false
    answer = 'other'
    await vi.advanceTimersByTimeAsync(4000)
    expect(transport.cancelled).toEqual(['链:session-1'])
  })

  it('一直卡在加载中也不会无限问下去', async () => {
    // 有上限，否则一个永远加载不完的标签页会把它变成一个不停的轮询
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const asked: number[] = []
    const router = createSessionRouter(async () => transport, {
      stillThere: async () => { asked.push(Date.now()); return 'same' },
      stillLoading: async () => true,
    })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(asked.length).toBeLessThanOrEqual(4)
    // 问到上限之后按页面说的算：它一直说「还在」，就不撤
    expect(transport.cancelled).toEqual([])
  })

  it('页面答不上来：排空，但不判死', async () => {
    // 消息没送到可能是真没了，也可能是新文档的 content script 还没装上——分不清就不能判死，
    // 判错了那个还活着的页面后半篇会永久 aborted（Codex 在 #143 指出两种情况要分开）
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const router = createSessionRouter(async () => transport, { stillThere: async () => 'unknown' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['链:session-1:soft'])
  })

  it('页面答上来了但换了会话：确定走了，判死', async () => {
    // 这时不是猜：页面自己说它已经不是刚才那个会话了。判死才拦得住那些挂在 helper 握手上、
    // 还没进任何队列、醒来会照发不误的请求（Codex 在 #143 指出）
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const router = createSessionRouter(async () => transport, { stillThere: async () => 'other' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['链:session-1'])
  })

  it('猜出来的终结在 OCR 那条队列上同样不判死', async () => {
    // 撤会话时图片 OCR 的排队一起撤（onDrop）。但那条队列自己也记「撤过的 scope」，
    // 猜错时页面还活着，它后面滚到的每一张图都会直接 aborted（Codex 在 #143 指出）
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const soft: boolean[] = []
    const router = createSessionRouter(async () => transport, { onDrop: (_scope, options) => { soft.push(options.remember); return 0 } })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(soft).toEqual([false])

    // 确定的终结照旧判死
    await router.forCall('session-2', 8)
    await router.dropTab(8)
    expect(soft).toEqual([false, true])
  })

  it('猜错之后回来的会话仍走它开始时的那条链', async () => {
    // 猜出来的终结要是把绑定也删了，回来的请求就成了「新会话」，会被挂到**当前**那条链上——
    // 期间用户改过引擎 / 提示词 / 目标语言的话，同一轮译文中途换链（Codex 在 #143 指出）
    vi.useFakeTimers()
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = createSessionRouter(async () => current)
    expect(nameOf(await router.forCall('session-1', 7))).toBe('旧链')

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    // 撤销期间用户在设置页换了引擎
    current = second

    expect(nameOf(await router.forCall('session-1', 7))).toBe('旧链')
  })

  it('真的跳走：宽限到点撤掉，但不把 scope 判死', async () => {
    // 判死是给「确定的终结」用的（用户按停止、关标签页）。猜出来的不能判死：猜错时页面还活着，
    // 它后半篇的每一次请求都会被直接 aborted，而且永远好不了
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const router = createSessionRouter(async () => transport)
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['链:session-1:soft'])
    // 猜错了也能回来：同一个 scope 再来请求，不会再被撤一次
    transport.cancelled.length = 0
    await router.forCall('session-1', 7)
    expect(transport.cancelled).toEqual([])
  })

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

  it('drop：onDrop 先于建链；只经 bind 绑过的会话不为撤它建链（建链可能挂在引擎探测上，Codex 在 #87 指出）', async () => {
    const transport = fakeTransport('链')
    const order: string[] = []
    const router = createSessionRouter(async () => { order.push('current'); return transport }, { onDrop: scope => { order.push(`onDrop:${scope}`); return 1 } })
    router.bind('ocr-only', 3)
    expect(await router.dropTab(3)).toBe(1)
    expect(order).toEqual(['onDrop:ocr-only']) // 没有 current
    // 翻过字的会话：onDrop 仍在前，transport.cancel 在后
    await router.forCall('s1', 4)
    order.length = 0
    await router.dropTab(4)
    expect(order[0]).toBe('onDrop:s1')
    expect(transport.cancelled).toContain('链:s1')
  })

  it('bind → forCall 建链期间被撤：forCall 回来不复活会话，补撤这条链上的 scope；撤过的 scope 再 bind / forCall 都当已撤（Codex 在 #87 指出）', async () => {
    const transport = fakeTransport('链')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const router = createSessionRouter(async () => { await held; return transport }, { onDrop: () => 1 })
    router.bind('s1', 5)
    const pending = router.forCall('s1', 5) // 正在 await current()
    await Promise.resolve()
    expect(await router.dropTab(5)).toBe(1) // 只有 onDrop：这时没链可撤
    release()
    await pending
    expect(router.bound()).toEqual([]) // 没复活
    expect(transport.cancelled).toEqual(['链:s1']) // forCall 回来补撤
    // 之后再来：bind 无效、forCall 给链但先撤
    router.bind('s1', 5)
    expect(router.bound()).toEqual([])
    await router.forCall('s1', 5)
    expect(router.bound()).toEqual([])
    expect(transport.cancelled).toEqual(['链:s1', '链:s1'])
  })
})
