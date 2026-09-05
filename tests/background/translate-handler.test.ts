import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { TranslationCache, createCacheDb } from '@/cache/store'
import { createStatusHandler, createTranslateHandler } from '@/entrypoints/background/translate-handler'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import { ProviderError, type TranslateRequest, type TranslationProvider } from '@/providers/types'

const req: TranslateRequest = { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh-CN' }

function mockProvider(translate: TranslationProvider['translate'], concurrency = 2): TranslationProvider {
  return {
    id: 'mock', displayName: 'Mock', kind: 'llm', preservesMarkup: true, maxBatchChars: 1000, maxBatchItems: 4, concurrency,
    isAvailable: async () => true,
    translate,
  }
}
const deps = (provider: TranslationProvider) => ({ getProvider: async () => provider, retry: { sleep: async () => {} } })

describe('translate handler', () => {
  it('成功响应形状', async () => {
    const handler = createTranslateHandler(deps(mockProvider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }))))
    expect(await handler({ request: req })).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }], provider: 'mock' }, cached: 0 })
  })

  it('限流一次后重试成功', async () => {
    let calls = 0
    const handler = createTranslateHandler(deps(mockProvider(async r => {
      if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
      return { segments: r.segments, provider: 'mock' }
    })))
    const res = await handler({ request: req })
    expect(res.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('按 provider 声明的并发上限排队', async () => {
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    const handler = createTranslateHandler(deps(mockProvider(async r => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return { segments: r.segments, provider: 'mock' }
    }, 2)))
    const all = Promise.all([handler({ request: req }), handler({ request: req }), handler({ request: req })])
    await new Promise(r => setTimeout(r, 10))
    expect(peak).toBe(2)
    expect(release.length).toBe(2)
    release.forEach(fn => fn())
    await new Promise(r => setTimeout(r, 10))
    release.forEach(fn => fn())
    await all
    expect(peak).toBe(2)
  })

  it('错误响应形状：ProviderError 带 kind，其他错误为 unknown', async () => {
    const auth = createTranslateHandler(deps(mockProvider(async () => { throw new ProviderError('auth', 'bad key') })))
    expect(await auth({ request: req })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    const boom = createTranslateHandler(deps(mockProvider(async () => { throw new Error('boom') })))
    expect(await boom({ request: req })).toEqual({ ok: false, error: { kind: 'unknown', message: 'boom' } })
  })

  it('provider 状态', async () => {
    const status = createStatusHandler({ getProvider: async () => mockProvider(async r => ({ segments: r.segments, provider: 'mock' })), getModel: async () => 'm/1' })
    expect(await status()).toEqual({ providerId: 'mock', available: true, model: 'm/1', maxBatchChars: 1000, maxBatchItems: 4, preservesMarkup: true })
  })
})

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
    const handler = createTranslateHandler({ getProvider: async () => echo(calls), getModel: async () => 'm', cache: cacheOf(), retry: { sleep: async () => {} } })
    const first = await handler({ request: two, cache: withCache })
    expect(first).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock', model: 'm' }, cached: 0 })
    const second = await handler({ request: two, cache: withCache })
    expect(second).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock', model: 'm' }, cached: 2 })
    expect(calls).toEqual([['a', 'b']])
  })

  it('部分命中只发未命中段落，按原顺序合并', async () => {
    const calls: string[][] = []
    const handler = createTranslateHandler({ getProvider: async () => echo(calls), getModel: async () => 'm', cache: cacheOf(), retry: { sleep: async () => {} } })
    await handler({ request: { ...two, segments: [{ id: 'b', text: 'y' }] }, cache: withCache })
    const res = await handler({ request: { ...two, segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] }, cache: withCache })
    expect(res.ok && res.cached).toBe(1)
    expect(res.ok && res.result.segments.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(calls).toEqual([['b'], ['a', 'c']])
  })

  it('不带 cache 的请求不读不写缓存', async () => {
    const calls: string[][] = []
    const cache = cacheOf()
    const handler = createTranslateHandler({ getProvider: async () => echo(calls), getModel: async () => 'm', cache, retry: { sleep: async () => {} } })
    await handler({ request: two })
    await handler({ request: two })
    expect(calls).toHaveLength(2)
    expect((await cache.stats()).entries).toBe(0)
  })
})
