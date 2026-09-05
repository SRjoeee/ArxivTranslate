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

/** 链由测试直接给：不碰真的 buildChain，也就不需要真的 API key */
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

describe('createLocalTransport：翻译', () => {
  it('成功响应形状', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }))])
    // 模型名只对 openai-compat 引擎带上：换模型不该让免费引擎的缓存失效
    expect(await t.translate({ request: req })).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }], provider: 'mock' }, cached: 0 })
  })

  it('限流一次后重试成功', async () => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0)
    let calls = 0
    const t = await withChain([mockProvider(async r => {
      if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
      return { segments: r.segments, provider: 'mock' }
    })])
    const pending = t.translate({ request: req })
    await vi.advanceTimersByTimeAsync(100) // 攒批
    expect(calls).toBe(1)
    await vi.advanceTimersByTimeAsync(6_000) // 429 的暂停窗口（基础 5s）过后重发
    expect((await pending).ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('令牌桶：突发 capacity 个，之后按 rate 放行（Read Frog request-queue 的语义）', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    // 每条单独成批（maxBatchItems 1），速率 1/s、突发 2
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
    await vi.advanceTimersByTimeAsync(1_000) // 第三个等下一个令牌
    expect(release.length).toBe(3)
    expect(peak).toBe(3)
    for (const fn of release) fn()
    await vi.advanceTimersByTimeAsync(0)
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('错误响应形状：ProviderError 带 kind，其他错误为 unknown', async () => {
    const auth = await withChain([mockProvider(async () => { throw new ProviderError('auth', 'bad key') })])
    expect(await auth.translate({ request: req })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    // 未知错误默认可重试：把重试关掉再看形状
    const boom = await withChain([mockProvider(async () => { throw new Error('boom') })], { queue: { maxRetries: 0 } })
    expect(await boom.translate({ request: req })).toEqual({ ok: false, error: { kind: 'unknown', message: 'boom' } })
  })

  it('指名引擎的调用不走降级链：设置页「测试连接」要如实报出这个端点的错', async () => {
    const failing = { ...mockProvider(async () => { throw new ProviderError('auth', 'bad key') }), id: 'openai-compat' }
    const free = { ...mockProvider(async r => ({ segments: r.segments, provider: 'google-web' })), id: 'google-web' }
    const t = await withChain([failing, free])
    // 不指名：链照常兜底，整页翻译不停死
    expect(await t.translate({ request: req })).toMatchObject({ ok: true, result: { provider: 'google-web' } })
    // 指名：直接报错，不能因为链上有免费兜底就显示成成功
    expect(await t.translate({ request: req, providerId: 'openai-compat' })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
  })

  it('指名一个不在链上的引擎：如实说，不悄悄换成别的', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments, provider: 'mock' }))])
    expect(await t.translate({ request: req, providerId: 'chrome-builtin' })).toEqual({ ok: false, error: { kind: 'unknown', message: '引擎 chrome-builtin 不在当前链上' } })
  })

  it('cancel 撤掉在飞的请求，撤掉的条数如实返回', async () => {
    vi.useFakeTimers()
    const t = await withChain([mockProvider(() => new Promise(() => undefined) as never)])
    const pending = t.translate({ request: req, scope: 'session-1' })
    await vi.advanceTimersByTimeAsync(200)
    expect(await t.cancel('session-1')).toBeGreaterThan(0)
    expect(await pending).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })
})

describe('createLocalTransport：状态', () => {
  const engine = (id: string, available: boolean): TranslationProvider => ({
    id,
    displayName: id === 'google-web' ? 'Google 网页翻译（免费）' : id,
    kind: 'mt',
    preservesMarkup: true,
    maxBatchChars: 1000,
    maxBatchItems: 4,
    isAvailable: async () => available,
    translate: async () => ({ segments: [], provider: id }),
  })

  it('首选可用时不报降级，能力字段取首选引擎的', async () => {
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

  it('首选不可用但链上有兜底时报出来：popup 据此保持「翻译」可点（Codex 在 #50 指出）', async () => {
    const t = await withChain([engine('chrome-builtin', false), engine('google-web', true)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toEqual({ id: 'google-web', displayName: 'Google 网页翻译（免费）' })
  })

  it('整条链都不可用时不报降级：这时按钮该是灰的', async () => {
    const t = await withChain([engine('openai-compat', false), engine('google-web', false)])
    expect((await t.status()).fallback).toBeUndefined()
  })

  it('只有一个引擎时也不报降级', async () => {
    const t = await withChain([engine('openai-compat', false)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toBeUndefined()
    expect(r.chain).toEqual(['openai-compat'])
  })

  it('降级之后 status 报的是实际在用的引擎与原因（§8.5）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = { ...engine('openai-compat', true), translate: async () => { throw new ProviderError('auth', 'bad key') } }
    const ok = { ...engine('google-web', true), translate: async (r: TranslateRequest) => ({ segments: r.segments, provider: 'google-web' }) }
    const t = await withChain([failing, ok])
    expect((await t.status()).engine).toEqual({ id: 'openai-compat', displayName: 'openai-compat' })
    expect((await t.translate({ request: req })).ok).toBe(true)
    expect((await t.status()).engine).toEqual({
      id: 'google-web',
      displayName: 'Google 网页翻译（免费）',
      demoted: { displayName: 'openai-compat', kind: 'auth', message: 'bad key' },
    })
  })
})

// Dexie + fake-indexeddb 靠真计时器调度，这一组不能用 fake timers
describe('createLocalTransport：缓存', () => {
  let n = 0
  const cacheOf = () => new TranslationCache({ db: createCacheDb(`axt-transport-${++n}`, { indexedDB, IDBKeyRange }) })
  const echo = (calls: string[][]) => mockProvider(async r => {
    calls.push(r.segments.map(s => s.id))
    return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock', model: 'm' }
  })
  const withCache = { paper: '2410.00260', renderPath: 'markup' as const }
  const two: TranslateRequest = { segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }], source: 'en', target: 'zh-CN' }

  it('首次全部未命中并写缓存；第二次全部命中不调用 provider', async () => {
    const calls: string[][] = []
    const t = await withChain([echo(calls)], { cache: portOf(cacheOf()) })
    const first = await t.translate({ request: two, cache: withCache })
    expect(first).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock' }, cached: 0 })
    const second = await t.translate({ request: two, cache: withCache })
    expect(second).toEqual({ ok: true, result: { segments: [{ id: 'a', text: '译:x' }, { id: 'b', text: '译:y' }], provider: 'mock' }, cached: 2 })
    expect(calls).toEqual([['a', 'b']])
  })

  it('部分命中只发未命中段落，按原顺序合并', async () => {
    const calls: string[][] = []
    const t = await withChain([echo(calls)], { cache: portOf(cacheOf()) })
    await t.translate({ request: { ...two, segments: [{ id: 'b', text: 'y' }] }, cache: withCache })
    const res = await t.translate({ request: { ...two, segments: [{ id: 'a', text: 'x' }, { id: 'b', text: 'y' }, { id: 'c', text: 'z' }] }, cache: withCache })
    expect(res.ok && res.cached).toBe(1)
    expect(res.ok && res.result.segments.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(calls).toEqual([['b'], ['a', 'c']])
  })

  it('不带 cache 的请求不读不写缓存（设置页的连接测试）', async () => {
    const calls: string[][] = []
    const cache = cacheOf()
    const t = await withChain([echo(calls)], { cache: portOf(cache) })
    await t.translate({ request: two })
    await t.translate({ request: two })
    expect(calls).toHaveLength(2)
    expect((await cache.stats()).entries).toBe(0)
  })
})

describe('chainConfigChanged：什么样的配置改动才重建链', () => {
  it('每个配置字段都被显式归类，两张表合起来正好覆盖 Config', () => {
    expect([...CHAIN_CONFIG_FIELDS, ...VOLATILE_CONFIG_FIELDS].sort()).toEqual(Object.keys(DEFAULT_CONFIG).sort())
  })

  it('切换显示模式、样式、预加载、术语表不重建：那时页面往往正在翻，重建会清掉令牌桶与降级记录', () => {
    const base = DEFAULT_CONFIG
    expect(chainConfigChanged(base, { ...base, mode: 'side' })).toBe(false)
    expect(chainConfigChanged(base, { ...base, style: { preset: 'quote', customCss: '' } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, preload: { margin: 42, threshold: 0.5 } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, glossary: [{ term: 'token', translation: '词元' }] })).toBe(false)
  })

  it('引擎、端点、模型、key、目标语言、提示词、降级开关改了就重建', () => {
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

  it('同值的新对象不算改动：storage 每次 watch 都给一份新解析结果', () => {
    expect(chainConfigChanged(DEFAULT_CONFIG, structuredClone(DEFAULT_CONFIG))).toBe(false)
  })
})
