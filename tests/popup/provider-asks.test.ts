import { describe, expect, it } from 'vitest'
import { createProviderAsks } from '@/entrypoints/popup/provider-asks'
import type { ProviderStatus } from '@/providers/transport'
import type { AxtMessage } from '@/shared/messages'

// The popup's two provider-status asks (INVENTORY S1): the newest saved ask publishes; one session ask in flight,
// given up on after the ttl so a stalled one cannot hold the polling

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0))

const status = (id: string): ProviderStatus => ({ providerId: id, chosen: id, available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags', targetLanguage: 'cmn', promptId: 'default', revision: id, chain: [id], demotions: [], engine: { id } })

function harness(ttlMs = 5_000) {
  let clock = 0
  const sent: { message: AxtMessage<'axt:provider-status'>; answer: ReturnType<typeof deferred<ProviderStatus>> }[] = []
  const saved: (string | null)[] = []
  const session: [string, string | null][] = []
  const asks = createProviderAsks({
    send: message => { const answer = deferred<ProviderStatus>(); sent.push({ message, answer }); return answer.promise },
    publishSaved: s => saved.push(s?.providerId ?? null),
    publishSession: (scope, s) => session.push([scope, s?.providerId ?? null]),
    ttlMs,
    now: () => clock,
  })
  return {
    asks, sent, saved, session,
    advance: (ms: number) => { clock += ms },
    answer: (at: number, s: ProviderStatus) => sent[at]?.answer.resolve(s),
    fail: (at: number) => sent[at]?.answer.reject(new Error('no receiver')),
  }
}

describe('createProviderAsks', () => {
  it('only the newest saved ask publishes: answers come back in any order, and every saved ask carries the barrier', async () => {
    const h = harness()
    void h.asks.saved()
    void h.asks.saved()
    expect(h.sent.map(s => s.message)).toEqual([{ type: 'axt:provider-status', fresh: true }, { type: 'axt:provider-status', fresh: true }])
    h.answer(1, status('new'))
    await tick()
    h.answer(0, status('old'))
    await tick()
    expect(h.saved).toEqual(['new'])
  })

  it('a saved ask that fails publishes null, unless a newer one is out', async () => {
    const h = harness()
    void h.asks.saved()
    h.fail(0)
    await tick()
    expect(h.saved).toEqual([null])
    void h.asks.saved()
    void h.asks.saved()
    h.fail(1)
    await tick()
    expect(h.saved).toEqual([null])
  })

  it('polls of one session are coalesced: one ask in flight, its answer published for that session', async () => {
    const h = harness()
    void h.asks.session('s1')
    void h.asks.session('s1')
    expect(h.sent.map(s => s.message)).toEqual([{ type: 'axt:provider-status', scope: 's1' }])
    h.answer(0, status('chain'))
    await tick()
    expect(h.session).toEqual([['s1', 'chain']])
    void h.asks.session('s1')
    expect(h.sent).toHaveLength(2)
  })

  it('a session ask that has not answered within the ttl is given up on: the next poll asks again, and the late answer neither publishes nor settles its successor', async () => {
    // The third local pass of S1: a scoped status that stalls in an availability probe has no deadline in the
    // background, and one such ask held every later poll of the popup
    const h = harness()
    void h.asks.session('s1')
    h.advance(4_999)
    void h.asks.session('s1')
    expect(h.sent).toHaveLength(1)
    h.advance(1)
    void h.asks.session('s1')
    expect(h.sent).toHaveLength(2)
    // the successor is in flight: a poll meanwhile is coalesced with it
    void h.asks.session('s1')
    expect(h.sent).toHaveLength(2)
    h.answer(0, status('stale'))
    await tick()
    expect(h.session).toEqual([])
    void h.asks.session('s1')
    expect(h.sent).toHaveLength(2)
    h.answer(1, status('fresh'))
    await tick()
    expect(h.session).toEqual([['s1', 'fresh']])
    void h.asks.session('s1')
    expect(h.sent).toHaveLength(3)
  })

  it('an ask past the ttl that answers before any poll replaced it still publishes', async () => {
    const h = harness()
    void h.asks.session('s1')
    h.advance(60_000)
    h.answer(0, status('slow'))
    await tick()
    expect(h.session).toEqual([['s1', 'slow']])
  })

  it('a failed session ask publishes null and frees the session for the next poll', async () => {
    const h = harness()
    void h.asks.session('s1')
    h.fail(0)
    await tick()
    expect(h.session).toEqual([['s1', null]])
    void h.asks.session('s1')
    expect(h.sent).toHaveLength(2)
  })

  it('another session asks at once, and the previous session late answer publishes nothing', async () => {
    const h = harness()
    void h.asks.session('s1')
    void h.asks.session('s2')
    expect(h.sent.map(s => s.message.scope)).toEqual(['s1', 's2'])
    h.answer(0, status('one'))
    await tick()
    expect(h.session).toEqual([])
    h.answer(1, status('two'))
    await tick()
    expect(h.session).toEqual([['s2', 'two']])
  })
})
