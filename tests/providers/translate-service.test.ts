import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RenderPath } from '@/cache/key'
import { BatchCountMismatchError } from '@/providers/request/batch-queue'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import type { CachedEntry } from '@/cache/store'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import { createTranslateService, toErrorInfo, type CacheEntry, type CachePort, type TranslateServiceDeps } from '@/providers/translate-service'
import { ProviderError, type TranslationProvider } from '@/providers/types'

const provider = (translate: TranslationProvider['translate'], id = 'mock', extra: Partial<TranslationProvider> = {}): TranslationProvider => ({
  id, displayName: id, kind: 'llm', wireFormats: ['tags'] as const,
  maxBatchChars: 1000, maxBatchItems: 4,
  isAvailable: async () => true, translate,
  ...extra,
})

/** A service over a registry of its own; the cancellation test passes the one it marks */
const build = (deps: Omit<TranslateServiceDeps, 'cancelled'> & Partial<Pick<TranslateServiceDeps, 'cancelled'>>) =>
  createTranslateService({ cancelled: new CancelledScopeRegistry(), ...deps })

/** A fake cache port that records its calls */
function fakePort(seed: Record<string, string> = {}) {
  const store = new Map<string, CachedEntry>(Object.entries(seed).map(([k, v]) => [k, { translation: v }]))
  const reads: string[][] = []
  const writes: CacheEntry[][] = []
  const port: CachePort = {
    async getMany(keys) { reads.push(keys); return keys.map(k => store.get(k) ?? null) },
    async putMany(entries) {
      writes.push(entries)
      for (const e of entries) store.set(e.key, e.alignment ? { translation: e.translation, alignment: e.alignment } : { translation: e.translation })
    },
  }
  return { port, reads, writes, store }
}

const req = (ids: string[]) => ({
  request: { segments: ids.map(id => ({ id, text: `text-${id}` })), source: 'en' as const, target: 'zh-CN' },
  cache: { paper: '2410.00260', renderPath: 'tags' as RenderPath },
})

const rateLimited = () => attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('sentence alignment through the queue (#105)', () => {
  const withAlignment = (aligned: Record<string, { source: number[]; target: number[] }>) =>
    provider(async r => ({
      segments: r.segments.map(s => (aligned[s.id] ? { id: s.id, text: `译:${s.text}`, alignment: aligned[s.id] } : { id: s.id, text: `译:${s.text}` })),
      provider: 'mock',
    }))

  it('carries the alignment from the provider out to the caller', async () => {
    // The queue was string-valued, so the alignment reached the type at the message boundary but
    // the data was dropped on the way. This is the test that the value actually crosses.
    const { port } = fakePort()
    const service = build({
      getProvider: async () => withAlignment({ a: { source: [3, 3], target: [4, 4] } }),
      cache: port,
    })
    const res = await service.translate(req(['a', 'b']))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.segments.map(s => s.alignment)).toEqual([{ source: [3, 3], target: [4, 4] }, undefined])
  })

  it('keeps each segment’s own alignment when a batch mixes aligned and unaligned', async () => {
    const { port } = fakePort()
    const service = build({
      getProvider: async () => withAlignment({ a: { source: [6], target: [8] }, c: { source: [6], target: [8] } }),
      cache: port,
    })
    const res = await service.translate(req(['a', 'b', 'c']))
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.result.segments.map(s => [s.id, s.alignment])).toEqual([
      ['a', { source: [6], target: [8] }],
      ['b', undefined],
      ['c', { source: [6], target: [8] }],
    ])
  })

  it('a cache hit brings its alignment back', async () => {
    const { port, store } = fakePort()
    const service = build({
      getProvider: async () => withAlignment({ a: { source: [6], target: [8] } }),
      cache: port,
    })
    const first = await service.translate(req(['a']))
    expect(first.ok && first.result.segments[0]?.alignment).toEqual({ source: [6], target: [8] })
    expect(store.size).toBe(1)

    const second = await service.translate(req(['a']))
    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.cached).toBe(1)
    expect(second.result.segments[0]?.text).toBe('译:text-a')
    expect(second.result.segments[0]?.alignment).toEqual({ source: [6], target: [8] })
  })

  it('drops a cached alignment that no longer reconstructs the texts', async () => {
    // The source text only exists at this point, so a key collision or a changed source is caught
    // here rather than putting the highlight on the wrong sentence.
    const { port, store } = fakePort()
    const service = build({ getProvider: async () => withAlignment({}), cache: port })
    const first = await service.translate(req(['a']))
    expect(first.ok).toBe(true)
    const [key] = [...store.keys()]
    // Forge a record whose cut does not match
    store.set(key!, { translation: '译:text-a', alignment: { source: [999], target: [1] } })
    const second = await service.translate(req(['a']))
    expect(second.ok && second.cached).toBe(1)
    expect(second.ok && second.result.segments[0]?.alignment).toBeUndefined()
    expect(second.ok && second.result.segments[0]?.text).toBe('译:text-a')
  })
})

describe('createTranslateService', () => {
  it('cache reads and writes are one batched call each, not one per segment; the segments of one call are accumulated into one batch for the provider', async () => {
    const { port, reads, writes } = fakePort()
    const calls: string[][] = []
    const service = build({
      getProvider: async () => provider(async r => { calls.push(r.segments.map(s => s.id)); return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' } }),
      getModel: async () => 'm/1',
      cache: port,
    })
    const res = await service.translate(req(['a', 'b', 'c']))
    expect(res.ok).toBe(true)
    expect(reads).toHaveLength(1)
    expect(reads[0]).toHaveLength(3)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toHaveLength(3)
    expect(calls).toEqual([['a', 'b', 'c']])
  })

  it('segments that hit are no longer sent to the provider, and the result is merged back in the original order', async () => {
    const { port } = fakePort()
    const calls: string[][] = []
    const service = build({
      getProvider: async () => provider(async r => { calls.push(r.segments.map(s => s.id)); return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' } }),
      getModel: async () => 'm/1',
      cache: port,
    })
    await service.translate(req(['a', 'b']))
    const second = await service.translate(req(['a', 'b', 'c']))
    expect(calls).toEqual([['a', 'b'], ['c']])
    expect(second.ok && second.cached).toBe(2)
    expect(second.ok && second.result.segments.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(second.ok && second.result.segments[2]?.text).toBe('译:text-c')
    expect(second.ok && second.result.model).toBe('m/1')
  })

  it('without the cache field the cache is not touched at all (the settings page\'s connection test)', async () => {
    const { port, reads, writes } = fakePort()
    const service = build({
      getProvider: async () => provider(async r => ({ segments: r.segments, provider: 'mock' })),
      cache: port,
    })
    const res = await service.translate({ request: { segments: [{ id: 'x', text: 'hi' }], source: 'en', target: 'zh-CN' } })
    expect(res.ok).toBe(true)
    expect(reads).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('after auth this engine no longer hits the endpoint this round: blocks arriving later are refused on the spot, no second wave (issue #96)', async () => {
    // `failQueue` drains the tasks queued in the RequestQueue **at that moment**. With the concurrency slots full the waiting area happens to be empty,
    // and the remaining blocks are still accumulating in the BatchQueue, dispatched as usual once full — measured: 7 more requests went out +744 ms after the first 401
    let calls = 0
    const service = build({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }),
    })
    expect(await service.translate({ ...req(['a']), scope: 's1' })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key', isolatable: false } })
    expect(calls).toBe(1)
    // Blocks arriving later (viewport scroll, a batch filled up): report auth likewise, but no longer ask the endpoint
    expect(await service.translate({ ...req(['b', 'c']), scope: 's1' })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key', isolatable: false } })
    expect(calls).toBe(1)
    // Another session (a new page, or the reader retranslating after fixing the key) has to try again: fatal is this round's matter, not the engine's
    await service.translate({ ...req(['d']), scope: 's2' })
    expect(calls).toBe(2)
    // A call without scope (the settings page's “Test connection”) is unaffected by any session's fatal state
    await service.translate(req(['e']))
    expect(calls).toBe(3)
  })

  it('when deduplication merges two sessions into one task both scopes have to be recorded (Codex on #113)', async () => {
    // Two tabs translating the same passage of the same paper: BatchQueue / RequestQueue merge by dedupKey,
    // and the executing side sees only the QueueItem that arrived first. Recorded on the execution path the second scope is missed,
    // its later batches still go out, and the second wave is back
    let calls = 0
    const { port } = fakePort()
    const service = build({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }),
      cache: port,
    })
    const [a, b] = await Promise.all([
      service.translate({ ...req(['x']), scope: 'tabA' }),
      service.translate({ ...req(['x']), scope: 'tabB' }),
    ])
    expect([a.ok, b.ok]).toEqual([false, false])
    const afterFirst = calls
    // Neither session's later blocks may ask the endpoint again
    await service.translate({ ...req(['y']), scope: 'tabA' })
    await service.translate({ ...req(['z']), scope: 'tabB' })
    expect(calls).toBe(afterFirst)
  })

  it('“a full batch + an underfull tail” in one call: after the full batch fails the tail must not go out (Codex on #113)', async () => {
    // The line count of an image OCR is not bound by the provider's maxBatchItems, so one call is split into full batches + a tail.
    // A full batch is dispatched at once by count and fails in a second, while the tail still waits for batchDelay. Recording the state only after allSettled,
    // it would first have to wait the tail out — and the tail fails only once **sent**
    let calls = 0
    const service = build({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }, 'mock', { maxBatchItems: 2 }),
    })
    const res = await service.translate({ ...req(['a', 'b', 'c', 'd', 'e']), scope: 's1' })
    expect(res.ok).toBe(false)
    // 5 segments / 2 per batch = full + full + tail. The two full batches are dispatched by count in the same tick and cannot be stopped
    // (as when the 8 concurrency slots are full); what has to be blocked is the tail still accumulating — it must not become a third request
    expect(calls).toBe(2)
  })

  it('a new session merged into an already fatal session\'s batch: that batch is sent as usual (Codex on #113)', async () => {
    // Deduplication merges by cache key: the QueueItem kept carries the old (already fatal) scope, and the new session appears in meta.scopes only.
    // Looking at item.scope alone would reject this batch as dead, hand the stale auth back to the new caller, and mark the new scope fatal too
    let calls = 0
    const { port } = fakePort()
    const service = build({
      getProvider: async () => provider(async r => {
        calls++
        if (calls === 1) throw new ProviderError('auth', 'bad key')
        return { segments: r.segments.map(s => ({ ...s, text: '译' })), provider: 'mock' }
      }),
      cache: port,
    })
    // First make s1 fatal
    expect((await service.translate({ ...req(['a']), scope: 's1' })).ok).toBe(false)
    // s1 and s2 send the same segment in the same tick: accumulated into one batch, meta.scopes = [s1, s2]
    const [dead, live] = await Promise.all([
      service.translate({ ...req(['b']), scope: 's1' }),
      service.translate({ ...req(['b']), scope: 's2' }),
    ])
    // With a live subscriber still in the batch it must not be rejected as dead
    expect(live.ok && live.result.segments[0]?.text).toBe('译')
    expect(dead.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('only no-key / auth stick: other errors must not void the whole round of translation', () => {
    // The same judgement as fallback.ts's PERMANENT_KINDS. bad-request is “this batch's problem”,
    // another batch may well be fine, and sticking to it would give up the whole paper over one bad block
    let calls = 0
    const service = build({
      getProvider: async () => provider(async () => {
        calls++
        if (calls === 1) throw new ProviderError('bad-request', '400')
        return { segments: [{ id: 'b', text: '译' }], provider: 'mock' }
      }),
    })
    return service.translate(req(['a'])).then(async first => {
      expect(first.ok).toBe(false)
      const second = await service.translate(req(['b']))
      expect(second.ok && second.result.segments[0]?.text).toBe('译')
      expect(calls).toBe(2)
    })
  })

  it('a provider that throws becomes an error response, not a throw; auth is not retried', async () => {
    let calls = 0
    const service = build({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }),
    })
    expect(await service.translate(req(['a']))).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key', isolatable: false } })
    expect(calls).toBe(1)
  })

  it('a failed cache read does not affect translation (the port degrades to a miss on its own)', async () => {
    const port: CachePort = { getMany: async keys => keys.map(() => null), putMany: vi.fn(async () => {}) }
    const service = build({
      getProvider: async () => provider(async r => ({ segments: r.segments.map(s => ({ ...s, text: '译' })), provider: 'mock' })),
      cache: port,
    })
    const res = await service.translate(req(['a']))
    expect(res.ok && res.cached).toBe(0)
    expect(port.putMany).toHaveBeenCalled()
  })

  it('cache.bypass: write only, no read, so a resend does not get the bad translation back from the cache (Codex on #9)', async () => {
    const { port, reads, writes } = fakePort()
    let calls = 0
    const service = build({
      getProvider: async () => provider(async r => { calls++; return { segments: r.segments.map(s => ({ ...s, text: `译${calls}:${s.text}` })), provider: 'mock' } }),
      getModel: async () => 'm/1',
      cache: port,
    })
    await service.translate(req(['a']))
    const again = await service.translate({ ...req(['a']), cache: { paper: '2410.00260', renderPath: 'tags', bypass: true } })
    expect(calls).toBe(2)
    expect(reads).toHaveLength(1)
    expect(writes).toHaveLength(2)
    expect(again.ok && again.result.segments[0]?.text).toBe('译2:text-a')
    // After the overwrite an ordinary request hits the new translation
    const third = await service.translate(req(['a']))
    expect(calls).toBe(2)
    expect(third.ok && third.result.segments[0]?.text).toBe('译2:text-a')
  })

  it('a translation that fails the placeholder check is returned as usual but not written to the cache (Codex on #30)', async () => {
    // The expectations are inferred from the request text, no longer an accept callback from the caller (issue #42): a's translation lost <x id="1"/>
    const { port, writes } = fakePort()
    const service = build({
      getProvider: async () => provider(async r => ({
        segments: r.segments.map(s => ({ ...s, text: s.id === 'a' ? '译文丢了占位符' : `译:${s.text}` })),
        provider: 'mock',
      })),
      cache: port,
    })
    const call = req(['a', 'b'])
    call.request.segments = [
      { id: 'a', text: '公式 <x id="1"/> 见 <t id="2">此处</t>。' },
      { id: 'b', text: '公式 <x id="1"/>。' },
    ]
    const res = await service.translate(call)
    expect(res.ok && res.result.segments.map(s => s.id)).toEqual(['a', 'b'])
    expect(writes).toHaveLength(1)
    expect(writes[0]!.map(w => w.translation)).toEqual(['译:公式 <x id="1"/>。'])
  })

  it('the markers path\'s check dispatches by renderPath: scanning with the tags tokenizer would recognise not one placeholder (#104)', async () => {
    // The hole most easily missed in this change: if expectationsFromText does not dispatch by format, slots is empty → the check is always true →
    // a mangled translation enters the cache silently. b's translation is complete, a lost a marker; only b may be stored
    const { port, writes } = fakePort()
    const service = build({
      getProvider: async () => provider(async r => ({
        segments: r.segments.map(s => ({ ...s, text: s.id === 'a' ? '译文丢了记号' : `译:${s.text}` })),
        provider: 'mock',
      })),
      cache: port,
    })
    const call = req(['a', 'b'])
    call.cache = { paper: '2410.00260', renderPath: 'markers' }
    call.request.segments = [
      { id: 'a', text: '公式 @a# 见此处。' },
      { id: 'b', text: '公式 @a#。' },
    ]
    const res = await service.translate(call)
    expect(res.ok && res.result.segments.map(s => s.id)).toEqual(['a', 'b'])
    expect(writes).toHaveLength(1)
    expect(writes[0]!.map(w => w.translation)).toEqual(['译:公式 @a#。'])
  })

  it('the inferred expectations apply to plain text too: a runs-path translation that grows a tag from nowhere is not stored either', async () => {
    const { port, writes } = fakePort()
    const service = build({
      getProvider: async () => provider(async r => ({
        segments: r.segments.map(s => ({ ...s, text: s.id === 'a' ? '译文 <x id="7"/>' : `译:${s.text}` })),
        provider: 'mock',
      })),
      cache: port,
    })
    const res = await service.translate({ ...req(['a', 'b']), cache: { paper: '2410.00260', renderPath: 'runs' } })
    expect(res.ok && res.result.segments.map(s => s.text)).toEqual(['译文 <x id="7"/>', '译:text-b'])
    expect(writes[0]!.map(w => w.translation)).toEqual(['译:text-b'])
  })

  it('one call spanning two batches, one failing: the succeeding batch is still written to the cache, and the call as a whole reports failure', async () => {
    const { port, writes } = fakePort()
    const service = build({
      // At most 2 per batch: a and b in one, c in another; the batch with c errors
      getProvider: async () => provider(async r => {
        if (r.segments.some(s => s.id === 'c')) throw new ProviderError('invalid-response', 'bad')
        return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }
      }, 'mock', { maxBatchItems: 2 }),
      cache: port,
      batch: { maxRetries: 0, enableFallbackToIndividual: false },
    })
    const res = await service.translate(req(['a', 'b', 'c']))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('invalid-response')
    expect(writes.flat().map(w => w.translation)).toEqual(['译:text-a', '译:text-b'])
    // Writing to the cache is not enough; the two that succeeded have to go back to the caller with the failure: otherwise run.ts marks the whole batch failed,
    // the reader sees “all failed”, and on retry they come back from the cache in a second (Codex on #163)
    if (!res.ok) expect(res.partial?.map(p => `${p.id}=${p.text}`)).toEqual(['a=译:text-a', 'b=译:text-b'])
  })

  it('ids do not match: BatchQueue retries the whole batch and then falls back one by one; RequestQueue itself does not retry (or it would hit 12 times before the fallback)', async () => {
    const seen: string[][] = []
    const service = build({
      getProvider: async () => provider(async r => {
        seen.push(r.segments.map(s => s.id))
        if (r.segments.length > 1) throw new ProviderError('invalid-response', 'ids do not match')
        return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }
      }),
      batch: { maxRetries: 1 },
      queue: { baseRetryDelayMs: 0 },
    })
    const res = await service.translate(req(['a', 'b']))
    expect(res.ok).toBe(true)
    // The whole batch once + 1 retry + 2 one by one
    expect(seen).toEqual([['a', 'b'], ['a', 'b'], ['a'], ['b']])
  })
})

describe('batching looks not at the engine\'s kind but at how much it holds (§8.3, 2026-09-06)', () => {
  /** Records which segments the provider really received each time */
  const recorder = (extra: Partial<TranslationProvider> = {}) => {
    const calls: string[][] = []
    return {
      calls,
      provider: provider(async r => {
        calls.push(r.segments.map(s => s.id))
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', extra),
    }
  }
  const withContext = (ids: string[], sectionTitle: string) => ({
    request: { segments: ids.map(id => ({ id, text: `text-${id}` })), source: 'en' as const, target: 'zh-CN', context: { paperTitle: 'P', sectionTitle } },
  })

  it('several calls to a free engine (kind: mt) accumulate into one request: before, only LLMs batched, and it made one request per call', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 100, maxBatchChars: 8000 })
    const service = build({ getProvider: async () => mt })
    const all = Promise.all([service.translate(req(['a'])), service.translate(req(['b'])), service.translate(req(['c']))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b', 'c']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('accumulate as much as fits: what exceeds maxBatchItems starts another batch', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 2, maxBatchChars: 8000 })
    const service = build({ getProvider: async () => mt })
    const all = Promise.all(['a', 'b', 'c'].map(id => service.translate(req([id]))))
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b'], ['c']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('for an engine that reads no context the section title stays out of the batch key: otherwise every section change changes the key, and batching cannot cross sections', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 100, maxBatchChars: 8000 })
    const service = build({ getProvider: async () => mt })
    const all = Promise.all([service.translate(withContext(['a'], '第一节')), service.translate(withContext(['b'], '第二节'))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('an engine with a prompt still batches by context: the section title enters the prompt, and a mixed batch would bleed', async () => {
    vi.useFakeTimers()
    const { calls, provider: llm } = recorder({ kind: 'llm', maxBatchItems: 100, maxBatchChars: 8000, promptKey: 'default' })
    const service = build({ getProvider: async () => llm })
    const all = Promise.all([service.translate(withContext(['a'], '第一节')), service.translate(withContext(['b'], '第二节'))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls.map(c => c.join()).sort()).toEqual(['a', 'b'])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('the provider\'s declared maxConcurrent applies: the concurrency gate and the token bucket are two different gates', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    // The rate opened up (20/s, burst 20), only the concurrency gate holds: no more than 2 in flight at once
    const mt = provider(async r => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return { segments: r.segments, provider: 'mock' }
    }, 'mock', { kind: 'mt', maxBatchItems: 1, rateLimit: { rate: 20, capacity: 20 }, maxConcurrent: 2 })
    const service = build({ getProvider: async () => mt })
    const all = Promise.all(['a', 'b', 'c', 'd'].map(id => service.translate(req([id]))))
    await vi.advanceTimersByTimeAsync(500)
    expect(peak).toBe(2)
    expect(release).toHaveLength(2)
    for (const fn of [...release]) fn()
    await vi.advanceTimersByTimeAsync(100)
    expect(release.length).toBeGreaterThan(2)
    for (const fn of [...release]) fn()
    await vi.advanceTimersByTimeAsync(100)
    expect(peak).toBe(2)
    expect((await all).every(r => r.ok)).toBe(true)
  })
})

describe('a systemic failure must not be multiplied by batch-level retries (Codex on #61)', () => {
  const callOf = (n: number) => ({
    request: { segments: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, text: `text-${i}` })), source: 'en' as const, target: 'zh-CN' },
  })

  it('an invalid-response declared isolatable: false is reported at once, no retry and no one-by-one fallback', async () => {
    let calls = 0
    const service = build({
      getProvider: async () => provider(async () => {
        calls++
        // The free engine's whole reply is not JSON: the same however small the split
        throw new ProviderError('invalid-response', 'the reply is not JSON', { isolatable: false })
      }, 'mock', { kind: 'mt', maxBatchItems: 100 }),
    })
    const res = await service.translate(callOf(8))
    expect(res).toMatchObject({ ok: false, error: { kind: 'invalid-response' } })
    // Once is enough: converted to a batch error it would be 1 + 3 retries + 8 one by one = 12
    expect(calls).toBe(1)
  })

  it('an isolatable invalid-response retries and falls back one by one as before: a smaller split can locate the offending segment', async () => {
    let calls = 0
    const service = build({
      getProvider: async () => provider(async r => {
        calls++
        // Broken only when several go together; a single segment is fine
        if (r.segments.length > 1) throw new ProviderError('invalid-response', 'ids do not match')
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', { kind: 'llm', maxBatchItems: 100 }),
      batch: { maxRetries: 1 },
    })
    const res = await service.translate(callOf(3))
    expect(res.ok).toBe(true)
    // The first + 1 retry + 3 one by one
    expect(calls).toBe(5)
  })
})

describe('createTranslateService: rate limiting, timeouts, cancellation (fake timers)', () => {
  const log = () => {
    const calls: { id: string; t: number }[] = []
    return { calls, note: (ids: string[]) => calls.push({ id: ids.join('+'), t: Date.now() }) }
  }

  it('429: within the pause window later requests are not sent; after it one token remains, first come first sent by scheduleAt, the rest released at the rate (Codex on #6 / #10 / #30)', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { calls, note } = log()
    let first = true
    const service = build({
      getProvider: async () => provider(async r => {
        note(r.segments.map(s => s.id))
        if (first) { first = false; throw rateLimited() }
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', { rateLimit: { rate: 1, capacity: 1 } }),
    })
    const a = service.translate(req(['a']))
    await vi.advanceTimersByTimeAsync(100)
    expect(calls.map(c => c.id)).toEqual(['a'])
    const b = service.translate(req(['b']))
    // Base pause 5s: within 4.9s b cannot be sent
    await vi.advanceTimersByTimeAsync(4_900)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(300)
    // The pause ends (base 5s, Math.random pinned to 0, no jitter): during the pause the bucket refills at the rate (capacity 1).
    // b's batch was held by the dispatch gate throughout (no free slot during the pause, it keeps accumulating), so the queue holds only a's retry, which uses that token first
    expect(calls.map(c => c.id)).toEqual(['a', 'a'])
    // The gate probes once a second; after b flushes it waits for the next token: at least one token period after a's retry
    for (let i = 0; i < 50 && calls.length < 3; i++) await vi.advanceTimersByTimeAsync(100)
    expect(calls.map(c => c.id)).toEqual(['a', 'a', 'b'])
    expect(calls[2]!.t - calls[1]!.t).toBeGreaterThanOrEqual(1_000)
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok && rb.ok).toBe(true)
  })

  it('two hit 429 at once: one pause window, nobody sends within it, both resend successfully after it', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { calls, note } = log()
    let hits = 0
    const service = build({
      getProvider: async () => provider(async r => {
        note(r.segments.map(s => s.id))
        if (hits++ < 2) throw rateLimited()
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', { maxBatchItems: 1, rateLimit: { rate: 1, capacity: 2 } }),
    })
    const a = service.translate(req(['a']))
    const b = service.translate(req(['b']))
    await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(2)
    // Within the base 5s window neither is resent
    await vi.advanceTimersByTimeAsync(4_900)
    expect(calls).toHaveLength(2)
    // After the window (the second 429 may have extended it) both are resent: during the pause the bucket refilled to capacity 2, both released together
    for (let i = 0; i < 120 && calls.length < 4; i++) await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(4)
    expect(calls[2]!.t - calls[0]!.t).toBeGreaterThanOrEqual(5_000)
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok && rb.ok).toBe(true)
  })

  it('a provider that hangs without returning: the timeout computed from the character count fires and retries, and with retries exhausted it becomes a timeout error response rather than waiting for ever', async () => {
    // Measured on 2312.17527: the last block waited 220s without a reply, and the whole paper stayed “in progress”
    vi.useFakeTimers()
    let calls = 0
    const service = build({
      getProvider: async () => provider(() => { calls++; return new Promise(() => {}) }), // // neither honours the signal nor returns
      queue: { timeoutMs: 20, maxRetries: 1, baseRetryDelayMs: 0 },
    })
    const pending = service.translate({ request: { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh' } })
    await vi.advanceTimersByTimeAsync(10_000)
    const res = await pending
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('timeout')
    expect(calls).toBe(2) // // the first + one retry
  })

  it('cancel(scope) drains queued and in-flight requests — the signal aborts, nothing is cached; a scope the registry holds is refused next time', async () => {
    // Real timers: the cache key goes through crypto.subtle, which never returns under fake timers
    const { port, writes } = fakePort()
    let signal: AbortSignal | undefined
    let calls = 0
    const registry = new CancelledScopeRegistry()
    const service = build({
      getProvider: async () => provider(async r => {
        calls++
        signal = r.signal
        await new Promise(() => {}) // hang until cancelled
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', { maxBatchItems: 1 }),
      cache: port,
      cancelled: registry,
    })
    const a = service.translate({ ...req(['a']), scope: 'run-1' })
    await vi.waitFor(() => expect(calls).toBe(1))
    // The way the router drops: mark, then drain
    registry.markScope('run-1')
    expect(service.cancel('run-1')).toBeGreaterThan(0)
    expect(signal?.aborted).toBe(true)
    const ra = await a
    expect(ra.ok).toBe(false)
    if (!ra.ok) expect(ra.error.kind).toBe('aborted')
    expect(writes).toHaveLength(0)
    const later = await service.translate({ ...req(['b']), scope: 'run-1' })
    expect(later.ok).toBe(false)
    if (!later.ok) expect(later.error.kind).toBe('aborted')
    expect(calls).toBe(1)
  })
})

describe('sentence markers: inserted by the service layer when the engine reports no sentence boundaries (§8.6)', () => {
  /** A fake engine that keeps the markers of the text it receives and swaps English for Chinese — exactly Google's behaviour */
  const echoing = (transform: (text: string) => string, extra: Partial<TranslationProvider> = {}) =>
    provider(async ({ segments }) => ({ segments: segments.map(s => ({ id: s.id, text: transform(s.text) })), provider: 'mock' }), 'mock', extra)

  // The cut points come from the caller: where to cut depends on the block itself (§8.6); the service layer inserts at the positions given only
  const twoSentences = (ids: string[]) => ({
    request: { segments: ids.map(id => ({ id, text: 'One sentence here. Two sentences here.', cuts: [19] })), source: 'en' as const, target: 'zh-CN' },
    cache: { paper: 'p', renderPath: 'tags' as RenderPath },
  })

  it('inserts the markers, removes them, and brings the boundaries of both sides out as the alignment', async () => {
    let sent = ''
    const service = build({
      getProvider: async () => echoing(t => { sent = t; return t.replace('One sentence here. ', '第一句。').replace('Two sentences here.', '第二句。') }),
    })
    const res = await service.translate(twoSentences(['a']))
    expect(res.ok).toBe(true)
    // What went out carries the markers
    expect(sent).toMatch(/<x id="\d+"\/>/)
    if (!res.ok) return
    const seg = res.result.segments[0]!
    // Not one marker is left in the translation that came back
    expect(seg.text).toBe('第一句。第二句。')
    expect(seg.alignment).toEqual({ source: [19, 19], target: [4, 4] })
  })

  it('with no cut points from the caller nothing is inserted — where to cut depends on the block itself (§8.6)', async () => {
    let sent = ''
    const service = build({ getProvider: async () => echoing(t => { sent = t; return '译文' }) })
    await service.translate({
      request: { segments: [{ id: 'a', text: 'One sentence here. Two sentences here.' }], source: 'en', target: 'zh-CN' },
      cache: { paper: 'p', renderPath: 'tags' as RenderPath },
    })
    expect(sent).toBe('One sentence here. Two sentences here.')
  })

  it('when the engine reports its own, nothing is inserted', async () => {
    let sent = ''
    const service = build({
      getProvider: async () => echoing(t => { sent = t; return '译文' }, { reportsSentences: true }),
    })
    await service.translate(twoSentences(['a']))
    expect(sent).toBe('One sentence here. Two sentences here.')
  })

  it('markers dropped by the engine: no alignment, but the text is still clean', async () => {
    // No alignment only means no highlight; a leftover marker would make validate judge the placeholders mismatched and void the whole block's translation
    const service = build({
      getProvider: async () => echoing(() => '第一句。第二句。'),
    })
    const res = await service.translate(twoSentences(['a']))
    if (!res.ok) return
    expect(res.result.segments[0]!.text).toBe('第一句。第二句。')
    expect(res.result.segments[0]!.alignment).toBeUndefined()
  })

  it('markers out of order: no alignment, and the leftover markers are removed cleanly', async () => {
    const service = build({
      getProvider: async () => echoing(t => {
        const ids = [...t.matchAll(/<x id="(\d+)"\/>/g)].map(m => m[1])
        return `第二句。<x id="${ids[0]}"/>第一句。<x id="${ids[0]}"/>`
      }),
    })
    const res = await service.translate(twoSentences(['a']))
    if (!res.ok) return
    expect(res.result.segments[0]!.text).toBe('第二句。第一句。')
    expect(res.result.segments[0]!.alignment).toBeUndefined()
  })

  it('a single-sentence block gets no markers but still a whole-for-whole alignment', async () => {
    // An empty cut array says “this block is one sentence”. Whole-for-whole is a safe alignment needing no marker,
    // and single-sentence blocks are most of the body text — lumping them with “must not align” shuts them all out of the highlight
    let sent = ''
    const service = build({ getProvider: async () => echoing(t => { sent = t; return '一句译文。' }) })
    const res = await service.translate({
      request: { segments: [{ id: 'a', text: 'Only one sentence here.', cuts: [] }], source: 'en', target: 'zh-CN' },
      cache: { paper: 'p', renderPath: 'tags' as RenderPath },
    })
    expect(sent).toBe('Only one sentence here.')
    if (!res.ok) return
    expect(res.result.segments[0]!.alignment).toEqual({ source: ['Only one sentence here.'.length], target: ['一句译文。'.length] })
  })

  it('when inserting would exceed the engine\'s per-request cap nothing is inserted', async () => {
    // `BatchQueue`'s character cap only stops **merging**; a single task over it is sent all the same (Codex on #137).
    // No alignment only means no highlight, while over the cap the whole batch fails
    let sent = ''
    const text = `${'x'.repeat(40)}. ${'y'.repeat(40)}.`
    const service = build({
      getProvider: async () => echoing(t => { sent = t; return '译文' }, { maxBatchChars: text.length + 5 }),
    })
    await service.translate({
      request: { segments: [{ id: 'a', text, cuts: [42] }], source: 'en', target: 'zh-CN' },
      cache: { paper: 'p', renderPath: 'tags' as RenderPath },
    })
    expect(sent).toBe(text)
  })

  it('the cut points enter the cache key: the same wire text with different cut points must not hit each other', async () => {
    // Two blocks can serialise to the same wire text with different slot semantics, so `cutsOf` gives different cut points.
    // Without them in the key the second block hits the first's entry, its mismatched alignment included (Codex on #137)
    const { port, writes } = fakePort()
    const service = build({ getProvider: async () => echoing(() => '译文一。译文二。'), cache: port })
    const text = 'One sentence here. Two sentences here.'
    await service.translate({ request: { segments: [{ id: 'a', text, cuts: [19] }], source: 'en', target: 'zh-CN' }, cache: { paper: 'p', renderPath: 'tags' as RenderPath } })
    await service.translate({ request: { segments: [{ id: 'b', text, cuts: [] }], source: 'en', target: 'zh-CN' }, cache: { paper: 'p', renderPath: 'tags' as RenderPath } })
    const keys = writes.flat().map(w => w.key)
    expect(new Set(keys).size).toBe(2)
  })

  it('only the tags path inserts: markers has no marker that survives, and the runs path\'s pieces joined back have no wire offsets', async () => {
    for (const renderPath of ['markers', 'runs'] as RenderPath[]) {
      let sent = ''
      const service = build({ getProvider: async () => echoing(t => { sent = t; return '译文' }) })
      await service.translate({
        request: { segments: [{ id: 'a', text: 'One sentence here. Two sentences here.', cuts: [19] }], source: 'en', target: 'zh-CN' },
        cache: { paper: 'p', renderPath },
      })
      expect([renderPath, sent]).toEqual([renderPath, 'One sentence here. Two sentences here.'])
    }
  })

  it('a call without a cache (the connection test) inserts nothing either', async () => {
    let sent = ''
    const service = build({ getProvider: async () => echoing(t => { sent = t; return '译文' }) })
    await service.translate({ request: { segments: [{ id: 'a', text: 'One sentence here. Two sentences here.', cuts: [19] }], source: 'en', target: 'zh-CN' } })
    expect(sent).toBe('One sentence here. Two sentences here.')
  })
})

describe('attributing failures: isolatable travels with the error across the message boundary (research audit F14 / A02)', () => {
  it('the default by kind: true only where a smaller split might succeed', () => {
    // The criterion is “was this failure caused by one segment, or is the whole path down”
    for (const kind of ['invalid-response', 'unknown'] as const) {
      expect([kind, new ProviderError(kind, 'x').isolatable]).toEqual([kind, true])
    }
    // timeout was measured and moved to not isolatable: 8 segments fanned out into 15 calls at the content layer, while recovering from a timeout is the queue's job anyway
    for (const kind of ['timeout', 'rate-limit', 'network', 'bad-request', 'no-key', 'auth', 'aborted'] as const) {
      expect([kind, new ProviderError(kind, 'x').isolatable]).toEqual([kind, false])
    }
  })

  it('a provider that knows better may override, in both directions', () => {
    // The free engine's reply is not JSON: a systemic failure, the same however small the split (Codex on #61)
    expect(new ProviderError('invalid-response', 'not JSON', { isolatable: false }).isolatable).toBe(false)
    // Conversely, a 4xx caused by one segment being too long can be located by splitting
    expect(new ProviderError('bad-request', 'segment too long', { isolatable: true }).isolatable).toBe(true)
  })

  it('toErrorInfo carries it across the boundary; a non-ProviderError gets it by origin', () => {
    expect(toErrorInfo(new ProviderError('rate-limit', 'slow down'))).toEqual({ kind: 'rate-limit', message: 'slow down', isolatable: false })
    // A count mismatch is the typical “one segment threw the output off”
    expect(toErrorInfo(new BatchCountMismatchError(4, 3, ['x'])).isolatable).toBe(true)
    expect(toErrorInfo(new Error('boom'))).toMatchObject({ kind: 'unknown', isolatable: true })
    const timeout = Object.assign(new Error('slow'), { name: 'RequestTimeoutError' })
    expect(toErrorInfo(timeout)).toMatchObject({ kind: 'timeout', isolatable: false })
  })
})

describe('only the glossary entries in use are sent (§8.2)', () => {
  const glossary = [
    { term: 'attention', translation: '注意力' },
    { term: 'kernel', translation: '核' },
    { term: 'manifold', translation: '流形' },
  ]
  /** Records the context the provider received and each segment's cache key */
  const run = async (segments: { id: string; text: string }[], context?: Record<string, unknown>) => {
    const seen: unknown[] = []
    const { port, reads } = fakePort()
    const service = build({
      getProvider: async () => provider(async req => {
        seen.push(req.context)
        return { segments: req.segments.map(s => ({ id: s.id, text: `[${s.text}]` })), provider: 'llm' }
      }, 'llm', { promptKey: 'default' }),
      cache: port,
    })
    const res = await service.translate({ request: { segments, source: 'en', target: 'zho', context: context as never }, cache: { paper: 'p', renderPath: 'tags' } })
    expect(res.ok).toBe(true)
    // The key used to read the cache is this segment's key (writes are asynchronous; reads are steadier)
    return { context: seen[0] as { glossary?: { term: string }[] } | undefined, keys: reads[0] ?? [] }
  }

  it('one batch sends the union for that batch, ordered by the glossary', async () => {
    const { context } = await run([
      { id: 'a', text: 'The kernel trick is standard.' },
      { id: 'b', text: 'We revisit attention here.' },
    ], { glossary })
    expect(context?.glossary?.map(g => g.term)).toEqual(['attention', 'kernel'])
  })

  it('a segment using no term has the same key as with “no glossary configured” — changing one term must not void the whole site\'s cache', async () => {
    const plain = [{ id: 'a', text: 'Nothing relevant here.' }]
    // The rest of the context is identical; the only difference is whether there is a glossary
    const without = await run(plain, { paperTitle: 'T' })
    const with_ = await run(plain, { paperTitle: 'T', glossary })
    expect(with_.keys).toEqual(without.keys)
    // And the request carries not one unused term
    expect((with_.context as { glossary?: unknown } | undefined)?.glossary).toBeUndefined()
  })

  it('a segment using terms has a key that varies with the entries **it itself** uses', async () => {
    const text = [{ id: 'a', text: 'The kernel trick is standard.' }]
    const a = await run(text, { glossary })
    const b = await run(text, { glossary: [glossary[0]!, { term: 'kernel', translation: '核函数' }, glossary[2]!] })
    // The translation of a term it uses changed: the key must change
    expect(a.keys).not.toEqual(b.keys)
    // A term it does not use changed: the key stays
    const c = await run(text, { glossary: [{ term: 'attention', translation: '注意' }, glossary[1]!, glossary[2]!] })
    expect(a.keys).toEqual(c.keys)
  })

  it('matching runs on the text with placeholders removed: an attribute name is no hit', async () => {
    // The wire text looks like `Let <x id="1"/> be positive.` — matched literally, `id` would hit the placeholder's attribute
    const { context } = await run([{ id: 'a', text: 'Let <x id="1"/> be positive.' }], { glossary: [{ term: 'id', translation: '标识' }] })
    expect((context as { glossary?: unknown } | undefined)?.glossary).toBeUndefined()
  })

  // In the wire text & < > are escaped (serialize.ts), and without decoding entities a term with those characters never matches
  // (Codex on #163). Such terms are common in papers: R&D, <UNK>, A&B
  it('entities are decoded before matching: R&D matches the wire\'s R&amp;D', async () => {
    const terms = [{ term: 'R&D', translation: '研发' }, { term: '<UNK>', translation: '未知词' }]
    const { context } = await run([{ id: 'a', text: 'Our R&amp;D team replaces &lt;UNK&gt; tokens.' }], { glossary: terms })
    expect(context?.glossary?.map(g => g.term)).toEqual(['R&D', '<UNK>'])
  })

  it('decoding does not conjure an entity: `&` and `amp;` separated by a placeholder are no hit', async () => {
    // Decoded segment by segment, not joined first: joined it looks like `X&amp;Y`, decoded per segment it is `X&` + `amp;Y`
    const { context } = await run([{ id: 'a', text: 'X&amp;<x id="1"/>amp;Y uses R&amp;D' }], { glossary: [{ term: 'R&D', translation: '研发' }, { term: 'X&Y', translation: '异或' }] })
    expect(context?.glossary?.map(g => g.term)).toEqual(['R&D'])
  })
})
