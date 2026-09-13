// Binding sessions to chains (the two P1s Codex pointed out on #59)
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
    retire: () => { retired = true; cancelled.push(`${name} retired`); return 1 },
    isRetired: () => retired,
    status: async () => ({ providerId: name, chosen: name, revision: name, available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags' as const, targetLanguage: 'cmn', promptId: 'default', chain: [name], demotions: [], engine: { id: name, displayName: name } }),
  } as TranslationTransport & { name: string; cancelled: string[] }
}

const nameOf = (t: TranslationTransport) => (t as unknown as { name: string }).name

/** A router over a registry of its own; tests that read the registry pass theirs */
const routerOver = (current: SessionRouterDeps['current'], rest: Partial<Omit<SessionRouterDeps, 'current'>> = {}) =>
  createSessionRouter({ current, cancelled: new CancelledScopeRegistry(), ...rest })

afterEach(() => vi.useRealTimers())

describe('createSessionRouter', () => {
  it('a hash change in the same document is no departure: at the deadline the page is asked, and if it says it is still there nothing is withdrawn', async () => {
    // `tabs.onUpdated`'s loading cannot tell “the hash changed” from “navigated to another URL” — measured, changeInfo
    // is {status:'loading'} alone in both cases. Withdrawing on the spot would sentence a page still alive: a reader clicking a citation in the body jumps to the references,
    // and that whole block's translations are all aborted (measured 2026-09-09: 86 blocks all failed)
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
    const router = routerOver(async () => transport, { stillThere: async () => 'same' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    // After the jump the viewport observer at once requests the newly revealed blocks — but that does **not** cancel the withdrawal:
    // on a real departure the old document can send one or two more as well (Codex on #143). The criterion is asking the page itself at the deadline
    await router.forCall('session-1', 7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual([])
    expect(router.bound()).toEqual(['session-1'])
  })

  it('the page itself says it is still there: nothing is withdrawn at the grace deadline, even with not one request in that time', async () => {
    // Jumping to a position already translated makes no new request, so “were there requests” cannot tell. The page itself can:
    // still there, it still answers with the same session id (Codex on #143)
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
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

  it('the old document sends one more request on its way out: the withdrawal proceeds as usual', async () => {
    // On a real departure the old document can often send one or two more messages, which only proves the new document has not taken over yet. Were that to cancel the held withdrawal,
    // the content script is gone the moment the new document commits, nobody arms it again, and the old session's queue runs on (Codex on #143)
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
    const router = routerOver(async () => transport, { stillThere: async () => 'other' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await router.forCall('session-1', 7) // the old document's last one
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['chain:session-1'])
  })

  it('the old document answered “still there” before committing: asked again at complete, and if the answer is now a new session it is withdrawn', async () => {
    // When a cross-document navigation commits slowly, the old document is still alive after loading and still answers with the same session id, so the withdrawal was let go;
    // then it is gone, and nobody asks a second time (Codex on #143). The background presses once more at complete
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
    let answer: 'same' | 'other' | 'unknown' = 'same'
    const router = routerOver(async () => transport, { stillThere: async () => answer })
    await router.forCall('session-1', 7)

    // loading: the old document is still there and answers “still there” — no withdrawal
    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.cancelled).toEqual([])

    // complete: the new document is in place and answers with another session — withdrawn, and a definite end
    answer = 'other'
    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(transport.cancelled).toEqual(['chain:session-1'])
  })

  it('while the tab is still loading “still there” is not trusted; asked again once it settles', async () => {
    // When a cross-document navigation commits slowly, the old document on its way out also answers with the same session. Waiting for `complete` alone will not do —
    // with the destination's load stuck that event never comes (Codex on #143). The criterion became “is the tab still loading”
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
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
    expect(transport.cancelled).toEqual([]) // still loading, no conclusion
    expect(asked).toHaveLength(1)

    // The navigation finally committed: the new document answers with another session
    loading = false
    answer = 'other'
    await vi.advanceTimersByTimeAsync(4000)
    expect(transport.cancelled).toEqual(['chain:session-1'])
  })

  it('stuck loading for ever does not mean asking for ever', async () => {
    // There is a cap, or a tab that never finishes loading turns it into endless polling
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
    const asked: number[] = []
    const router = routerOver(async () => transport, {
      stillThere: async () => { asked.push(Date.now()); return 'same' },
      stillLoading: async () => true,
    })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(asked.length).toBeLessThanOrEqual(4)
    // Past the cap it goes by what the page says: it keeps saying “still there”, so no withdrawal
    expect(transport.cancelled).toEqual([])
  })

  it('the page does not answer: drained, but not marked', async () => {
    // An undelivered message may mean the page is gone, or that the new document's content script is not installed
    // yet — undecidable, so the scope must not be marked: marked wrongly, the living page's second half is aborted
    // for good (Codex on #143: the two cases must be kept apart)
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => transport, { cancelled: registry, stillThere: async () => 'unknown' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['chain:session-1'])
    expect(registry.has('session-1')).toBe(false)
  })

  it('the page answers with another session: gone for certain, marked', async () => {
    // No guess here: the page itself says it is no longer that session. Only the mark stops the requests still
    // hanging on the helper handshake, in no queue yet, that would otherwise go out when they wake (Codex on #143)
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => transport, { cancelled: registry, stillThere: async () => 'other' })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['chain:session-1'])
    expect(registry.has('session-1')).toBe(true)
  })

  it('a guessed end drains the OCR queue too and marks nothing; a certain end marks', async () => {
    // Image OCR queues by scope as well and is drained with the session (onDrop). It used to keep its own record of
    // cancelled scopes, so a wrong guess left every image the living page scrolled to aborted (Codex on #143); now
    // it reads the one registry, and only the router writes it
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
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

  it('a session coming back after a wrong guess still takes the chain it started on', async () => {
    // Had the guessed end deleted the binding too, the returning request would be a “new session” and hang on the **current** chain —
    // and with the reader having changed engine / prompt / target language meanwhile, the same round of translation switches chains midway (Codex on #143)
    vi.useFakeTimers()
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let current = first
    const router = routerOver(async () => current)
    expect(nameOf(await router.forCall('session-1', 7))).toBe('old chain')

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)
    // During the withdrawal the reader changed the engine on the settings page
    current = second

    expect(nameOf(await router.forCall('session-1', 7))).toBe('old chain')
  })

  it('a navigation without a probe: drained when the grace period ends, the scope not marked', async () => {
    // Marking is for certain ends (the reader stopped, the tab closed). A guessed end cannot mark: if the guess is
    // wrong the page is alive, and every request of its second half would be aborted, for good
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => transport, { cancelled: registry })
    await router.forCall('session-1', 7)

    router.mayHaveLeft(7)
    await vi.advanceTimersByTimeAsync(10_000)

    expect(transport.cancelled).toEqual(['chain:session-1'])
    expect(registry.has('session-1')).toBe(false)
    // A wrong guess recovers: the same scope's next request is not drained again
    transport.cancelled.length = 0
    await router.forCall('session-1', 7)
    expect(transport.cancelled).toEqual([])
  })

  it('a session sticks to the chain it started on: a configuration change midway does not switch engines, and only sessions started afterwards take the new chain', async () => {
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let current = first
    const router = routerOver(async () => current)

    expect(nameOf(await router.forCall('session-1', 1))).toBe('old chain')
    // The reader changed the prompt / target language in the popup, and the background rebuilt the chain
    current = second
    // The session in progress goes on over the old chain — otherwise the same round of translation would switch prompt or language midway
    expect(nameOf(await router.forCall('session-1', 1))).toBe('old chain')
    // A session newly opened in another tab gets the new chain
    expect(nameOf(await router.forCall('session-2', 2))).toBe('new chain')
  })

  it('a call without scope (the settings page\'s connection test) always uses the current chain and keeps no books', async () => {
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let current = first
    const router = routerOver(async () => current)
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('old chain')
    current = second
    expect(nameOf(await router.forCall(undefined, undefined))).toBe('new chain')
    expect(router.bound()).toEqual([])
  })

  it('withdrawing a scope uses the chain it is bound to, not the current one: otherwise the new queue is drained and the old one keeps sending', async () => {
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let current = first
    const router = routerOver(async () => current)
    await router.forCall('session-1', 1)
    current = second
    expect(await router.drop(['session-1'])).toBe(1)
    expect(first.cancelled).toEqual(['old chain:session-1'])
    expect(second.cancelled).toEqual([])
    expect(router.bound()).toEqual([])
  })

  it('a scope never bound is withdrawn all the same: the worker restarted midway, the binding is lost but the queue may still hold its tasks', async () => {
    const only = fakeTransport('chain')
    const router = routerOver(async () => only)
    expect(await router.drop(['ghost-session'])).toBe(1)
    expect(only.cancelled).toEqual(['chain:ghost-session'])
  })

  it('a tab closes: the sessions hanging on it are withdrawn, other tabs unaffected', async () => {
    const t = fakeTransport('chain')
    const router = routerOver(async () => t)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    expect(await router.dropTab(1)).toBe(1)
    expect(t.cancelled).toEqual(['chain:session-1'])
    expect(router.bound()).toEqual(['session-2'])
    // Closing a tab without a session is a no-op
    expect(await router.dropTab(99)).toBe(0)
  })

  it('a new scope appears on the same tab: the previous round skipped endRun (navigation / reload), so it is withdrawn', async () => {
    const t = fakeTransport('chain')
    const router = routerOver(async () => t)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 1)
    expect(t.cancelled).toEqual(['chain:session-1'])
    expect(router.bound()).toEqual(['session-2'])
  })

  it('rebind moves one session onto the chain in force and keeps its tab: a language pack downloaded for that tab', async () => {
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let current = first
    const router = routerOver(async () => current)
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    current = second
    // Without the move, the popup's promise "the next paragraphs use the offline engine" would not hold
    await router.rebind('session-1')
    expect(nameOf(await router.forCall('session-1', 1))).toBe('new chain')
    expect(nameOf(await router.forCall('session-2', 2))).toBe('old chain')
    // The binding, tab included, survives: closing the tab still drains it
    expect(await router.dropTab(1)).toBe(1)
    expect(second.cancelled).toEqual(['new chain:session-1'])
  })

  it('dropAndRebindAll drains the old chain before moving: a deleted service must not go on spending its key', async () => {
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let current = first
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => current, { cancelled: registry, retireOthers: () => { let n = 0; for (const chain of [first, second]) if (chain !== current) n += chain.retire?.() ?? 0; return n } })
    await router.forCall('session-1', 1)
    await router.forCall('session-2', 2)
    current = second
    // Re-pointing alone leaves the queued and in-flight requests running on the old chain, with the deleted service's key (Codex on #157)
    expect(await router.dropAndRebindAll()).toBe(1)
    expect(first.cancelled).toEqual(['old chain retired']) // retiring drains the whole chain, whichever session left work there
    expect(nameOf(await router.forCall('session-1', 1))).toBe('new chain')
    // Not marked: the sessions live on, on the new chain — only the old chain's work is gone
    expect(registry.has('session-1')).toBe(false)
    expect(registry.has('session-2')).toBe(false)
    expect(router.bound()).toEqual(['session-1', 'session-2'])
  })

  it('transportFor takes out the session\'s own chain read-only, without binding a new one along the way', async () => {
    const t = fakeTransport('chain')
    const router = routerOver(async () => t)
    await router.forCall('session-1', 1)
    expect(nameOf(router.transportFor('session-1')!)).toBe('chain')
    expect(router.sessionsOn(t)).toBe(1)
    expect(router.transportFor('never-bound')).toBeUndefined()
    expect(router.bound()).toEqual(['session-1'])
  })

  it('same-named scopes in different tabs do not affect each other (session ids are unique anyway; this is a guardrail)', async () => {
    const t = fakeTransport('chain')
    const router = routerOver(async () => t)
    await router.forCall('s', 1)
    await router.forCall('s', 1)
    expect(router.bound()).toEqual(['s'])
    expect(t.cancelled).toEqual([])
  })

  it('onDrop: withdrawing a scope also withdraws the other things queued by scope (image OCR, §15.2), counted into the return value', async () => {
    const transport = fakeTransport('chain')
    const dropped: string[] = []
    const router = routerOver(async () => transport, { onDrop: scope => { dropped.push(scope); return 2 } })
    await router.forCall('s1', 1)
    await router.forCall('s2', 2)
    expect(await router.drop(['s1'])).toBe(3) // the transport withdraws 1 + onDrop withdraws 2
    expect(await router.dropTab(2)).toBe(3)
    expect(dropped).toEqual(['s1', 's2'])
  })

  it('bindTo is provisional: a session bound at status time takes nothing from the tab until its first request, which then drops the tab\'s earlier sessions (S2 review, eighth pass)', async () => {
    const chain = fakeTransport('chain')
    const router = routerOver(async () => chain)
    // The tab's session, on its chain, with a request made
    expect(nameOf(await router.forCall('winner', 7))).toBe('chain')
    // A restart that lost: its status came back late and bound it — nothing happens to the winner
    router.bindTo('loser', chain, 7)
    expect(router.bound().sort()).toEqual(['loser', 'winner'])
    expect(router.transportFor('winner')).toBe(chain)
    expect(chain.cancelled).toEqual([])
    // The next session of the tab makes its first request: the winner and the lingering loser are its stale predecessors
    router.bindTo('next', chain, 7)
    expect(nameOf(await router.forCall('next', 7))).toBe('chain')
    expect(router.bound()).toEqual(['next'])
    expect(chain.cancelled.sort()).toEqual(['chain:loser', 'chain:winner'])
    // Its second request is an ordinary bound call: nothing more is dropped
    await router.forCall('next', 7)
    expect(chain.cancelled).toHaveLength(2)
  })

  it('a page\'s old session registering anew — after a worker restart — does not cancel the provisional replacement waiting for it (eleventh pass)', async () => {
    const chain = fakeTransport('chain')
    const router = routerOver(async () => chain)
    // A fresh worker: the page's active session S has no entry. Its restart N is bound provisionally first
    router.bindTo('N', chain, 7)
    // Then S sends a request (text) and an OCR bind before N's status has reached the page
    expect(nameOf(await router.forCall('S', 7))).toBe('chain')
    router.bind('S', 7)
    expect(router.bound().sort()).toEqual(['N', 'S'])
    expect(chain.cancelled).toEqual([])
    // N starts and makes its first request: now S is the one superseded
    expect(nameOf(await router.forCall('N', 7))).toBe('chain')
    expect(router.bound()).toEqual(['N'])
    expect(chain.cancelled).toEqual(['chain:S'])
  })

  it('a provisional binding to a chain since retired is let go, and the first request still drops the tab\'s earlier session before binding the chain in force (ninth pass)', async () => {
    const old = fakeTransport('old')
    const fresh = fakeTransport('new')
    let current = old
    const router = routerOver(async () => current)
    // The tab's earlier session made its requests on the old chain; the new document's session is bound to it provisionally
    router.bind('earlier', 7)
    await router.forCall('earlier', 7)
    router.bindTo('s1', old, 7)
    old.retire?.()
    current = fresh
    expect(nameOf(await router.forCall('s1', 7))).toBe('new')
    expect(router.transportFor('s1')).toBe(fresh)
    expect(router.bound()).toEqual(['s1'])
    expect(old.cancelled).toContain('old:earlier')
  })

  it('dropAndRebindAll keeps a provisional session provisional: its first request still drops the tab\'s earlier session', async () => {
    const old = fakeTransport('old')
    const fresh = fakeTransport('new')
    let current = old
    const router = routerOver(async () => current, { retireOthers: () => { old.retire?.(); return 0 } })
    router.bind('earlier', 7)
    await router.forCall('earlier', 7)
    router.bindTo('s1', old, 7)
    current = fresh
    await router.dropAndRebindAll()
    expect(router.bound().sort()).toEqual(['earlier', 's1'])
    expect(nameOf(await router.forCall('s1', 7))).toBe('new')
    expect(router.bound()).toEqual(['s1'])
  })

  it('a provisional binding to a chain since retired is not used: the first request binds the chain in force', async () => {
    const old = fakeTransport('old')
    const fresh = fakeTransport('new')
    const router = routerOver(async () => fresh)
    router.bindTo('s1', old, 7)
    old.retire?.()
    expect(nameOf(await router.forCall('s1', 7))).toBe('new')
    expect(router.transportFor('s1')).toBe(fresh)
  })

  it('bind: records the tab association only, returns synchronously, builds no chain; dropTab reaches it afterwards, and forCall then fills in the chain and keeps the tab', async () => {
    const transport = fakeTransport('chain')
    let built = 0
    const dropped: string[] = []
    const router = routerOver(async () => { built++; return transport }, { onDrop: scope => { dropped.push(scope); return 1 } })
    router.bind('s1', 7)
    expect(built).toBe(0)
    expect(router.bound()).toEqual(['s1'])
    expect(nameOf(await router.forCall('s1', 7))).toBe('chain')
    expect(built).toBe(1)
    expect(await router.dropTab(7)).toBe(2) // the transport withdraws 1 + onDrop withdraws 1
    expect(dropped).toEqual(['s1'])
    expect(router.bound()).toEqual([])
    // A new scope appears on the same tab: bind withdraws the old one too
    router.bind('s2', 8)
    router.bind('s3', 8)
    await Promise.resolve()
    expect(router.bound()).toEqual(['s3'])
  })

  it('drop: onDrop comes before the chain build; a session bound through bind alone gets no chain built to withdraw it (the build may hang on the engine probe, Codex on #87)', async () => {
    const transport = fakeTransport('chain')
    const order: string[] = []
    const router = routerOver(async () => { order.push('current'); return transport }, { onDrop: scope => { order.push(`onDrop:${scope}`); return 1 } })
    router.bind('ocr-only', 3)
    expect(await router.dropTab(3)).toBe(1)
    expect(order).toEqual(['onDrop:ocr-only']) // no current
    // A session that translated text: onDrop still first, transport.cancel after
    await router.forCall('s1', 4)
    order.length = 0
    await router.dropTab(4)
    expect(order[0]).toBe('onDrop:s1')
    expect(transport.cancelled).toContain('chain:s1')
  })

  it('bind → withdrawn while forCall is building the chain: forCall coming back does not revive the session and withdraws the scope on that chain after the fact; a withdrawn scope\'s later bind / forCall count as withdrawn (Codex on #87)', async () => {
    const transport = fakeTransport('chain')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const registry = new CancelledScopeRegistry()
    const router = routerOver(async () => { await held; return transport }, { cancelled: registry, onDrop: () => 1 })
    router.bind('s1', 5)
    const pending = router.forCall('s1', 5) // awaiting current() right now
    await Promise.resolve()
    expect(await router.dropTab(5)).toBe(1) // onDrop only: no chain to withdraw yet
    expect(registry.has('s1')).toBe(true) // marked at once, while the chain is still being built
    release()
    await pending
    expect(router.bound()).toEqual([]) // not revived
    expect(transport.cancelled).toEqual(['chain:s1']) // forCall came back and withdrew after the fact
    // Coming again afterwards: bind is a no-op, forCall gives the chain but withdraws first
    router.bind('s1', 5)
    expect(router.bound()).toEqual([])
    await router.forCall('s1', 5)
    expect(router.bound()).toEqual([])
    expect(transport.cancelled).toEqual(['chain:s1', 'chain:s1'])
  })

  it('a certain drop is never forgotten: hundreds of later drops and ten minutes on, a forCall held on the chain build still finds the scope dead', async () => {
    // The ported registry expired entries (a TTL and a size cap). Under that, a forCall held on a chain build while
    // its tab closed could wake after the mark had been evicted, bind the dead session and let its request through
    // (the local Codex review of ADR-0005 reproduced it with 256 further drops); nothing expires now
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
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
    expect(transport.cancelled).toEqual(['chain:s1'])
  })

  it('a text scope is registered before the chain build: a tab closed during the build drops it — nothing bound, the scope marked', async () => {
    // Text requests do not bind first the way OCR does. While the first forCall awaited the chain, the scope was
    // in no session, so dropTab marked nothing and the continuation bound the dead scope and let its request out
    // (the local review of ADR-0005 reproduced it with the real service; inherited from the MVP)
    const transport = fakeTransport('chain')
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
    expect(transport.cancelled).toEqual(['chain:s1']) // drained on the chain the build returned
  })

  it('a rebind during the chain build wins over the chain the build returns', async () => {
    // engine-ready moves a session (`rebind`) or all of them (`dropAndRebindAll`) while a first forCall may still
    // be awaiting the chain of the moment it started; that older chain must not overrule the move when it lands
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
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
    expect(nameOf(await pending)).toBe('new chain')
    expect(nameOf(router.transportFor('s1')!)).toBe('new chain')
    expect(first.cancelled).toEqual([])
  })

  it('dropAndRebindAll moves every session before it drains: a build landing during a drain binds the replacement, not the chain being replaced', async () => {
    // A is on the old chain, B is still building on it. Draining A yields; if B were moved only when the loop
    // reached it, B's forCall would land in that gap, bind the old chain and send its request to the deleted
    // service, while the loop then recorded the replacement over it (the local review of ADR-0005, third pass)
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let current = first
    let building = false
    const router = routerOver(async () => { const chain = current; if (chain === first && building) await held; return chain }, {
      retireOthers: () => { let n = 0; for (const chain of [first, second]) if (chain !== current) n += chain.retire?.() ?? 0; return n },
    })
    await router.forCall('A', 1)
    building = true
    const pendingB = router.forCall('B', 2)
    await Promise.resolve()
    current = second // the service on old chain was deleted, the chain rebuilt
    // Retiring old chain lets B's build finish before the replacement is awaited
    const retire = first.retire!
    first.retire = () => { const n = retire(); release(); return n }
    const moving = router.dropAndRebindAll()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(await moving).toBe(1)
    expect(nameOf(await pendingB)).toBe('new chain')
    expect(nameOf(router.transportFor('B')!)).toBe('new chain')
    expect(first.cancelled).toEqual(['old chain retired'])
  })

  it('dropAndRebindAll never retires the chain in force: a caller whose own rebuild is already obsolete changes nothing', async () => {
    // Two engine-ready rebuilds can finish newer-first, and the configuration watcher rebuilds too. Moving onto
    // the caller's build would retire the chain current() answers, and every fresh page would bind to a retired
    // chain and get nothing but aborted (the local review of ADR-0005, fifth pass). The destination is current()
    const inForce = fakeTransport('new chain')
    // The holder spares the build in force; the router must neither drain it nor take it off its sessions
    const router = routerOver(async () => inForce, { retireOthers: () => 0 })
    await router.forCall('s1', 1)
    expect(await router.dropAndRebindAll()).toBe(0)
    await router.rebind('s1')
    expect(nameOf(router.transportFor('s1')!)).toBe('new chain')
    expect(inForce.cancelled).toEqual([])
  })

  it('dropAndRebindAll stops the deleted service before its replacement exists: retired and drained at once, the sessions bound again when it lands', async () => {
    // A rebuild can hang in an engine probe. Waiting for it before retiring let the deleted service's chain go on
    // serving the sessions pinned to it (the local review of ADR-0005, thirteenth pass)
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let current = first
    const router = routerOver(async () => { const chain = current; if (chain === second) await held; return chain }, {
      retireOthers: () => (current === second ? first.retire?.() ?? 0 : 0),
    })
    await router.forCall('s1', 1)
    router.bind('ocr-2', 2)
    current = second // the service on old chain deleted, the replacement still building
    const moving = router.dropAndRebindAll()
    await Promise.resolve()
    expect(first.cancelled).toEqual(['old chain retired']) // stopped and drained without waiting for new chain
    expect(router.transportFor('s1')).toBeUndefined()
    expect(router.bound()).toEqual(['s1', 'ocr-2']) // the tab entries stay
    release()
    expect(await moving).toBe(1)
    expect(nameOf(router.transportFor('s1')!)).toBe('new chain')
    expect(router.transportFor('ocr-2')).toBeUndefined() // never had a chain, not given one
  })

  it('forCall does not bind a chain retired while its build was awaited: it waits for the replacement', async () => {
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let current = first
    const router = routerOver(async () => { const chain = current; if (chain === first) await held; return chain })
    const pending = router.forCall('s1', 7)
    await Promise.resolve()
    first.retire!() // the service on old chain deleted while the build was awaited
    current = second
    release()
    expect(nameOf(await pending)).toBe('new chain')
    expect(nameOf(router.transportFor('s1')!)).toBe('new chain')
  })

  it('a navigation probe superseded by a newer session on the tab stops: it must not re-arm its stale scopes over the newer timer', async () => {
    // A's probe is awaiting the page when B replaces A on the tab and arms a probe of its own. A's answer comes
    // back "still here" while the tab loads: re-arming A would clear B's timer, and B's navigation away would
    // then escape cancellation (the local review of ADR-0005, fourth pass; inherited from the MVP)
    vi.useFakeTimers()
    const transport = fakeTransport('chain')
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
    expect(transport.cancelled).toContain('chain:B')
  })

  it('drop drains the scope from every chain the holder still has, not only the one it is bound to', async () => {
    // A language pack moved the session; its earlier requests are still on the old chain, which other sessions
    // may use and which is therefore not retired (the local review of ADR-0005, seventeenth pass)
    const first = fakeTransport('old chain')
    const second = fakeTransport('new chain')
    let current = first
    const router = routerOver(async () => current, {
      cancelScope: async scope => { let n = 0; for (const chain of [first, second]) n += await chain.cancel(scope); return n },
    })
    await router.forCall('s1', 1)
    current = second
    await router.rebind('s1')
    expect(await router.dropTab(1)).toBe(2)
    expect(first.cancelled).toEqual(['old chain:s1'])
    expect(second.cancelled).toEqual(['new chain:s1'])
  })

  it('a certain drop marks every scope before any chain is asked to drain', async () => {
    // The mark is what a call suspended on its cache read sees when it wakes; draining may await a chain build, so
    // every scope of the drop is marked up front, not one by one between drains (ADR-0005)
    const registry = new CancelledScopeRegistry()
    const seen: Record<string, boolean[]> = {}
    const transport = fakeTransport('chain')
    transport.cancel = async scope => { seen[scope] = ['a', 'b'].map(s => registry.has(s)); return 1 }
    const router = routerOver(async () => transport, { cancelled: registry })
    await router.forCall('a', 1)
    // `b` was never bound: draining it builds a chain first — `a` is drained before that await resolves
    expect(await router.drop(['a', 'b'])).toBe(2)
    expect(seen).toEqual({ a: [true, true], b: [true, true] })
  })
})
