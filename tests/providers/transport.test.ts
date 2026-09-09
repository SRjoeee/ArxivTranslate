import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationCache, createCacheDb } from '@/cache/store'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import { CHAIN_CONFIG_FIELDS, VOLATILE_CONFIG_FIELDS, chainConfigChanged, createLocalTransport } from '@/providers/transport'
import type { CachePort } from '@/providers/translate-service'
import { ProviderError, type TranslateRequest, type TranslationProvider } from '@/providers/types'

const req: TranslateRequest = { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh-CN' }

function mockProvider(translate: TranslationProvider['translate'], extra: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    id: 'mock', displayName: 'Mock', kind: 'llm', preservesMarkup: true, maxBatchChars: 1000, maxBatchItems: 4,
    isAvailable: async () => true,
    translate,
    ...extra,
  }
}

/** Tests supply the chain directly, avoiding real buildChain calls and real API keys */
const withChain = (chain: TranslationProvider[], extra: Parameters<typeof createLocalTransport>[1] = {}) =>
  createLocalTransport(DEFAULT_CONFIG, { buildChain: async () => chain, ...extra })

const portOf = (cache: TranslationCache): CachePort => ({
  getMany: keys => Promise.all(keys.map(key => cache.get(key))),
  async putMany(entries) { for (const e of entries) await cache.set(e.key, e.translation, e.paper) },
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('createLocalTransport: translation', () => {
  it('successful response shape', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }))])
    // Only openai-compat includes the model name; changing models must not invalidate free-engine caches.
    expect(await t.translate({ request: req })).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }], provider: 'mock' }, cached: 0 })
  })

  it('retries successfully after one rate-limit response', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let calls = 0
    const t = await withChain([mockProvider(async r => {
      if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
      return { segments: r.segments, provider: 'mock' }
    })])
    const pending = t.translate({ request: req })
    await vi.advanceTimersByTimeAsync(100) // Collect into a batch
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(6_000) // Retry after the base five-second 429 pause.
    expect((await pending).ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('token bucket allows an initial capacity burst, then releases requests at rate (Read Frog request-queue semantics)', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    // One segment per batch, rate 1/s, burst 2
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
    await vi.advanceTimersByTimeAsync(1_000) // The third request waits for the next token.
    expect(release.length).toBe(3)
    expect(peak).toBe(3)
    for (const fn of release) fn()
    await vi.advanceTimersByTimeAsync(0)
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('error response shape: ProviderError retains kind; other errors become unknown', async () => {
    const auth = await withChain([mockProvider(async () => { throw new ProviderError('auth', 'bad key') })])
    expect(await auth.translate({ request: req })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    // Unknown errors retry by default; disable retries to inspect the response shape.
    const boom = await withChain([mockProvider(async () => { throw new Error('boom') })], { queue: { maxRetries: 0 } })
    expect(await boom.translate({ request: req })).toEqual({ ok: false, error: { kind: 'unknown', message: 'boom' } })
  })

  it('explicit-engine calls bypass fallback so settings connection tests report that endpoint failure accurately', async () => {
    const failing = { ...mockProvider(async () => { throw new ProviderError('auth', 'bad key') }), id: 'openai-compat' }
    const free = { ...mockProvider(async r => ({ segments: r.segments, provider: 'google-web' })), id: 'google-web' }
    const t = await withChain([failing, free])
    // Unspecified engine: normal chain fallback keeps whole-paper translation running.
    expect(await t.translate({ request: req })).toMatchObject({ ok: true, result: { provider: 'google-web' } })
    // Explicit engine: report the error, never success merely because a free fallback exists.
    expect(await t.translate({ request: req, providerId: 'openai-compat' })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
  })

  it('naming an engine absent from the chain reports it explicitly instead of silently switching', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments, provider: 'mock' }))])
    expect(await t.translate({ request: req, providerId: 'chrome-builtin' })).toEqual({ ok: false, error: { kind: 'unknown', message: 'Engine chrome-builtin is not in the current chain' } })
  })

  it('cancel aborts in-flight requests and returns the actual cancelled count', async () => {
    vi.useFakeTimers()
    const t = await withChain([mockProvider(() => new Promise(() => undefined) as never)])
    const pending = t.translate({ request: req, scope: 'session-1' })
    await vi.advanceTimersByTimeAsync(200)
    expect(await t.cancel('session-1')).toBeGreaterThan(0)
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })
})

describe('createLocalTransport: status', () => {
  const engine = (id: string, available: boolean): TranslationProvider => ({
    id,
    displayName: id === 'google-web' ? 'Google web translation (free)' : id,
    kind: 'mt',
    preservesMarkup: true,
    maxBatchChars: 1000,
    maxBatchItems: 4,
    isAvailable: async () => available,
    translate: async () => ({ segments: [], provider: id }),
  })

  it('an available preferred engine reports no fallback and supplies capability fields', async () => {
    const t = await withChain([engine('openai-compat', true), engine('google-web', true)])
    expect(await t.status()).toEqual({
      providerId: 'openai-compat',
      available: true,
      model: DEFAULT_CONFIG.openaiCompat.model,
      maxBatchChars: 1000,
      maxBatchItems: 4,
      preservesMarkup: true,
      chain: ['openai-compat', 'google-web'],
      engine: { id: 'openai-compat', displayName: 'openai-compat' },
    })
  })

  it('an unavailable preferred engine with a fallback reports it so the popup keeps Translate enabled (Codex #50)', async () => {
    const t = await withChain([engine('chrome-builtin', false), engine('google-web', true)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toEqual({ id: 'google-web', displayName: 'Google web translation (free)' })
  })

  it('an entirely unavailable chain reports no fallback and should disable the button', async () => {
    const t = await withChain([engine('openai-compat', false), engine('google-web', false)])
    expect((await t.status()).fallback).toBeUndefined()
  })

  it('a single-engine chain also reports no fallback', async () => {
    const t = await withChain([engine('openai-compat', false)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toBeUndefined()
    expect(r.chain).toEqual(['openai-compat'])
  })

  it('after fallback, status reports the actual engine and reason (§8.5)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = { ...engine('openai-compat', true), translate: async () => { throw new ProviderError('auth', 'bad key') } }
    const ok = { ...engine('google-web', true), translate: async (r: TranslateRequest) => ({ segments: r.segments, provider: 'google-web' }) }
    const t = await withChain([failing, ok])
    expect((await t.status()).engine).toEqual({ id: 'openai-compat', displayName: 'openai-compat' })
    expect((await t.translate({ request: req })).ok).toBe(true)
    expect((await t.status()).engine).toEqual({
      id: 'google-web',
      displayName: 'Google web translation (free)',
      demoted: { displayName: 'openai-compat', kind: 'auth', message: 'bad key' },
    })
  })
})

// Dexie and fake-indexeddb schedule with real timers; this group cannot use fake timers.
describe('createLocalTransport: cache', () => {
  let n = 0
  const cacheOf = () => new TranslationCache({ db: createCacheDb(`axt-transport-${++n}`, { indexedDB, IDBKeyRange }) })
  const echo = (calls: string[][]) => mockProvider(async r => {
    calls.push(r.segments.map(s => s.id))
    return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock', model: 'm' }
  })
  const withCache = { paper: '2410.00260', renderPath: 'markup' as const }
  const two: TranslateRequest = { segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], source: 'en', target: 'zh-CN' }

  it('first call misses and caches everything; the second hits without calling the provider', async () => {
    const calls: string[][] = []
    const t = await withChain([echo(calls)], { cache: portOf(cacheOf()) })
    const first = await t.translate({ request: two, cache: withCache })
    expect(first).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock' }, cached: 0 })
    const second = await t.translate({ request: two, cache: withCache })
    expect(second).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock' }, cached: 2 })
    expect(calls).toEqual([['a', 'b']])
  })

  it('partial hits send only misses and merge results in original order', async () => {
    const calls: string[][] = []
    const t = await withChain([echo(calls)], { cache: portOf(cacheOf()) })
    await t.translate({ request: { ...two, segments: [{ id: 'b', text: 'y' }] }, cache: withCache })
    const res = await t.translate({ request: { ...two, segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] }, cache: withCache })
    expect(res.ok && res.cached).toBe(1)
    expect(res.ok && res.result.segments.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(calls).toEqual([['b'], ['a', 'c']])
  })

  it('requests without cache neither read nor write it, as in settings connection tests', async () => {
    const calls: string[][] = []
    const cache = cacheOf()
    const t = await withChain([echo(calls)], { cache: portOf(cache) })
    await t.translate({ request: two })
    await t.translate({ request: two })
    expect(calls).toHaveLength(2)
    expect((await cache.stats()).entries).toBe(0)
  })
})

describe('chainConfigChanged: configuration changes that rebuild the chain', () => {
  it('explicitly classifies every Config field, with both lists covering it exactly', () => {
    expect([...CHAIN_CONFIG_FIELDS, ...VOLATILE_CONFIG_FIELDS].sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort())
  })

  it('mode, style, preload, and glossary changes preserve the chain to avoid resetting token buckets and fallback state during translation', () => {
    const base = DEFAULT_CONFIG
    expect(chainConfigChanged(base, { ...base, mode: 'side' })).toBe(false)
    expect(chainConfigChanged(base, { ...base, style: { preset: 'quote', customCss: '' } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, preload: { margin: 42, threshold: 0.5 } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, glossary: [{ term: 'token', translation: '词元' }] })).toBe(false)
    // Image mode gates (§15) control display only; toggling a mode during reading must not clear queues.
    expect(chainConfigChanged(base, { ...base, image: { modes: ['side'] } })).toBe(false)
  })

  it('engine, endpoint, model, key, target language, prompt, and fallback changes rebuild the chain', () => {
    const base = DEFAULT_CONFIG
    const cases: Config[] = [
      { ...base, provider: 'google-web' },
      { ...base, openaiCompat: { ...base.openaiCompat, baseURL: 'https://other.example/v1' } },
      { ...base, openaiCompat: { ...base.openaiCompat, model: 'other-model' } },
      { ...base, openaiCompat: { ...base.openaiCompat, apiKey: 'sk-new' } },
      { ...base, openaiCompat: { ...base.openaiCompat, thinking: 'enabled' } },
      { ...base, targetLanguage: 'jpn' },
      { ...base, prompts: { ...base.prompts, promptId: 'other' } },
      { ...base, prompts: { ...base.prompts, patterns: [{ id: 'p', name: 'p', systemPrompt: 's', prompt: 'u' }] } },
      { ...base, fallback: { enabled: false } },
    ]
    for (const next of cases) expect([next, chainConfigChanged(base, next)]).toEqual([next, true])
  })

  it('new objects with equal values are unchanged because each storage watch returns a fresh parsed object', () => {
    expect(chainConfigChanged(DEFAULT_CONFIG, structuredClone(DEFAULT_CONFIG))).toBe(false)
  })
})
