import { afterEach, describe, expect, it, vi } from 'vitest'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import { createTranslateService, type CacheEntry, type CachePort } from '@/providers/translate-service'
import { ProviderError, type TranslationProvider } from '@/providers/types'

const provider = (translate: TranslationProvider['translate'], id = 'mock', extra: Partial<TranslationProvider> = {}): TranslationProvider => ({
  id, displayName: id, kind: 'llm', preservesMarkup: true,
  maxBatchChars: 1000, maxBatchItems: 4,
  isAvailable: async () => true, translate,
  ...extra,
})

/** Fake cache port that records calls */
function fakePort(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  const reads: string[][] = []
  const writes: CacheEntry[][] = []
  const port: CachePort = {
    async getMany(keys) { reads.push(keys); return keys.map(k => store.get(k) ?? null) },
    async putMany(entries) { writes.push(entries); for (const e of entries) store.set(e.key, e.translation) },
  }
  return { port, reads, writes, store }
}

const req = (ids: string[]) => ({
  request: { segments: ids.map(id => ({ id, text: `text-${id}` })), source: 'en' as const, target: 'zh-CN' },
  cache: { paper: '2410.00260', renderPath: 'markup' as const },
})

const rateLimited = () => attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createTranslateService', () => {
  it('reads and writes cache once per batch, not per segment; segments from a call are batched for the provider', async () => {
    const { port, reads, writes } = fakePort()
    const calls: string[][] = []
    const service = createTranslateService({
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

  it('cache hits bypass the provider and merge into results in original order', async () => {
    const { port } = fakePort()
    const calls: string[][] = []
    const service = createTranslateService({
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

  it('omitting cache bypasses it entirely for settings connection tests', async () => {
    const { port, reads, writes } = fakePort()
    const service = createTranslateService({
      getProvider: async () => provider(async r => ({ segments: r.segments, provider: 'mock' })),
      cache: port,
    })
    const res = await service.translate({ request: { segments: [{ id: 'x', text: 'hi' }], source: 'en', target: 'zh-CN' } })
    expect(res.ok).toBe(true)
    expect(reads).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('converts provider exceptions into error responses without throwing; auth is not retried', async () => {
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }),
    })
    expect(await service.translate(req(['a']))).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    expect(calls).toBe(1)
  })

  it('cache read failures do not block translation because the port treats them as misses', async () => {
    const port: CachePort = { getMany: async keys => keys.map(() => null), putMany: vi.fn(async () => {}) }
    const service = createTranslateService({
      getProvider: async () => provider(async r => ({ segments: r.segments.map(s => ({ ...s, text: '译' })), provider: 'mock' })),
      cache: port,
    })
    const res = await service.translate(req(['a']))
    expect(res.ok && res.cached).toBe(0)
    expect(port.putMany).toHaveBeenCalled()
  })

  it('cache.bypass writes without reading so retries cannot reuse corrupt cached translations (Codex #9)', async () => {
    const { port, reads, writes } = fakePort()
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async r => { calls++; return { segments: r.segments.map(s => ({ ...s, text: `译${calls}:${s.text}` })), provider: 'mock' } }),
      getModel: async () => 'm/1',
      cache: port,
    })
    await service.translate(req(['a']))
    const again = await service.translate({ ...req(['a']), cache: { paper: '2410.00260', renderPath: 'markup', bypass: true } })
    expect(calls).toBe(2)
    expect(reads).toHaveLength(1)
    expect(writes).toHaveLength(2)
    expect(again.ok && again.result.segments[0]?.text).toBe('译2:text-a')
    // After replacement, ordinary requests hit the new translation.
    const third = await service.translate(req(['a']))
    expect(calls).toBe(2)
    expect(third.ok && third.result.segments[0]?.text).toBe('译2:text-a')
  })

  it('returns translations that fail placeholder validation but does not cache them (Codex #30)', async () => {
    // Infer expectations from request text instead of a caller accept callback (issue #42): the translation of a drops <x id="1"/>.
    const { port, writes } = fakePort()
    const service = createTranslateService({
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

  it('inferred expectations also protect plain-text runs: invented tags cannot enter the cache', async () => {
    const { port, writes } = fakePort()
    const service = createTranslateService({
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

  it('if one of two batches fails, caches the successful batch while reporting overall failure', async () => {
    const { port, writes } = fakePort()
    const service = createTranslateService({
      // Two segments per batch: a and b share one batch; c forms another that fails.
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
  })

  it('ID mismatches trigger BatchQueue retry then individual fallback, without RequestQueue retries that would require 12 requests before fallback', async () => {
    const seen: string[][] = []
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        seen.push(r.segments.map(s => s.id))
        if (r.segments.length > 1) throw new ProviderError('invalid-response', 'ID mismatch')
        return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }
      }),
      batch: { maxRetries: 1 },
      queue: { baseRetryDelayMs: 0 },
    })
    const res = await service.translate(req(['a', 'b']))
    expect(res.ok).toBe(true)
    // One batch attempt + one retry + two individual requests
    expect(seen).toEqual([['a', 'b'], ['a', 'b'], ['a'], ['b']])
  })
})

describe('batching depends on capacity, not engine category (§8.3, 2026-09-06)', () => {
  /** Record which segments the provider actually receives in each call */
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

  it('coalesces calls to free mt engines into one request, whereas previously only LLM calls were batched', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 100, maxBatchChars: 8000 })
    const service = createTranslateService({ getProvider: async () => mt })
    const all = Promise.all([service.translate(req(['a'])), service.translate(req(['b'])), service.translate(req(['c']))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b', 'c']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('fills batches to capacity and starts another beyond maxBatchItems', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 2, maxBatchChars: 8000 })
    const service = createTranslateService({ getProvider: async () => mt })
    const all = Promise.all(['a', 'b', 'c'].map(id => service.translate(req([id]))))
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b'], ['c']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('context-insensitive engines omit section titles from batch keys so batching can span sections', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 100, maxBatchChars: 8000 })
    const service = createTranslateService({ getProvider: async () => mt })
    const all = Promise.all([service.translate(withContext(['a'], '第一节')), service.translate(withContext(['b'], '第二节'))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('prompt-based engines still separate batches by context to avoid mixing section titles', async () => {
    vi.useFakeTimers()
    const { calls, provider: llm } = recorder({ kind: 'llm', maxBatchItems: 100, maxBatchChars: 8000, promptKey: 'default' })
    const service = createTranslateService({ getProvider: async () => llm })
    const all = Promise.all([service.translate(withContext(['a'], '第一节')), service.translate(withContext(['b'], '第二节'))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls.map(c => c.join()).sort()).toEqual(['a', 'b'])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('honors provider maxConcurrent independently of the token bucket', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    // Allow 20/s with burst 20 so only concurrency limits in-flight requests to two.
    const mt = provider(async r => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return { segments: r.segments, provider: 'mock' }
    }, 'mock', { kind: 'mt', maxBatchItems: 1, rateLimit: { rate: 20, capacity: 20 }, maxConcurrent: 2 })
    const service = createTranslateService({ getProvider: async () => mt })
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

describe('systemic failures must not be amplified by batch retries (Codex #61)', () => {
  const callOf = (n: number) => ({
    request: { segments: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, text: `text-${i}` })), source: 'en' as const, target: 'zh-CN' },
  })

  it('reports nonisolatable invalid-response immediately without retry or individual fallback', async () => {
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async () => {
        calls++
        // The free engine returned non-JSON for the entire response; smaller batches cannot help.
        throw new ProviderError('invalid-response', 'Response is not JSON', { isolatable: false })
      }, 'mock', { kind: 'mt', maxBatchItems: 100 }),
    })
    const res = await service.translate(callOf(8))
    expect(res).toMatchObject({ ok: false, error: { kind: 'invalid-response' } })
    // One request suffices; treating it as a batch error would cause 1 + 3 retries + 8 individual attempts = 12 requests.
    expect(calls).toBe(1)
  })

  it('isolatable invalid-response still retries and falls back individually to identify the offending segment', async () => {
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        calls++
        // Only multi-segment requests fail; individual requests succeed.
        if (r.segments.length > 1) throw new ProviderError('invalid-response', 'ID mismatch')
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', { kind: 'llm', maxBatchItems: 100 }),
      batch: { maxRetries: 1 },
    })
    const res = await service.translate(callOf(3))
    expect(res.ok).toBe(true)
    // Initial attempt + one retry + three individual attempts
    expect(calls).toBe(5)
  })
})

describe('createTranslateService: rate limits, timeouts, and cancellation with fake timers', () => {
  const log = () => {
    const calls: { id: string; t: number }[] = []
    return { calls, note: (ids: string[]) => calls.push({ id: ids.join('+'), t: Date.now() }) }
  }

  it('429 pauses later requests; afterward one token remains, scheduleAt determines order, and rate limits release the rest (Codex #6 / #10 / #30)', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { calls, note } = log()
    let first = true
    const service = createTranslateService({
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
    // Base pause 5 s: b cannot dispatch within 4.9 s.
    await vi.advanceTimersByTimeAsync(4_900)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(300)
    // The base 5 s pause ends with Math.random fixed at 0 to remove jitter; refill restores the one-token capacity during the pause.
    // The dispatch gate holds batch b while no slots are available, so only the retry of a is queued and consumes that token first.
    expect(calls.map(c => c.id)).toEqual(['a', 'a'])
    // The gate probes once per second; after flushing, b waits for another token, at least one token interval after the retry of a.
    for (let i = 0; i < 50 && calls.length < 3; i++) await vi.advanceTimersByTimeAsync(100)
    expect(calls.map(c => c.id)).toEqual(['a', 'a', 'b'])
    expect(calls[2]!.t - calls[1]!.t).toBeGreaterThanOrEqual(1_000)
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok && rb.ok).toBe(true)
  })

  it('two simultaneous 429 responses create one pause window with no dispatches, then both retry successfully', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const { calls, note } = log()
    let hits = 0
    const service = createTranslateService({
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
    // Neither retries during the base five-second window.
    await vi.advanceTimersByTimeAsync(4_900)
    expect(calls).toHaveLength(2)
    // Both retry after the window, which the second 429 may extend; the bucket refills to capacity two during the pause and releases both.
    for (let i = 0; i < 120 && calls.length < 4; i++) await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(4)
    expect(calls[2]!.t - calls[0]!.t).toBeGreaterThanOrEqual(5_000)
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok && rb.ok).toBe(true)
  })

  it('a hung provider retries at the character-based timeout and eventually returns timeout instead of waiting forever', async () => {
    // Observed in 2312.17527: the last block was still pending after 220 seconds, leaving the whole paper in progress.
    vi.useFakeTimers()
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(() => { calls++; return new Promise(() => {}) }), // Ignores the signal and never returns
      queue: { timeoutMs: 20, maxRetries: 1, baseRetryDelayMs: 0 },
    })
    const pending = service.translate({ request: { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh' } })
    await vi.advanceTimersByTimeAsync(10_000)
    const res = await pending
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('timeout')
    expect(calls).toBe(2) // Initial attempt + one retry
  })

  it('cancel(scope) cancels queued and in-flight requests, aborts signals, prevents cache writes, and immediately aborts later calls in that scope', async () => {
    // Use real timers: cache hashing uses crypto.subtle, which does not complete with fake timers here.
    const { port, writes } = fakePort()
    let signal: AbortSignal | undefined
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        calls++
        signal = r.signal
        await new Promise(() => {}) // Remain pending until cancelled
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', { maxBatchItems: 1 }),
      cache: port,
    })
    const a = service.translate({ ...req(['a']), scope: 'run-1' })
    await vi.waitFor(() => expect(calls).toBe(1))
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
