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

/** 记录调用的假缓存端口 */
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
  it('缓存读写各一次批量调用，不是每段一次；同一次调用的段落攒成一批发给 provider', async () => {
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

  it('命中的段落不再发给 provider，返回按原顺序合并', async () => {
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

  it('不带 cache 字段时完全不碰缓存（设置页的连接测试）', async () => {
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

  it('provider 抛错转成错误响应，不抛出；auth 不重试', async () => {
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }),
    })
    expect(await service.translate(req(['a']))).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    expect(calls).toBe(1)
  })

  it('缓存读失败不影响翻译（端口自行降级为未命中）', async () => {
    const port: CachePort = { getMany: async keys => keys.map(() => null), putMany: vi.fn(async () => {}) }
    const service = createTranslateService({
      getProvider: async () => provider(async r => ({ segments: r.segments.map(s => ({ ...s, text: '译' })), provider: 'mock' })),
      cache: port,
    })
    const res = await service.translate(req(['a']))
    expect(res.ok && res.cached).toBe(0)
    expect(port.putMany).toHaveBeenCalled()
  })

  it('cache.bypass：只写不读，重发不会拿回缓存里那份坏译文（Codex 在 #9 指出）', async () => {
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
    // 覆盖后普通请求命中的是新译文
    const third = await service.translate(req(['a']))
    expect(calls).toBe(2)
    expect(third.ok && third.result.segments[0]?.text).toBe('译2:text-a')
  })

  it('accept 回调：没放行的译文照常返回，但不写缓存（Codex 在 #30 指出）', async () => {
    const { port, writes } = fakePort()
    const service = createTranslateService({
      getProvider: async () => provider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' })),
      cache: port,
    })
    const res = await service.translate({ ...req(['a', 'b']), accept: (id: string) => id !== 'a' })
    expect(res.ok && res.result.segments.map(s => s.text)).toEqual(['译:text-a', '译:text-b'])
    expect(writes).toHaveLength(1)
    expect(writes[0]!.map(w => w.translation)).toEqual(['译:text-b'])
  })

  it('一次调用横跨两批、一批失败：成功的那批照样写缓存，调用整体报失败', async () => {
    const { port, writes } = fakePort()
    const service = createTranslateService({
      // 每批最多 2 条：a、b 一批，c 一批；含 c 的批报错
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

  it('id 对不上：BatchQueue 整批重试后逐条兜底，RequestQueue 自己不重试（否则兜底前要打 12 次）', async () => {
    const seen: string[][] = []
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        seen.push(r.segments.map(s => s.id))
        if (r.segments.length > 1) throw new ProviderError('invalid-response', 'id 对不上')
        return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' }
      }),
      batch: { maxRetries: 1 },
      queue: { baseRetryDelayMs: 0 },
    })
    const res = await service.translate(req(['a', 'b']))
    expect(res.ok).toBe(true)
    // 整批 1 次 + 重试 1 次 + 逐条 2 次
    expect(seen).toEqual([['a', 'b'], ['a', 'b'], ['a'], ['b']])
  })
})

describe('攒批不看引擎种类，只看它能装多少（§8.3，2026-09-06）', () => {
  /** 记录 provider 每次真的收到哪些段 */
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

  it('免费引擎（kind: mt）的多次调用攒进同一个请求：以前只有 LLM 攒批，它一次调用一个请求', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 100, maxBatchChars: 8000 })
    const service = createTranslateService({ getProvider: async () => mt })
    const all = Promise.all([service.translate(req(['a'])), service.translate(req(['b'])), service.translate(req(['c']))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b', 'c']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('装得下多少就攒多少：超过 maxBatchItems 的部分另起一批', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 2, maxBatchChars: 8000 })
    const service = createTranslateService({ getProvider: async () => mt })
    const all = Promise.all(['a', 'b', 'c'].map(id => service.translate(req([id]))))
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b'], ['c']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('不看上下文的引擎，章节标题不进批次键：否则每换一节就换一次键，跨不了章节攒批', async () => {
    vi.useFakeTimers()
    const { calls, provider: mt } = recorder({ kind: 'mt', maxBatchItems: 100, maxBatchChars: 8000 })
    const service = createTranslateService({ getProvider: async () => mt })
    const all = Promise.all([service.translate(withContext(['a'], '第一节')), service.translate(withContext(['b'], '第二节'))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls).toEqual([['a', 'b']])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('有提示词的引擎照旧按上下文分批：章节标题会进 prompt，混批会串味', async () => {
    vi.useFakeTimers()
    const { calls, provider: llm } = recorder({ kind: 'llm', maxBatchItems: 100, maxBatchChars: 8000, promptKey: 'default' })
    const service = createTranslateService({ getProvider: async () => llm })
    const all = Promise.all([service.translate(withContext(['a'], '第一节')), service.translate(withContext(['b'], '第二节'))])
    await vi.advanceTimersByTimeAsync(200)
    expect(calls.map(c => c.join()).sort()).toEqual(['a', 'b'])
    expect((await all).every(r => r.ok)).toBe(true)
  })

  it('provider 声明的 maxConcurrent 生效：并发闸与令牌桶是两种闸', async () => {
    vi.useFakeTimers()
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    // 速率放开（20/s、突发 20），只靠并发闸卡住：同时在飞不能超过 2
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

describe('createTranslateService：限流、超时、取消（fake timers）', () => {
  const log = () => {
    const calls: { id: string; t: number }[] = []
    return { calls, note: (ids: string[]) => calls.push({ id: ids.join('+'), t: Date.now() }) }
  }

  it('429：暂停窗口内后来的请求不发；窗口过后只剩一个令牌、按 scheduleAt 先来先发，其余按速率放行（Codex 在 #6 / #10 / #30 指出）', async () => {
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
    // 基础暂停 5s：4.9s 内 b 不能发
    await vi.advanceTimersByTimeAsync(4_900)
    expect(calls).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(300)
    // 暂停结束（基础 5s，Math.random 钉 0 没有抖动）：暂停期间桶按速率补满（容量 1）。
    // b 的批一直被派发闸扣着（暂停期间没有空位就继续攒），所以队列里只有 a 的重试，它先用掉那个令牌
    expect(calls.map(c => c.id)).toEqual(['a', 'a'])
    // 闸每秒探一次，b 刷出后再等下一个令牌：与 a 的重试至少隔一个令牌周期
    for (let i = 0; i < 50 && calls.length < 3; i++) await vi.advanceTimersByTimeAsync(100)
    expect(calls.map(c => c.id)).toEqual(['a', 'a', 'b'])
    expect(calls[2]!.t - calls[1]!.t).toBeGreaterThanOrEqual(1_000)
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok && rb.ok).toBe(true)
  })

  it('两个同时撞 429：算一个暂停窗口，窗口内谁都不发，窗口过后都重发成功', async () => {
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
    // 基础窗口 5s 内一个都不重发
    await vi.advanceTimersByTimeAsync(4_900)
    expect(calls).toHaveLength(2)
    // 窗口过后（第二个 429 可能把窗口延长）两个都重发：暂停期间桶按速率补回容量 2，一起放行
    for (let i = 0; i < 120 && calls.length < 4; i++) await vi.advanceTimersByTimeAsync(100)
    expect(calls).toHaveLength(4)
    expect(calls[2]!.t - calls[0]!.t).toBeGreaterThanOrEqual(5_000)
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok && rb.ok).toBe(true)
  })

  it('provider 挂住不返回：按字数算的超时到了就重试，重试用尽转成 timeout 错误响应，不会永远等', async () => {
    // 实测 2312.17527：最后一块等了 220s 还没回，整篇停在"进行中"
    vi.useFakeTimers()
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(() => { calls++; return new Promise(() => {}) }), // 不配合 signal 也不返回
      queue: { timeoutMs: 20, maxRetries: 1, baseRetryDelayMs: 0 },
    })
    const pending = service.translate({ request: { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh' } })
    await vi.advanceTimersByTimeAsync(10_000)
    const res = await pending
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('timeout')
    expect(calls).toBe(2) // 首次 + 重试一次
  })

  it('cancel(scope)：排队与在飞的请求一起撤，signal 被 abort，不写缓存；同 scope 的后续调用直接 aborted', async () => {
    // 真计时器：算缓存键要走 crypto.subtle，fake timers 下不会返回
    const { port, writes } = fakePort()
    let signal: AbortSignal | undefined
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        calls++
        signal = r.signal
        await new Promise(() => {}) // 挂住，等被取消
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
