import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationCache, createCacheDb } from '@/cache/store'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import { createChainHolder } from '@/entrypoints/background/chain'
import { createSessionRouter } from '@/entrypoints/background/sessions'
import { CHAIN_CONFIG_FIELDS, VOLATILE_CONFIG_FIELDS, chainConfigChanged, chainRevision, createLocalTransport } from '@/providers/transport'
import type { CachePort } from '@/providers/translate-service'
import { ProviderError, type TranslateRequest, type TranslationProvider } from '@/providers/types'

const req: TranslateRequest = { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh-CN' }

function mockProvider(translate: TranslationProvider['translate'], extra: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    id: 'mock', kind: 'llm', wireFormats: ['tags'] as const, maxBatchChars: 1000, maxBatchItems: 4,
    isAvailable: async () => true,
    translate,
    ...extra,
  }
}

/** The reader's own service; its id is the engine's id, so status and cache keys need no special case */
const SVC = { id: 'svc-abcd1234', kind: 'openai-compat' as const, name: 'Mine', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-x', model: 'x/y', thinking: 'disabled' as const }
/** The chain comes from the test: the real buildChain is not touched, so no real API key is needed; the registry is a fresh one unless the test passes its own */
const withChain = (chain: TranslationProvider[], extra: Partial<Parameters<typeof createLocalTransport>[1]> = {}) =>
  createLocalTransport({ ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] }, { cancelled: new CancelledScopeRegistry(), buildChain: async () => ({ chain, renderPath: 'tags' as const }), ...extra })

const portOf = (cache: TranslationCache): CachePort => ({
  getMany: keys => Promise.all(keys.map(key => cache.get(key))),
  async putMany(entries) { for (const e of entries) await cache.set(e.key, e.translation, e.paper) },
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createLocalTransport: translation', () => {
  it('the successful response shape', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }))])
    // The model rides only on the chosen service's engine: changing it must not expire a free engine's cache
    expect(await t.translate({ request: req })).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }], provider: 'mock' }, cached: 0 })
  })

  it('retries successfully after one rate limit', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let calls = 0
    const t = await withChain([mockProvider(async r => {
      if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
      return { segments: r.segments, provider: 'mock' }
    })])
    const pending = t.translate({ request: req })
    await vi.advanceTimersByTimeAsync(100) // accumulating
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(6_000) // resent after the 429's pause window (base 5s)
    expect((await pending).ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('the token bucket: a burst of capacity, then released at rate (the semantics of Read Frog\'s request-queue)', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    // Each one a batch of its own (maxBatchItems 1), rate 1/s, burst 2
    const t = await withChain([mockProvider(async r => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return { segments: r.segments, provider: 'mock' }
    }, { maxBatchItems: 1, rateLimit: { rate: 1, capacity: 2 } })])
    const all = Promise.all([t.translate({ request: req }), t.translate({ request: req }), t.translate({ request: req })])
    await vi.advanceTimersByTimeAsync(100)
    expect(peak).toBe(2)
    expect(release.length).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000) // the third waits for the next token
    expect(release.length).toBe(3)
    expect(peak).toBe(3)
    for (const fn of release) fn()
    await vi.advanceTimersByTimeAsync(0)
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('the error response shape: a ProviderError carries its kind, other errors are unknown', async () => {
    const auth = await withChain([mockProvider(async () => { throw new ProviderError('auth', 'bad key') })])
    expect(await auth.translate({ request: req })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key', isolatable: false } })
    // An unknown error is retryable by default: switch retries off before looking at the shape
    const boom = await withChain([mockProvider(async () => { throw new Error('boom') })], { queue: { maxRetries: 0 } })
    expect(await boom.translate({ request: req })).toEqual({ ok: false, error: { kind: 'unknown', message: 'boom', isolatable: true } })
  })

  it('a call naming an engine skips the fallback chain: the settings page\'s “Test connection” has to report that endpoint\'s error as it is', async () => {
    const failing = { ...mockProvider(async () => { throw new ProviderError('auth', 'bad key') }), id: SVC.id }
    const free = { ...mockProvider(async r => ({ segments: r.segments, provider: 'google-web' })), id: 'google-web' }
    const t = await withChain([failing, free])
    // Unnamed: the chain falls back as usual, and the page translation does not stop dead
    expect(await t.translate({ request: req })).toMatchObject({ ok: true, result: { provider: 'google-web' } })
    // Named: reports the error outright; it must not show as success just because the chain has a free fallback
    expect(await t.translate({ request: req, providerId: SVC.id })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key', isolatable: false } })
  })

  it('naming a service of the reader\'s own that is not on the chain: asks that endpoint directly rather than reporting “not on the current chain”', async () => {
    // Editing an unselected service and clicking “Connect” has this shape: the chain is built around the selected one, and the one under test is not on it.
    // With the key cleared the endpoint reports no-key, exactly the reason the settings page has to show (Codex on #157)
    const spare = { ...SVC, id: 'svc-99999999', apiKey: '' }
    const t = await createLocalTransport(
      { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC, spare] },
      { cancelled: new CancelledScopeRegistry(), buildChain: async () => ({ chain: [{ ...mockProvider(async r => ({ segments: r.segments, provider: 'mock' })), id: SVC.id }], renderPath: 'tags' as const }) },
    )
    expect(await t.translate({ request: req, providerId: spare.id })).toEqual({ ok: false, error: { kind: 'no-key', message: 'no API key configured', isolatable: false } })
  })

  it('naming an engine that is not on the chain: says so, no quiet swap for another', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments, provider: 'mock' }))])
    expect(await t.translate({ request: req, providerId: 'chrome-builtin' })).toEqual({ ok: false, error: { kind: 'unknown', message: 'engine chrome-builtin is not on the current chain', isolatable: false } })
  })

  it('cancel withdraws the in-flight requests and reports the count withdrawn as it is', async () => {
    vi.useFakeTimers()
    const t = await withChain([mockProvider(() => new Promise(() => undefined) as never)])
    const pending = t.translate({ request: req, scope: 'session-1' })
    await vi.advanceTimersByTimeAsync(200)
    expect(await t.cancel('session-1')).toBeGreaterThan(0)
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })

  it('the registry the router writes is the one every service reads — on the chain, by name, off the chain: a marked scope is refused without a request (ADR-0005)', async () => {
    const calls: string[] = []
    const engine = (id: string) => ({ ...mockProvider(async r => { calls.push(id); return { segments: r.segments, provider: id } }), id })
    const registry = new CancelledScopeRegistry()
    const spare = { ...SVC, id: 'svc-99999999' }
    const t = await createLocalTransport(
      { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC, spare] },
      { cancelled: registry, buildChain: async () => ({ chain: [engine(SVC.id), engine('google-web')], renderPath: 'tags' as const }) },
    )
    registry.markScope('dead')
    const dead = { request: req, scope: 'dead' }
    expect(await t.translate(dead)).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(await t.translate({ ...dead, providerId: 'google-web' })).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    // A configured service the chain is not built around gets a service of its own; it must read the same registry
    expect(await t.translate({ ...dead, providerId: spare.id })).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(calls).toEqual([])
    // A scope nobody marked goes through
    expect((await t.translate({ request: req, scope: 'live' })).ok).toBe(true)
    expect(calls).toEqual([SVC.id])
  })

  it('retire(): a call suspended in the chain\'s cache read is refused when it wakes and caches nothing; the scope itself is not marked (ADR-0005, fourth review pass)', async () => {
    // A service was deleted while a request of a live session sat in its chain's cache read — outside every
    // queue, so draining reaches nothing. Retiring the chain stops it there; the session goes on, on the replacement
    const calls: string[] = []
    const writes: unknown[] = []
    let signal: () => void = () => {}
    const reached = new Promise<void>(resolve => { signal = resolve })
    let release: () => void = () => {}
    const cache: CachePort = {
      getMany: keys => new Promise(resolve => { release = () => resolve(keys.map(() => null)); signal() }),
      putMany: async entries => { writes.push(entries) },
    }
    const registry = new CancelledScopeRegistry()
    const t = await withChain([mockProvider(async r => { calls.push('call'); return { segments: r.segments, provider: 'mock' } })], { cache, cancelled: registry })
    const pending = t.translate({ request: req, scope: 'live', cache: { paper: '2410.00260', renderPath: 'tags' } })
    await reached
    t.retire!()
    release()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(calls).toEqual([])
    expect(writes).toEqual([])
    expect(registry.has('live')).toBe(false)
  })

  it('retire() also refuses work without a scope: a pending connection test must not use a deleted service\'s key (ADR-0005, fifth review pass)', async () => {
    // The settings drawer's connection test names its service and carries no scope; the registry cannot cover
    // it, the retirement gate must
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('no network in tests'))
    const calls: string[] = []
    const spare = { ...SVC, id: 'svc-99999999' }
    const t = await createLocalTransport(
      { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC, spare] },
      { cancelled: new CancelledScopeRegistry(), buildChain: async () => ({ chain: [mockProvider(async r => { calls.push('call'); return { segments: r.segments, provider: 'mock' } })], renderPath: 'tags' as const }) },
    )
    // Off the chain: the test is past its first await when the chain is retired
    const pending = t.translate({ request: req, providerId: spare.id })
    t.retire!()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(fetchSpy).not.toHaveBeenCalled()
    // On the chain, no scope: refused as well
    expect(await t.translate({ request: req })).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(calls).toEqual([])
    fetchSpy.mockRestore()
  })

  it('retire() stops an unscoped batch still gathering: the dispatch gate, for work no scope can drain', async () => {
    // Past its awaits and into the batch queue when the chain is retired: only the check at dispatch stands
    // between it and the endpoint
    vi.useFakeTimers()
    const calls: string[] = []
    const t = await withChain([mockProvider(async r => { calls.push('call'); return { segments: r.segments, provider: 'mock' } })], { batch: { batchDelay: 50 } })
    const pending = t.translate({ request: req })
    await vi.advanceTimersByTimeAsync(10)
    t.retire!()
    await vi.advanceTimersByTimeAsync(200)
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(calls).toEqual([])
  })

  it('retire() while an unscoped batch is in flight: nothing comes back, nothing is cached', async () => {
    // Already at the endpoint when the chain is retired: a retired chain answers nothing and writes nothing —
    // the check after every batch settled, which used to look at the scope alone and only guarded the cache write
    const writes: unknown[] = []
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const cache: CachePort = { getMany: async keys => keys.map(() => null), putMany: async entries => { writes.push(entries) } }
    let entered: () => void = () => {}
    const atEndpoint = new Promise<void>(resolve => { entered = resolve })
    const t = await withChain([mockProvider(async r => { entered(); await held; return { segments: r.segments, provider: 'mock' } })], { cache })
    const pending = t.translate({ request: req, cache: { paper: '2410.00260', renderPath: 'tags' } })
    await atEndpoint // real timers: the request is at the endpoint
    t.retire!()
    release()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(writes).toEqual([])
  })

  it('after retirement nothing of a call goes back: a scoped call sharing its task with an unscoped one gets aborted, not the shared result (ADR-0005, fifteenth review pass)', async () => {
    // Deduplication merges the two calls into one queue task; the unscoped subscriber keeps that task alive
    // through the drain, so it completes — the answer must still not reach the scoped caller
    const writes: unknown[] = []
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let entered: () => void = () => {}
    const atEndpoint = new Promise<void>(resolve => { entered = resolve })
    const cache: CachePort = { getMany: async keys => keys.map(() => null), putMany: async entries => { writes.push(entries) } }
    const t = await withChain([mockProvider(async r => { entered(); await held; return { segments: r.segments, provider: 'mock' } })], { cache })
    const scoped = t.translate({ request: req, scope: 'live', cache: { paper: '2410.00260', renderPath: 'tags' } })
    const unscoped = t.translate({ request: req, cache: { paper: '2410.00260', renderPath: 'tags' } })
    await atEndpoint
    t.retire!()
    release()
    expect(await scoped).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(await unscoped).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(writes).toEqual([])
  })

  it('a call split over two batches and retired between them comes back aborted with no partial result', async () => {
    // run.ts renders `partial` while the session is live; after retirement the finished batch must not be shown either
    let calls = 0
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let entered: () => void = () => {}
    const second = new Promise<void>(resolve => { entered = resolve })
    const writes: unknown[] = []
    const cache: CachePort = { getMany: async keys => keys.map(() => null), putMany: async entries => { writes.push(entries) } }
    const t = await withChain([mockProvider(async r => { if (++calls === 2) { entered(); await held } return { segments: r.segments, provider: 'mock' } }, { maxBatchItems: 1 })], { cache })
    const pending = t.translate({ request: { segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], source: 'en', target: 'zh-CN' }, scope: 'live', cache: { paper: '2410.00260', renderPath: 'tags' } })
    await second // the second batch is at the endpoint
    await new Promise(resolve => setTimeout(resolve, 0)) // and the first has settled in the queue: only the second is drained
    t.retire!()
    release()
    const result = await pending
    expect(result).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(result.ok === false && result.partial).toBeUndefined()
    expect(writes).toEqual([])
  })

  it('retire() during the cache write: the result does not go back either (ADR-0005, sixteenth review pass)', async () => {
    // The last check before the write is followed by one more wait, the write itself; a retirement landing there
    // must be seen too. What was written stays — sound translations under content-derived keys
    let releaseWrite: () => void = () => {}
    const writing = new Promise<void>(resolve => { releaseWrite = resolve })
    let atWrite: () => void = () => {}
    const writeStarted = new Promise<void>(resolve => { atWrite = resolve })
    const cache: CachePort = { getMany: async keys => keys.map(() => null), putMany: async () => { atWrite(); await writing } }
    const t = await withChain([mockProvider(async r => ({ segments: r.segments, provider: 'mock' }))], { cache })
    const pending = t.translate({ request: req, scope: 'live', cache: { paper: '2410.00260', renderPath: 'tags' } })
    await writeStarted
    t.retire!()
    releaseWrite()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })

  it('a scope dropped during the cache write gets nothing back either', async () => {
    let releaseWrite: () => void = () => {}
    const writing = new Promise<void>(resolve => { releaseWrite = resolve })
    let atWrite: () => void = () => {}
    const writeStarted = new Promise<void>(resolve => { atWrite = resolve })
    const cache: CachePort = { getMany: async keys => keys.map(() => null), putMany: async () => { atWrite(); await writing } }
    const registry = new CancelledScopeRegistry()
    const t = await withChain([mockProvider(async r => ({ segments: r.segments, provider: 'mock' }))], { cache, cancelled: registry })
    const pending = t.translate({ request: req, scope: 'live', cache: { paper: '2410.00260', renderPath: 'tags' } })
    await writeStarted
    registry.markScope('live') // the router's drop: mark, then drain
    await t.cancel('live')
    releaseWrite()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })

  it('an aborted answer carries no partial result from an earlier engine on the chain', async () => {
    // The first engine translated one segment and failed the other, the chain fell back, and the fallback engine's
    // chain was retired while it worked: the refusal must not pick the first engine's segment back up
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let entered: () => void = () => {}
    const atFallback = new Promise<void>(resolve => { entered = resolve })
    const first = { ...mockProvider(async r => {
      if (r.segments[0]?.id === 'a') return { segments: r.segments, provider: 'p1' }
      throw attachRequestErrorMeta(new ProviderError('network', 'down'), { isRetryable: false })
    }, { maxBatchItems: 1 }), id: 'p1' }
    const second = { ...mockProvider(async r => { entered(); await held; return { segments: r.segments, provider: 'p2' } }), id: 'p2' }
    const t = await withChain([first, second])
    const pending = t.translate({ request: { segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], source: 'en', target: 'zh-CN' }, scope: 'live' })
    await atFallback
    t.retire!()
    release()
    const result = await pending
    expect(result).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(result.ok === false && result.partial).toBeUndefined()
  })

  it('retire() and cancel(scope) reach an off-chain call already at its endpoint', async () => {
    // Off-chain services are built per named call; one with a request in flight is drained with the chain
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => undefined))
    const spare = { ...SVC, id: 'svc-99999999' }
    const build = () => createLocalTransport(
      { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC, spare] },
      { cancelled: new CancelledScopeRegistry(), buildChain: async () => ({ chain: [mockProvider(async r => ({ segments: r.segments, provider: 'mock' }))], renderPath: 'tags' as const }) },
    )
    const retiring = await build()
    const onRetire = retiring.translate({ request: req, providerId: spare.id, scope: 'live' })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1))
    expect(retiring.retire!()).toBeGreaterThan(0)
    expect(await onRetire).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    const cancelling = await build()
    const onCancel = cancelling.translate({ request: req, providerId: spare.id, scope: 'live' })
    await vi.waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2))
    expect(await cancelling.cancel('live')).toBeGreaterThan(0)
    expect(await onCancel).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    fetchSpy.mockRestore()
  })

  it('retire() between two attempts: the request queue retries the stored thunk, so the gate sits in front of every provider call', async () => {
    // An unscoped request failed with a retryable error and is waiting out its backoff when the chain is retired;
    // the retry must not reach the endpoint with the deleted key (the local review of ADR-0005, sixth pass)
    vi.useFakeTimers()
    let calls = 0
    const t = await withChain([mockProvider(async r => {
      if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
      return { segments: r.segments, provider: 'mock' }
    })])
    const pending = t.translate({ request: req })
    await vi.advanceTimersByTimeAsync(300)
    expect(calls).toBe(1) // the first attempt failed, the retry is scheduled
    t.retire!()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toBe(1)
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })

  it('deleting a service retires the chain a pending connection test is on, through activate() and dropAndRebindAll(): the retry never reaches the endpoint (ADR-0005, seventh review pass)', async () => {
    // The connection test has no scope and no session, so nothing leads the router to its chain; the holder knows
    // every chain it built and retires all but the one in force when the router asks
    vi.useFakeTimers()
    let calls = 0
    const registry = new CancelledScopeRegistry()
    const holder = createChainHolder({
      owned: transport => router.sessionsOn(transport) > 0,
      load: async () => ({
        config: DEFAULT_CONFIG,
        transport: await withChain([mockProvider(async r => {
          if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
          return { segments: r.segments, provider: 'mock' }
        })], { cancelled: registry }),
      }),
    })
    const router = createSessionRouter({ current: () => holder.current(), cancelled: registry, retireOthers: () => holder.retireOthers() })
    const first = await holder.current()
    const pending = first.translate({ request: req }) // the connection test: no scope, no session
    await vi.advanceTimersByTimeAsync(300)
    expect(calls).toBe(1) // failed once, the retry is scheduled
    await holder.activate() // the service was deleted, the chain rebuilt
    await router.dropAndRebindAll()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(calls).toBe(1)
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })

  it('a deletion drains a chain its session left earlier: the request still in flight there is cancelled, never returned late (ADR-0005, fourteenth review pass)', async () => {
    // A language pack moved the session to a new chain while its request was still at the old chain's endpoint;
    // the registry does not mark a live session, so only draining the chain itself stops that request
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let entered: () => void = () => {}
    const atEndpoint = new Promise<void>(resolve => { entered = resolve })
    const registry = new CancelledScopeRegistry()
    let calls = 0
    const holder = createChainHolder({
      owned: transport => router.sessionsOn(transport) > 0,
      load: async () => ({
        config: DEFAULT_CONFIG,
        transport: await withChain([mockProvider(async r => { if (++calls === 1) { entered(); await held } return { segments: r.segments, provider: 'mock' } })], { cancelled: registry }),
      }),
    })
    const router = createSessionRouter({ current: () => holder.current(), cancelled: registry, retireOthers: () => holder.retireOthers() })
    const first = await router.forCall('s1', 1)
    const pending = first.translate({ request: req, scope: 's1' })
    await atEndpoint
    await holder.activate() // a language pack: the session moves on, its request stays at the old endpoint
    await router.rebind('s1')
    await holder.activate() // a service deleted
    expect(await router.dropAndRebindAll()).toBeGreaterThan(0)
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    release()
  })

  it('closing the tab after a language pack moved the session drains its work from the old chain too: the request at the endpoint is aborted, the waiting ones never sent (ADR-0005, seventeenth review pass)', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    let entered: () => void = () => {}
    const atEndpoint = new Promise<void>(resolve => { entered = resolve })
    const registry = new CancelledScopeRegistry()
    let calls = 0
    let signal: AbortSignal | undefined
    const holder = createChainHolder({
      owned: transport => router.sessionsOn(transport) > 0,
      load: async () => ({
        config: DEFAULT_CONFIG,
        transport: await withChain([mockProvider(async r => { calls++; signal = r.signal; entered(); await held; return { segments: r.segments, provider: 'mock' } }, { maxBatchItems: 1, maxConcurrent: 1 })], { cancelled: registry }),
      }),
    })
    const router = createSessionRouter({ current: () => holder.current(), cancelled: registry, retireOthers: () => holder.retireOthers(), cancelScope: scope => holder.cancelScope(scope) })
    const first = await router.forCall('s1', 1)
    const pending = first.translate({ request: { segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }], source: 'en', target: 'zh-CN' }, scope: 's1' })
    await atEndpoint // one batch at the endpoint, two waiting behind the single slot
    await holder.activate() // a language pack: the session moves on
    await router.rebind('s1')
    expect(await router.dropTab(1)).toBeGreaterThan(0)
    expect(signal?.aborted).toBe(true)
    release()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(calls).toBe(1)
  })

  it('dropping one tab before dispatch keeps a deduplicated peer alive: the same paragraph requested by two tabs is sent once, for the one still there', async () => {
    // Deduplication needs cache keys (the dedup key is the cache key). The queue items carry the first subscriber's
    // scope only; the second tab is known to the queues' refcount. Refusing by the items' scopes at attempt time
    // aborted the live peer (the local review of ADR-0005, eighteenth pass); the drain is by refcount, and the
    // attempt-time gate looks at the chain only
    let releaseBlocker: () => void = () => {}
    const blocking = new Promise<void>(resolve => { releaseBlocker = resolve })
    const registry = new CancelledScopeRegistry()
    const cache: CachePort = { getMany: async keys => keys.map(() => null), putMany: async () => undefined }
    const paper = { paper: '2410.00260', renderPath: 'tags' as const }
    let calls = 0
    const t = await withChain([mockProvider(async r => { calls++; if (r.segments[0]?.id === 'blocker') await blocking; return { segments: r.segments, provider: 'mock' } }, { maxConcurrent: 1, maxBatchItems: 1 })], { cancelled: registry, cache })
    const blocker = t.translate({ request: { segments: [{ id: 'blocker', text: 'hold' }], source: 'en', target: 'zh-CN' }, scope: 'x', cache: paper })
    await new Promise(resolve => setTimeout(resolve, 200)) // the blocker holds the only slot
    const a = t.translate({ request: req, scope: 'tab-a', cache: paper })
    await new Promise(resolve => setTimeout(resolve, 200)) // a's batch flushed, waiting behind the slot
    const b = t.translate({ request: req, scope: 'tab-b', cache: paper })
    await new Promise(resolve => setTimeout(resolve, 200)) // b joined a's waiting task by its key: the queue knows b, the items do not
    registry.markScope('tab-a') // tab A closed: the router marks, then drains its scope
    await t.cancel('tab-a')
    releaseBlocker()
    expect((await blocker).ok).toBe(true)
    expect(await a).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect((await b).ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('a batch retry does not resurrect a subscriber that died meanwhile: after both tabs closed, no third attempt (ADR-0005, nineteenth review pass)', async () => {
    // Two tabs share a paragraph. The first attempt comes back with the wrong count (the batch queue retries), tab A
    // closes meanwhile; the retry used to re-subscribe A from the frozen batch meta, so when tab B closed during
    // the second attempt the task survived on the dead A and a third attempt reached the endpoint for nobody
    const registry = new CancelledScopeRegistry()
    const cache: CachePort = { getMany: async keys => keys.map(() => null), putMany: async () => undefined }
    const paper = { paper: '2410.00260', renderPath: 'tags' as const }
    const gates: { entered: () => void; release: () => void }[] = []
    const attempt = (n: number) => new Promise<void>(resolve => { gates[n] = { entered: resolve, release: () => undefined } })
    const first = attempt(1)
    const second = attempt(2)
    let releaseFirst: () => void = () => {}
    let releaseSecond: () => void = () => {}
    const holdFirst = new Promise<void>(resolve => { releaseFirst = resolve })
    const holdSecond = new Promise<void>(resolve => { releaseSecond = resolve })
    let calls = 0
    const t = await withChain([mockProvider(async r => {
      calls++
      if (calls === 1) { gates[1]!.entered(); await holdFirst; throw new ProviderError('invalid-response', 'bad shape', { isolatable: true }) } // → a batch retry
      if (calls === 2) { gates[2]!.entered(); await holdSecond; throw attachRequestErrorMeta(new ProviderError('network', 'down'), { isRetryable: true }) } // → request retry
      return { segments: r.segments, provider: 'mock' }
    })], { cancelled: registry, cache, batch: { maxRetries: 1, enableFallbackToIndividual: false } })
    const a = t.translate({ request: req, scope: 'tab-a', cache: paper })
    const b = t.translate({ request: req, scope: 'tab-b', cache: paper })
    await first
    registry.markScope('tab-a') // tab A closes during the first attempt
    await t.cancel('tab-a')
    releaseFirst()
    await second // the batch retry re-subscribed: B only, not the dead A
    registry.markScope('tab-b') // tab B closes during the second attempt
    await t.cancel('tab-b')
    releaseSecond()
    expect(await a).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(await b).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(calls).toBe(2)
  })

  it('the individual fallback keeps each item\'s own subscribers: closing one tab aborts its items while the other tab\'s go on (ADR-0005, twentieth review pass)', async () => {
    // One batch from two tabs (A1, A2 from tab A; B1 from tab B) fails and splits into items. Subscribing every
    // item to the batch's union let tab B keep A1 running and A2 queued after tab A closed
    const registry = new CancelledScopeRegistry()
    const signals = new Map<string, AbortSignal | undefined>()
    let releaseA1: () => void = () => {}
    const holdA1 = new Promise<void>(resolve => { releaseA1 = resolve })
    let a1Entered: () => void = () => {}
    const atA1 = new Promise<void>(resolve => { a1Entered = resolve })
    let calls = 0
    const t = await withChain([mockProvider(async r => {
      calls++
      if (r.segments.length > 1) throw new ProviderError('invalid-response', 'bad shape', { isolatable: true }) // the batch fails, the items go one by one
      signals.set(r.segments[0]!.id, r.signal)
      if (r.segments[0]!.id === 'a1') { a1Entered(); await holdA1 }
      return { segments: r.segments, provider: 'mock' }
    }, { maxConcurrent: 1 })], { cancelled: registry, batch: { maxRetries: 0, batchDelay: 20 } })
    const a = t.translate({ request: { segments: [{ id: 'a1', text: 'one' }, { id: 'a2', text: 'two' }], source: 'en', target: 'zh-CN' }, scope: 'tab-a' })
    const b = t.translate({ request: { segments: [{ id: 'b1', text: 'three' }], source: 'en', target: 'zh-CN' }, scope: 'tab-b' })
    await atA1 // the batch failed; A1 is at the endpoint, A2 and B1 wait behind the single slot
    registry.markScope('tab-a') // tab A closes
    await t.cancel('tab-a')
    expect(signals.get('a1')?.aborted).toBe(true)
    releaseA1()
    expect(await a).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect((await b).ok).toBe(true)
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(signals.has('a2')).toBe(false) // never sent
    expect(calls).toBe(3) // the batch, A1, B1
  })

  it('router and chain together: a tab closed while the first chain builds leaves no request out and nothing bound (ADR-0005, second review pass)', async () => {
    // The scope's first request arrived on a fresh worker (the chain still building) and the reader closed the
    // tab before it finished: the request must come back aborted, the provider untouched, the session unbound
    const calls: string[] = []
    const registry = new CancelledScopeRegistry()
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const router = createSessionRouter({
      current: async () => { await held; return withChain([mockProvider(async r => { calls.push('call'); return { segments: r.segments, provider: 'mock' } })], { cancelled: registry }) },
      cancelled: registry,
    })
    const pending = router.forCall('s1', 7).then(t => t.translate({ request: req, scope: 's1' }))
    await Promise.resolve()
    await router.dropTab(7)
    release()
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
    expect(calls).toEqual([])
    expect(router.bound()).toEqual([])
  })
})

describe('createLocalTransport: status', () => {
  const engine = (id: string, available: boolean): TranslationProvider => ({
    id,
    kind: 'mt',
    wireFormats: ['tags'] as const,
    maxBatchChars: 1000,
    maxBatchItems: 4,
    isAvailable: async () => available,
    translate: async () => ({ segments: [], provider: id }),
  })

  it('with the first choice available no demotion is reported, and the capability fields are the first choice\'s', async () => {
    const t = await withChain([engine(SVC.id, true), engine('google-web', true)])
    expect(await t.status()).toEqual({
      providerId: SVC.id,
      chosen: SVC.id,
      revision: expect.stringMatching(/^[0-9a-f]{16}$/),
      available: true,
      model: SVC.model,
      maxBatchChars: 1000,
      maxBatchItems: 4,
      renderPath: 'tags',
      targetLanguage: 'cmn',
      promptId: 'default',
      chain: [SVC.id, 'google-web'],
      demotions: [],
      engine: { id: SVC.id },
    })
  })

  it('a saved service id naming nothing: the status says which service was chosen and which engine it resolved to, so the toggle can tell them apart (S2 review)', async () => {
    // The chain head is whatever the saved id resolved to (a built-in, from getProvider's default); the status keeps the saved id beside it
    const engine = mockProvider(async r => ({ segments: r.segments, provider: 'mock' }), { id: 'microsoft' })
    const transport = await createLocalTransport({ ...DEFAULT_CONFIG, provider: 'svc-deleted-elsewhere', services: [] }, { cancelled: new CancelledScopeRegistry(), buildChain: async () => ({ chain: [engine], renderPath: 'tags' as const }) })
    const status = await transport.status()
    expect(status.chosen).toBe('svc-deleted-elsewhere')
    expect(status.providerId).toBe('microsoft')
  })

  it('with the first choice unavailable but a fallback on the chain it is reported: the popup keeps “Translate” clickable by it (Codex on #50)', async () => {
    const t = await withChain([engine('chrome-builtin', false), engine('google-web', true)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toEqual({ id: 'google-web' })
  })

  it('with the whole chain unavailable no demotion is reported: the button should be grey then', async () => {
    const t = await withChain([engine(SVC.id, false), engine('google-web', false)])
    expect((await t.status()).fallback).toBeUndefined()
  })

  it('with a single engine no demotion is reported either', async () => {
    const t = await withChain([engine(SVC.id, false)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toBeUndefined()
    expect(r.chain).toEqual([SVC.id])
  })

  it('after a demotion status reports the engine actually in use and the reason (§8.5)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = { ...engine(SVC.id, true), translate: async () => { throw new ProviderError('auth', 'bad key') } }
    const ok = { ...engine('google-web', true), translate: async (r: TranslateRequest) => ({ segments: r.segments, provider: 'google-web' }) }
    const t = await withChain([failing, ok])
    expect((await t.status()).engine).toEqual({ id: SVC.id })
    expect((await t.translate({ request: req })).ok).toBe(true)
    expect((await t.status()).engine).toEqual({
      id: 'google-web',

      demoted: { id: SVC.id, kind: 'auth', message: 'bad key' },
    })
  })
})

// Dexie + fake-indexeddb schedule on real timers; this group cannot use fake timers
describe('createLocalTransport: the cache', () => {
  let n = 0
  const cacheOf = () => new TranslationCache({ db: createCacheDb(`axt-transport-${++n}`, { indexedDB, IDBKeyRange }) })
  const echo = (calls: string[][]) => mockProvider(async r => {
    calls.push(r.segments.map(s => s.id))
    return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock', model: 'm' }
  })
  const withCache = { paper: '2410.00260', renderPath: 'tags' as const }
  const two: TranslateRequest = { segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], source: 'en', target: 'zh-CN' }

  it('the first time all miss and are written to the cache; the second time all hit and the provider is not called', async () => {
    const calls: string[][] = []
    const t = await withChain([echo(calls)], { cache: portOf(cacheOf()) })
    const first = await t.translate({ request: two, cache: withCache })
    expect(first).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock' }, cached: 0 })
    const second = await t.translate({ request: two, cache: withCache })
    expect(second).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock' }, cached: 2 })
    expect(calls).toEqual([['a', 'b']])
  })

  it('a partial hit sends only the missed segments, merged back in the original order', async () => {
    const calls: string[][] = []
    const t = await withChain([echo(calls)], { cache: portOf(cacheOf()) })
    await t.translate({ request: { ...two, segments: [{ id: 'b', text: 'y' }] }, cache: withCache })
    const res = await t.translate({ request: { ...two, segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] }, cache: withCache })
    expect(res.ok && res.cached).toBe(1)
    expect(res.ok && res.result.segments.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(calls).toEqual([['b'], ['a', 'c']])
  })

  it('a request without cache neither reads nor writes the cache (the settings page\'s connection test)', async () => {
    const calls: string[][] = []
    const cache = cacheOf()
    const t = await withChain([echo(calls)], { cache: portOf(cache) })
    await t.translate({ request: two })
    await t.translate({ request: two })
    expect(calls).toHaveLength(2)
    expect((await cache.stats()).entries).toBe(0)
  })
})

describe('chainConfigChanged: which configuration changes rebuild the chain', () => {
  it('every configuration field is classified explicitly, and the two tables together cover Config exactly', () => {
    expect([...CHAIN_CONFIG_FIELDS, ...VOLATILE_CONFIG_FIELDS].sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort())
  })

  it('switching the display mode, style, preload or glossary does not rebuild: the page is often translating then, and a rebuild would clear the token buckets and the demotion records', () => {
    const base = DEFAULT_CONFIG
    expect(chainConfigChanged(base, { ...base, mode: 'side' })).toBe(false)
    expect(chainConfigChanged(base, { ...base, appearance: { ...base.appearance, activeStyle: 'green' } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, preload: { margin: 42, threshold: 0.5 } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, glossary: [{ term: 'token', translation: '词元' }] })).toBe(false)
    // The image translation's mode gate (§15) is only a display gate; a reader unticking a mode mid-translation must not clear the queue
    expect(chainConfigChanged(base, { ...base, image: { enabled: true, modes: ['side'] } })).toBe(false)
  })

  it('a changed engine, endpoint, model, key, target language, prompt or fallback switch rebuilds', () => {
    const base = DEFAULT_CONFIG
    const cases: Config[] = [
      { ...base, provider: 'google-web' },
      { ...base, services: [SVC] },
      { ...base, provider: SVC.id, services: [{ ...SVC, baseURL: 'https://other.example/v1' }] },
      { ...base, provider: SVC.id, services: [{ ...SVC, model: 'other-model' }] },
      { ...base, provider: SVC.id, services: [{ ...SVC, apiKey: 'sk-new' }] },
      { ...base, provider: SVC.id, services: [{ ...SVC, thinking: 'enabled' }] },
      { ...base, targetLanguage: 'jpn' },
      { ...base, prompts: { ...base.prompts, promptId: 'other' } },
      { ...base, prompts: { ...base.prompts, patterns: [{ id: 'p', name: 'p', systemPrompt: 's', prompt: 'u' }] } },
      { ...base, fallback: { enabled: false } },
    ]
    for (const next of cases) expect([next, chainConfigChanged(base, next)]).toEqual([next, true])
  })

  it('a new object with equal values is no change: storage gives a freshly parsed result on every watch', () => {
    expect(chainConfigChanged(DEFAULT_CONFIG, structuredClone(DEFAULT_CONFIG))).toBe(false)
  })
})

describe('chainRevision (INVENTORY S8: the identity of the settings a chain is built from)', () => {
  const base: Config = { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] }

  it('is the same for the same chain settings — across builds, and whatever order the fields come back in', async () => {
    const a = await chainRevision(base)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    // A worker restart rebuilds the chain from the same settings: that is not a change the page is behind
    expect(await chainRevision({ ...base })).toBe(a)
    const reordered = { ...base, services: [{ thinking: SVC.thinking, model: SVC.model, apiKey: SVC.apiKey, baseURL: SVC.baseURL, name: SVC.name, kind: SVC.kind, id: SVC.id }] } as Config
    expect(await chainRevision(reordered)).toBe(a)
  })

  it('changes with every chain field — the key, the model, the prompt, the target, the fallback, the service — and with none of the volatile ones', async () => {
    const a = await chainRevision(base)
    const changes: Partial<Config>[] = [
      { services: [{ ...SVC, apiKey: 'sk-y' }] },
      { services: [{ ...SVC, model: 'x/z' }] },
      { prompts: { ...base.prompts, promptId: 'other' } },
      { targetLanguage: 'jpn' as Config['targetLanguage'] },
      { fallback: { ...base.fallback, enabled: !base.fallback.enabled } },
      { provider: 'microsoft' },
    ]
    for (const change of changes) expect(await chainRevision({ ...base, ...change }), Object.keys(change).join()).not.toBe(a)
    for (const field of VOLATILE_CONFIG_FIELDS) {
      expect(await chainRevision({ ...base, [field]: { changed: true } } as unknown as Config), field).toBe(a)
    }
  })
})
