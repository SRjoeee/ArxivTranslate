import { IDBKeyRange, indexedDB } from 'fake-indexeddb'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TranslationCache, createCacheDb } from '@/cache/store'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import { createChainHolder } from '@/entrypoints/background/chain'
import { createSessionRouter } from '@/entrypoints/background/sessions'
import { CHAIN_CONFIG_FIELDS, VOLATILE_CONFIG_FIELDS, chainConfigChanged, createLocalTransport } from '@/providers/transport'
import type { CachePort } from '@/providers/translate-service'
import { ProviderError, type TranslateRequest, type TranslationProvider } from '@/providers/types'

const req: TranslateRequest = { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh-CN' }

function mockProvider(translate: TranslationProvider['translate'], extra: Partial<TranslationProvider> = {}): TranslationProvider {
  return {
    id: 'mock', displayName: 'Mock', kind: 'llm', wireFormats: ['tags'] as const, maxBatchChars: 1000, maxBatchItems: 4,
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

describe('createLocalTransport：翻译', () => {
  it('成功响应形状', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }))])
    // The model rides only on the chosen service's engine: changing it must not expire a free engine's cache
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
    expect(await auth.translate({ request: req })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key', isolatable: false } })
    // 未知错误默认可重试：把重试关掉再看形状
    const boom = await withChain([mockProvider(async () => { throw new Error('boom') })], { queue: { maxRetries: 0 } })
    expect(await boom.translate({ request: req })).toEqual({ ok: false, error: { kind: 'unknown', message: 'boom', isolatable: true } })
  })

  it('指名引擎的调用不走降级链：设置页「测试连接」要如实报出这个端点的错', async () => {
    const failing = { ...mockProvider(async () => { throw new ProviderError('auth', 'bad key') }), id: SVC.id }
    const free = { ...mockProvider(async r => ({ segments: r.segments, provider: 'google-web' })), id: 'google-web' }
    const t = await withChain([failing, free])
    // 不指名：链照常兜底，整页翻译不停死
    expect(await t.translate({ request: req })).toMatchObject({ ok: true, result: { provider: 'google-web' } })
    // 指名：直接报错，不能因为链上有免费兜底就显示成成功
    expect(await t.translate({ request: req, providerId: SVC.id })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key', isolatable: false } })
  })

  it('指名一个自己配的、不在链上的服务：直接问那个端点，不能报「不在当前链上」', async () => {
    // 编辑一个没被选中的服务后点「连接」就是这个形状：链是围着选中的那个建的，被测的这个不在链上。
    // key 清空后端点报的是 no-key，正是设置页要显示的原因（Codex 在 #157 指出）
    const spare = { ...SVC, id: 'svc-99999999', apiKey: '' }
    const t = await createLocalTransport(
      { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC, spare] },
      { cancelled: new CancelledScopeRegistry(), buildChain: async () => ({ chain: [{ ...mockProvider(async r => ({ segments: r.segments, provider: 'mock' })), id: SVC.id }], renderPath: 'tags' as const }) },
    )
    expect(await t.translate({ request: req, providerId: spare.id })).toEqual({ ok: false, error: { kind: 'no-key', message: '未配置 API key', isolatable: false } })
  })

  it('指名一个不在链上的引擎：如实说，不悄悄换成别的', async () => {
    const t = await withChain([mockProvider(async r => ({ segments: r.segments, provider: 'mock' }))])
    expect(await t.translate({ request: req, providerId: 'chrome-builtin' })).toEqual({ ok: false, error: { kind: 'unknown', message: '引擎 chrome-builtin 不在当前链上', isolatable: false } })
  })

  it('cancel 撤掉在飞的请求，撤掉的条数如实返回', async () => {
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

  it('retire() while an unscoped batch is in flight: its answer comes back, nothing is cached', async () => {
    // Already at the endpoint when the chain is retired: the answer was paid for and is returned, but a retired
    // chain writes nothing — the check before the cache write, which used to look at the scope alone
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
    expect((await pending).ok).toBe(true)
    expect(writes).toEqual([])
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
    const router = createSessionRouter({ current: () => holder.current(), cancelled: registry, retireOthers: inForce => holder.retireOthers(inForce) })
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

describe('createLocalTransport：状态', () => {
  const engine = (id: string, available: boolean): TranslationProvider => ({
    id,
    displayName: id === 'google-web' ? 'Google 网页翻译（免费）' : id,
    kind: 'mt',
    wireFormats: ['tags'] as const,
    maxBatchChars: 1000,
    maxBatchItems: 4,
    isAvailable: async () => available,
    translate: async () => ({ segments: [], provider: id }),
  })

  it('首选可用时不报降级，能力字段取首选引擎的', async () => {
    const t = await withChain([engine(SVC.id, true), engine('google-web', true)])
    expect(await t.status()).toEqual({
      providerId: SVC.id,
      available: true,
      model: SVC.model,
      maxBatchChars: 1000,
      maxBatchItems: 4,
      renderPath: 'tags',
      targetLanguage: 'cmn',
      promptId: 'default',
      chain: [SVC.id, 'google-web'],
      demotions: [],
      revision: expect.any(Number),
      engine: { id: SVC.id, displayName: SVC.id },
    })
  })

  it('首选不可用但链上有兜底时报出来：popup 据此保持「翻译」可点（Codex 在 #50 指出）', async () => {
    const t = await withChain([engine('chrome-builtin', false), engine('google-web', true)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toEqual({ id: 'google-web', displayName: 'Google 网页翻译（免费）' })
  })

  it('整条链都不可用时不报降级：这时按钮该是灰的', async () => {
    const t = await withChain([engine(SVC.id, false), engine('google-web', false)])
    expect((await t.status()).fallback).toBeUndefined()
  })

  it('只有一个引擎时也不报降级', async () => {
    const t = await withChain([engine(SVC.id, false)])
    const r = await t.status()
    expect(r.available).toBe(false)
    expect(r.fallback).toBeUndefined()
    expect(r.chain).toEqual([SVC.id])
  })

  it('降级之后 status 报的是实际在用的引擎与原因（§8.5）', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = { ...engine(SVC.id, true), translate: async () => { throw new ProviderError('auth', 'bad key') } }
    const ok = { ...engine('google-web', true), translate: async (r: TranslateRequest) => ({ segments: r.segments, provider: 'google-web' }) }
    const t = await withChain([failing, ok])
    expect((await t.status()).engine).toEqual({ id: SVC.id, displayName: SVC.id })
    expect((await t.translate({ request: req })).ok).toBe(true)
    expect((await t.status()).engine).toEqual({
      id: 'google-web',
      displayName: 'Google 网页翻译（免费）',
      demoted: { id: SVC.id, displayName: SVC.id, kind: 'auth', message: 'bad key' },
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
  const withCache = { paper: '2410.00260', renderPath: 'tags' as const }
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
    expect(chainConfigChanged(base, { ...base, appearance: { ...base.appearance, activeStyle: 'green' } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, preload: { margin: 42, threshold: 0.5 } })).toBe(false)
    expect(chainConfigChanged(base, { ...base, glossary: [{ term: 'token', translation: '词元' }] })).toBe(false)
    // 图片翻译的模式闸（§15）只是显示闸，用户翻着页勾掉一个模式不该把队列清掉
    expect(chainConfigChanged(base, { ...base, image: { enabled: true, modes: ['side'] } })).toBe(false)
  })

  it('引擎、端点、模型、key、目标语言、提示词、降级开关改了就重建', () => {
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

  it('同值的新对象不算改动：storage 每次 watch 都给一份新解析结果', () => {
    expect(chainConfigChanged(DEFAULT_CONFIG, structuredClone(DEFAULT_CONFIG))).toBe(false)
  })
})
