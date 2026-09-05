import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationCache, createCacheDb } from '@/cache/store'
import { createStatusHandler, createTranslateHandler } from '@/entrypoints/background/translate-handler'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
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
const deps = (provider: TranslationProvider) => ({ getProvider: async () => provider })

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('translate handler', () => {
  it('成功响应形状', async () => {
    const handler = createTranslateHandler(deps(mockProvider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }))))
    expect(await handler({ request: req })).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }], provider: 'mock' }, cached: 0 })
  })

  it('限流一次后重试成功', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let calls = 0
    const handler = createTranslateHandler(deps(mockProvider(async r => {
      if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
      return { segments: r.segments, provider: 'mock' }
    })))
    const pending = handler({ request: req })
    await vi.advanceTimersByTimeAsync(100) // 攒批
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(6_000) // 429 的暂停窗口（基础 5s）过后重发
    const res = await pending
    expect(res.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('令牌桶：突发 capacity 个，之后按 rate 放行（Read Frog request-queue 的语义，替代原来的并发上限）', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    // 每条单独成批（maxBatchItems 1），速率 1/s、突发 2
    const handler = createTranslateHandler(deps(mockProvider(async r => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return { segments: r.segments, provider: 'mock' }
    }, { maxBatchItems: 1, rateLimit: { rate: 1, capacity: 2 } })))
    const all = Promise.all([handler({ request: req }), handler({ request: req }), handler({ request: req })])
    await vi.advanceTimersByTimeAsync(100)
    expect(peak).toBe(2)
    expect(release.length).toBe(2)
    await vi.advanceTimersByTimeAsync(1_000) // 第三个等下一个令牌
    expect(release.length).toBe(3)
    expect(peak).toBe(3)
    for (const fn of release) fn()
    await vi.advanceTimersByTimeAsync(0)
    const results = await all
    expect(results.every(r => r.ok)).toBe(true)
  })

  it('错误响应形状：ProviderError 带 kind，其他错误为 unknown', async () => {
    const auth = createTranslateHandler(deps(mockProvider(async () => { throw new ProviderError('auth', 'bad key') })))
    expect(await auth({ request: req })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    // 未知错误默认可重试：把重试关掉再看形状
    const boom = createTranslateHandler({ ...deps(mockProvider(async () => { throw new Error('boom') })), queue: { maxRetries: 0 } })
    expect(await boom({ request: req })).toEqual({ ok: false, error: { kind: 'unknown', message: 'boom' } })
  })

  it('provider 状态', async () => {
    const status = createStatusHandler({ getProvider: async () => mockProvider(async r => ({ segments: r.segments, provider: 'mock' })), getModel: async () => 'm/1' })
    expect(await status()).toEqual({ providerId: 'mock', available: true, model: 'm/1', maxBatchChars: 1000, maxBatchItems: 4, preservesMarkup: true })
  })
})

// Dexie + fake-indexeddb 靠真计时器调度，这一组不能用 fake timers
describe('translate handler + 缓存', () => {
  let n = 0
  const cacheOf = () => new TranslationCache({ db: createCacheDb(`axt-handler-${++n}`, { indexedDB, IDBKeyRange }) })
  const echo = (calls: string[][]) => mockProvider(async r => {
    calls.push(r.segments.map(s => s.id))
    return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock', model: 'm' }
  })
  const withCache = { paper: '2410.00260', renderPath: 'markup' as const }
  const two: TranslateRequest = { segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], source: 'en', target: 'zh-CN' }

  it('首次全部未命中并写缓存；第二次全部命中不调用 provider', async () => {
    const calls: string[][] = []
    const handler = createTranslateHandler({ getProvider: async () => echo(calls), getModel: async () => 'm', cache: cacheOf() })
    const first = await handler({ request: two, cache: withCache })
    expect(first).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock', model: 'm' }, cached: 0 })
    const second = await handler({ request: two, cache: withCache })
    expect(second).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock', model: 'm' }, cached: 2 })
    expect(calls).toEqual([['a', 'b']])
  })

  it('部分命中只发未命中段落，按原顺序合并', async () => {
    const calls: string[][] = []
    const handler = createTranslateHandler({ getProvider: async () => echo(calls), getModel: async () => 'm', cache: cacheOf() })
    await handler({ request: { ...two, segments: [{ id: 'b', text: 'y' }] }, cache: withCache })
    const res = await handler({ request: { ...two, segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] }, cache: withCache })
    expect(res.ok && res.cached).toBe(1)
    expect(res.ok && res.result.segments.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(calls).toEqual([['b'], ['a', 'c']])
  })

  it('不带 cache 的请求不读不写缓存', async () => {
    const calls: string[][] = []
    const cache = cacheOf()
    const handler = createTranslateHandler({ getProvider: async () => echo(calls), getModel: async () => 'm', cache })
    await handler({ request: two })
    await handler({ request: two })
    expect(calls).toHaveLength(2)
    expect((await cache.stats()).entries).toBe(0)
  })
})

describe('引擎状态里的降级信息（Codex 在 #50 指出）', () => {
  const provider = (id: string, available: boolean): TranslationProvider => ({
    id,
    displayName: id === 'google-web' ? 'Google 网页翻译（免费）' : id,
    kind: 'mt',
    preservesMarkup: true,
    maxBatchChars: 1000,
    maxBatchItems: 4,
    isAvailable: async () => available,
    translate: async () => ({ segments: [], provider: id }),
  })

  it('首选可用时不报降级', async () => {
    const status = createStatusHandler({
      getProvider: async () => provider('openai-compat', true),
      getModel: async () => 'm/1',
      getChain: async () => [provider('openai-compat', true), provider('google-web', true)],
    })
    const r = await status()
    expect(r.available).toBe(true)
    expect(r.fallback).toBeUndefined()
  })

  it('首选不可用但链上有兜底时报出来：popup 据此保持「翻译」可点', async () => {
    const status = createStatusHandler({
      getProvider: async () => provider('chrome-builtin', false),
      getModel: async () => undefined,
      getChain: async () => [provider('chrome-builtin', false), provider('google-web', true)],
    })
    const r = await status()
    expect(r.available).toBe(false)
    expect(r.fallback).toEqual({ id: 'google-web', displayName: 'Google 网页翻译（免费）' })
  })

  it('整条链都不可用时不报降级：这时按钮该是灰的', async () => {
    const status = createStatusHandler({
      getProvider: async () => provider('openai-compat', false),
      getModel: async () => undefined,
      getChain: async () => [provider('openai-compat', false), provider('google-web', false)],
    })
    expect((await status()).fallback).toBeUndefined()
  })

  it('没给 getChain 时行为不变：只看首选引擎', async () => {
    const status = createStatusHandler({ getProvider: async () => provider('openai-compat', false), getModel: async () => undefined })
    const r = await status()
    expect(r.available).toBe(false)
    expect(r.fallback).toBeUndefined()
  })
})
