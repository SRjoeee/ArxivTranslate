// 会话与链的绑定（Codex 在 #59 指出的两条 P1）
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSessionRouter, type SessionRouterDeps } from '@/entrypoints/background/sessions'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import type { TranslationTransport } from '@/providers/transport'

/** A transport that only keeps books: which chain it is, which scopes it was asked to drain, whether it was retired */
function fakeTransport(name: string, cancelled: string[] = []): TranslationTransport & { name: string; cancelled: string[] } {
  let retired = false
  return {
    name,
    cancelled,
    translate: async () => ({ ok: true, result: { segments: [], provider: name }, cached: 0 }),
    cancel: async scope => { cancelled.push(`${name}:${scope}`); return 1 },
    retire: () => { retired = true; cancelled.push(`${name} retired`) },
    isRetired: () => retired,
    status: async () => ({ providerId: name, available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags' as const, targetLanguage: 'cmn', promptId: 'default', chain: [name], demotions: [], revision: 1, engine: { id: name, displayName: name } }),
  } as TranslationTransport & { name: string; cancelled: string[] }
}

const nameOf = (t: TranslationTransport) => (t as unknown as { name: string }).name

/** A router over a registry of its own; tests that read the registry pass theirs */
const routerOver = (current: SessionRouterDeps['current'], rest: Partial<Omit<SessionRouterDeps, 'current'>> = {}) =>
  createSessionRouter({ current, cancelled: new CancelledScopeRegistry(), ...rest })

afterEach(() => vi.useRealTimers())

describe('createSessionRouter', () => {
  it('同文档换 hash 不算跳走：到点问页面，它说还在就不撤', async () => {
    // `tabs.onUpdated` 的 loading 分不出「换了个 hash」和「跳到别的网址」——实测两种情况 changeInfo
    // 都只有 {status:'loading'}。当场撤会把一个还活着的页面判死：用户点正文里的引用跳到参考文献，
    // 那一整块的译文全部 aborted（2026-09-09 实测 86 块全失败）
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const router = routerOver(async () => transport, { stillThere: async () => 'same' })
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
    const router = routerOver(async () => transport, {
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
    const router = routerOver(async () => transport, { stillThere: async () => 'other' })
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
    const router = routerOver(async () => transport, { stillThere: async () => answer })
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
    const router = routerOver(async () => transport, {
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
    const router = routerOver(async () => transport, {
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

  it('the page does not answer: drained, but not marked', async () => {
    // An undelivered message may mean the page is gone, or that the new document's content script is not installed
    // yet — undecidable, so the scope must not be marked: marked wrongly, the living page's second half is aborted
    // for good (Codex on #143: the two cases must be kept apart)
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => transport, { cancelled: registry, stillThere: async () => 'unknown' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['链:session-1'])
    expect(registry.has('session-1')).toBe(false)
  })

  it('the page answers with another session: gone for certain, marked', async () => {
    // No guess here: the page itself says it is no longer that session. Only the mark stops the requests still
    // hanging on the helper handshake, in no queue yet, that would otherwise go out when they wake (Codex on #143)
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => transport, { cancelled: registry, stillThere: async () => 'other' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['链:session-1'])
    expect(registry.has('session-1')).toBe(true)
  })

  it('a guessed end drains the OCR queue too and marks nothing; a certain end marks', async () => {
    // Image OCR queues by scope as well and is drained with the session (onDrop). It used to keep its own record of
    // cancelled scopes, so a wrong guess left every image the living page scrolled to aborted (Codex on #143); now
    // it reads the one registry, and only the router writes it
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const registry = new CancelledScopeRegistry()
    const drained: string[] = []
    const router = routerOver(async () => transport, { cancelled: registry, onDrop: scope => { drained.push(scope); return 0 } })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(drained).toEqual(['session-1'])
    expect(registry.has('session-1')).toBe(false)

    // A certain end: drained and marked
    await router.forCall('session-2', 8)
    await router.dropTab(8)
    expect(drained).toEqual(['session-1', 'session-2'])
    expect(registry.has('session-2')).toBe(true)
  })

  it('猜错之后回来的会话仍走它开始时的那条链', async () => {
    // 猜出来的终结要是把绑定也删了，回来的请求就成了「新会话」，会被挂到**当前**那条链上——
    // 期间用户改过引擎 / 提示词 / 目标语言的话，同一轮译文中途换链（Codex 在 #143 指出）
    vi.useFakeTimers()
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = routerOver(async () => current)
    expect(nameOf(await router.forCall('session-1', 7))).toBe('旧链')

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    // 撤销期间用户在设置页换了引擎
    current = second

    expect(nameOf(await router.forCall('session-1', 7))).toBe('旧链')
  })

  it('a navigation without a probe: drained when the grace period ends, the scope not marked', async () => {
    // Marking is for certain ends (the reader stopped, the tab closed). A guessed end cannot mark: if the guess is
    // wrong the page is alive, and every request of its second half would be aborted, for good
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => transport, { cancelled: registry })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['链:session-1'])
    expect(registry.has('session-1')).toBe(false)
    // A wrong guess recovers: the same scope's next request is not drained again
    transport.cancelled.length = 0
    await router.forCall('session-1', 7)
    expect(transport.cancelled).toEqual([])
  })

  it('一次会话认准开始时的那条链：配置中途变更不换引擎，之后开始的会话才用新链', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = routerOver(async () => current)

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
    const router = routerOver(async () => current)
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('旧链')
    current = second
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('新链')
    expect(router.bound()).toEqual([])
  })

  it('撤掉 scope 时用它绑定的那条链，不是当前那条：否则撤的是新队列，旧队列继续发请求', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = routerOver(async () => current)
    await router.forCall('session-1', 1)
    current = second
    expect(await router.drop(['session-1'])).toBe(1)
    expect(first.cancelled).toEqual(['旧链:session-1'])
    expect(second.cancelled).toEqual([])
    expect(router.bound()).toEqual([])
  })

  it('没绑过的 scope 也照撤：worker 中途重启过，绑定丢了但队列里可能还有它的任务', async () => {
    const only = fakeTransport('链')
    const router = routerOver(async () => only)
    expect(await router.drop(['幽灵会话'])).toBe(1)
    expect(only.cancelled).toEqual(['链:幽灵会话'])
  })

  it('标签页关闭：撤掉挂在它上面的会话，别的标签页不受影响', async () => {
    const t = fakeTransport('链')
    const router = routerOver(async () => t)
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
    const router = routerOver(async () => t)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 1)
    expect(t.cancelled).toEqual(['链:session-1'])
    expect(router.bound()).toEqual(['session-2'])
  })

  it('rebind moves one session onto the chain in force and keeps its tab: a language pack downloaded for that tab', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const router = routerOver(async () => current)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    current = second
    // Without the move, the popup's promise "the next paragraphs use the offline engine" would not hold
    await router.rebind('session-1')
    expect(nameOf(await router.forCall('session-1', 1))).toBe('新链')
    expect(nameOf(await router.forCall('session-2', 2))).toBe('旧链')
    // The binding, tab included, survives: closing the tab still drains it
    expect(await router.dropTab(1)).toBe(1)
    expect(second.cancelled).toEqual(['新链:session-1'])
  })

  it('dropAndRebindAll drains the old chain before moving: a deleted service must not go on spending its key', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let current = first
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => current, { cancelled: registry, retireOthers: () => { for (const chain of [first, second]) if (chain !== current) chain.retire?.() } })
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    current = second
    // Re-pointing alone leaves the queued and in-flight requests running on the old chain, with the deleted service's key (Codex on #157)
    await router.dropAndRebindAll()
    expect(first.cancelled).toEqual(['旧链 retired', '旧链:session-1', '旧链:session-2'])
    expect(nameOf(await router.forCall('session-1', 1))).toBe('新链')
    // Not marked: the sessions live on, on the new chain — only the old chain's work is gone
    expect(registry.has('session-1')).toBe(false)
    expect(registry.has('session-2')).toBe(false)
    expect(router.bound()).toEqual(['session-1', 'session-2'])
  })

  it('transportFor 只读地取出会话自己那条链，不会顺手绑一个新的', async () => {
    const t = fakeTransport('链')
    const router = routerOver(async () => t)
    await router.forCall('session-1', 1)
    expect(nameOf(router.transportFor('session-1')!)).toBe('链')
    expect(router.sessionsOn(t)).toBe(1)
    expect(router.transportFor('从没有过的')).toBeUndefined()
    expect(router.bound()).toEqual(['session-1'])
  })

  it('不同标签页的同名 scope 互不影响（会话 id 本来就唯一，这条是护栏）', async () => {
    const t = fakeTransport('链')
    const router = routerOver(async () => t)
    await router.forCall('s', 1)
    await router.forCall('s', 1)
    expect(router.bound()).toEqual(['s'])
    expect(t.cancelled).toEqual([])
  })

  it('onDrop：撤 scope 时连带撤掉别的按 scope 排队的东西（图片 OCR，§15.2），条数计入返回值', async () => {
    const transport = fakeTransport('链')
    const dropped: string[] = []
    const router = routerOver(async () => transport, { onDrop: scope => { dropped.push(scope); return 2 } })
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
    const router = routerOver(async () => { built++; return transport }, { onDrop: scope => { dropped.push(scope); return 1 } })
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
    const router = routerOver(async () => { order.push('current'); return transport }, { onDrop: scope => { order.push(`onDrop:${scope}`); return 1 } })
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
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => { await held; return transport }, { cancelled: registry, onDrop: () => 1 })
    router.bind('s1', 5)
    const pending = router.forCall('s1', 5) // 正在 await current()
    await Promise.resolve()
    expect(await router.dropTab(5)).toBe(1) // 只有 onDrop：这时没链可撤
    expect(registry.has('s1')).toBe(true) // marked at once, while the chain is still being built
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

  it('a certain drop is never forgotten: hundreds of later drops and ten minutes on, a forCall held on the chain build still finds the scope dead', async () => {
    // The ported registry expired entries (a TTL and a size cap). Under that, a forCall held on a chain build while
    // its tab closed could wake after the mark had been evicted, bind the dead session and let its request through
    // (the local Codex review of ADR-0005 reproduced it with 256 further drops); nothing expires now
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => { await held; return transport }, { cancelled: registry, onDrop: () => 0 })
    router.bind('s1', 5)
    const pending = router.forCall('s1', 5) // held on the chain build
    await Promise.resolve()
    await router.dropTab(5)
    // Bound-only sessions are dropped without a chain, so these do not queue behind the held build
    for (let i = 0; i < 300; i++) {
      router.bind(`other-${i}`, 100 + i)
      await router.dropTab(100 + i)
    }
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    // A registry that pruned on write would prune now: this write is what a TTL mutant needs to show itself
    router.bind('late', 999)
    await router.dropTab(999)
    release()
    await pending
    expect(registry.has('s1')).toBe(true)
    expect(router.bound()).toEqual([])
    expect(transport.cancelled).toEqual(['链:s1'])
  })

  it('a text scope is registered before the chain build: a tab closed during the build drops it — nothing bound, the scope marked', async () => {
    // Text requests do not bind first the way OCR does. While the first forCall awaited the chain, the scope was
    // in no session, so dropTab marked nothing and the continuation bound the dead scope and let its request out
    // (the local review of ADR-0005 reproduced it with the real service; inherited from the MVP)
    const transport = fakeTransport('链')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const registry = new CancelledScopeRegistry()
    const drained: string[] = []
    const router = routerOver(async () => { await held; return transport }, { cancelled: registry, onDrop: scope => { drained.push(scope); return 1 } })
    const pending = router.forCall('s1', 7) // no bind before it
    await Promise.resolve()
    expect(router.bound()).toEqual(['s1']) // registered at once
    expect(await router.dropTab(7)).toBe(1) // onDrop only: no chain to drain yet
    expect(drained).toEqual(['s1'])
    expect(registry.has('s1')).toBe(true)
    release()
    await pending
    expect(router.bound()).toEqual([])
    expect(transport.cancelled).toEqual(['链:s1']) // drained on the chain the build returned
  })

  it('a rebind during the chain build wins over the chain the build returns', async () => {
    // engine-ready moves a session (`rebind`) or all of them (`dropAndRebindAll`) while a first forCall may still
    // be awaiting the chain of the moment it started; that older chain must not overrule the move when it lands
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let current = first
    // What a call resolves to is the chain of the moment it was made, as the background's promise does
    const router = routerOver(async () => { const chain = current; if (chain === first) await held; return chain })
    const pending = router.forCall('s1', 7)
    await Promise.resolve()
    current = second // engine-ready rebuilt the chain
    await router.rebind('s1')
    release()
    expect(nameOf(await pending)).toBe('新链')
    expect(nameOf(router.transportFor('s1')!)).toBe('新链')
    expect(first.cancelled).toEqual([])
  })

  it('dropAndRebindAll moves every session before it drains: a build landing during a drain binds the replacement, not the chain being replaced', async () => {
    // A is on the old chain, B is still building on it. Draining A yields; if B were moved only when the loop
    // reached it, B's forCall would land in that gap, bind the old chain and send its request to the deleted
    // service, while the loop then recorded the replacement over it (the local review of ADR-0005, third pass)
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let current = first
    let building = false
    const router = routerOver(async () => { const chain = current; if (chain === first && building) await held; return chain }, {
      retireOthers: () => { for (const chain of [first, second]) if (chain !== current) chain.retire?.() },
    })
    await router.forCall('A', 1)
    building = true
    const pendingB = router.forCall('B', 2)
    await Promise.resolve()
    current = second // the service on 旧链 was deleted, the chain rebuilt
    // Draining A lets B's build finish before the loop would have reached B
    first.cancel = async scope => { first.cancelled.push(`旧链:${scope}`); release(); await new Promise(resolve => setTimeout(resolve, 0)); return 1 }
    // The replaced chain is retired before any drain: a call suspended inside it is refused when it wakes
    expect(await router.dropAndRebindAll()).toBe(1)
    expect(nameOf(await pendingB)).toBe('新链')
    expect(nameOf(router.transportFor('B')!)).toBe('新链')
    expect(first.cancelled).toEqual(['旧链 retired', '旧链:A']) // B never had work on the old chain
  })

  it('dropAndRebindAll never retires the chain in force: a caller whose own rebuild is already obsolete changes nothing', async () => {
    // Two engine-ready rebuilds can finish newer-first, and the configuration watcher rebuilds too. Moving onto
    // the caller's build would retire the chain current() answers, and every fresh page would bind to a retired
    // chain and get nothing but aborted (the local review of ADR-0005, fifth pass). The destination is current()
    const inForce = fakeTransport('新链')
    // The holder spares the build in force; the router must neither drain it nor take it off its sessions
    const router = routerOver(async () => inForce, { retireOthers: () => undefined })
    await router.forCall('s1', 1)
    expect(await router.dropAndRebindAll()).toBe(0)
    await router.rebind('s1')
    expect(nameOf(router.transportFor('s1')!)).toBe('新链')
    expect(inForce.cancelled).toEqual([])
  })

  it('dropAndRebindAll stops the deleted service before its replacement exists: retired and drained at once, the sessions bound again when it lands', async () => {
    // A rebuild can hang in an engine probe. Waiting for it before retiring let the deleted service's chain go on
    // serving the sessions pinned to it (the local review of ADR-0005, thirteenth pass)
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let current = first
    const router = routerOver(async () => { const chain = current; if (chain === second) await held; return chain }, {
      retireOthers: () => { for (const chain of [first, second]) if (chain !== current || chain === first) chain.retire?.() },
    })
    await router.forCall('s1', 1)
    router.bind('ocr-2', 2)
    current = second // the service on 旧链 deleted, the replacement still building
    const moving = router.dropAndRebindAll()
    await Promise.resolve()
    expect(first.cancelled).toEqual(['旧链 retired', '旧链:s1']) // stopped without waiting for 新链
    expect(router.transportFor('s1')).toBeUndefined()
    expect(router.bound()).toEqual(['s1', 'ocr-2']) // the tab entries stay
    release()
    expect(await moving).toBe(1)
    expect(nameOf(router.transportFor('s1')!)).toBe('新链')
    expect(router.transportFor('ocr-2')).toBeUndefined() // never had a chain, not given one
  })

  it('forCall does not bind a chain retired while its build was awaited: it waits for the replacement', async () => {
    const first = fakeTransport('旧链')
    const second = fakeTransport('新链')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let current = first
    const router = routerOver(async () => { const chain = current; if (chain === first) await held; return chain })
    const pending = router.forCall('s1', 7)
    await Promise.resolve()
    first.retire!() // the service on 旧链 deleted while the build was awaited
    current = second
    release()
    expect(nameOf(await pending)).toBe('新链')
    expect(nameOf(router.transportFor('s1')!)).toBe('新链')
  })

  it('a navigation probe superseded by a newer session on the tab stops: it must not re-arm its stale scopes over the newer timer', async () => {
    // A's probe is awaiting the page when B replaces A on the tab and arms a probe of its own. A's answer comes
    // back "still here" while the tab loads: re-arming A would clear B's timer, and B's navigation away would
    // then escape cancellation (the local review of ADR-0005, fourth pass; inherited from the MVP)
    vi.useFakeTimers()
    const transport = fakeTransport('链')
    const asked: string[] = []
    let answer: (a: 'same' | 'other' | 'unknown') => void = () => {}
    const router = routerOver(async () => transport, {
      stillThere: (_tab, scope) => { asked.push(scope); return new Promise(resolve => { answer = resolve }) },
      stillLoading: async () => true,
    })
    await router.forCall('A', 7)
    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(3000) // A's probe is now asking the page
    expect(asked).toEqual(['A'])
    await router.forCall('B', 7) // A replaced on the tab
    router.mayHaveLeft(7) // B's own probe, armed
    answer('same') // the old page's late answer, tab still loading
    await vi.advanceTimersByTimeAsync(3000)
    expect(asked).toEqual(['A', 'B']) // B's timer fired; A was not asked again
    answer('other')
    await vi.advanceTimersByTimeAsync(0)
    expect(transport.cancelled).toContain('链:B')
  })

  it('a certain drop marks every scope before any chain is asked to drain', async () => {
    // The mark is what a call suspended on its cache read sees when it wakes; draining may await a chain build, so
    // every scope of the drop is marked up front, not one by one between drains (ADR-0005)
    const registry = new CancelledScopeRegistry()
    const seen: Record<string, boolean[]> = {}
    const transport = fakeTransport('链')
    transport.cancel = async scope => { seen[scope] = ['a', 'b'].map(s => registry.has(s)); return 1 }
    const router = routerOver(async () => transport, { cancelled: registry })
    await router.forCall('a', 1)
    // `b` was never bound: draining it builds a chain first — `a` is drained before that await resolves
    expect(await router.drop(['a', 'b'])).toBe(2)
    expect(seen).toEqual({ a: [true, true], b: [true, true] })
  })
})
