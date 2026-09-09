import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RenderPath } from '@/cache/key'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import type { CachedEntry } from '@/cache/store'
import { createTranslateService, type CacheEntry, type CachePort } from '@/providers/translate-service'
import { ProviderError, type TranslationProvider } from '@/providers/types'

const provider = (translate: TranslationProvider['translate'], id = 'mock', extra: Partial<TranslationProvider> = {}): TranslationProvider => ({
  id, displayName: id, kind: 'llm', wireFormats: ['tags'] as const,
  maxBatchChars: 1000, maxBatchItems: 4,
  isAvailable: async () => true, translate,
  ...extra,
})

/** 记录调用的假缓存端口 */
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
    const service = createTranslateService({
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
    const service = createTranslateService({
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
    const service = createTranslateService({
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
    const service = createTranslateService({ getProvider: async () => withAlignment({}), cache: port })
    const first = await service.translate(req(['a']))
    expect(first.ok).toBe(true)
    const [key] = [...store.keys()]
    // 伪造一条切分对不上的记录
    store.set(key!, { translation: '译:text-a', alignment: { source: [999], target: [1] } })
    const second = await service.translate(req(['a']))
    expect(second.ok && second.cached).toBe(1)
    expect(second.ok && second.result.segments[0]?.alignment).toBeUndefined()
    expect(second.ok && second.result.segments[0]?.text).toBe('译:text-a')
  })
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

  it('auth 之后这个引擎本轮不再打端点：后到的块当场拒，不发第二波（issue #96）', async () => {
    // `failQueue` 排空的是**那一刻**排在 RequestQueue 里的任务。并发槽占满时等待区恰好是空的，
    // 剩下的块还在 BatchQueue 里攒批，攒完照常派发——实测第一个 401 之后 +744 ms 又发了 7 个请求
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }),
    })
    expect(await service.translate({ ...req(['a']), scope: 's1' })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    expect(calls).toBe(1)
    // 后到的块（视口滚动、攒批攒满）：同样报 auth，但不再问端点
    expect(await service.translate({ ...req(['b', 'c']), scope: 's1' })).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
    expect(calls).toBe(1)
    // 换一个会话（新页面，或用户改完 key 重翻）要重新试：致命是这一轮的事，不是这个引擎的事
    await service.translate({ ...req(['d']), scope: 's2' })
    expect(calls).toBe(2)
    // 无 scope 的调用（设置页的「测试连接」）不受任何会话的致命状态影响
    await service.translate(req(['e']))
    expect(calls).toBe(3)
  })

  it('去重把两个会话并进同一个任务时，两个 scope 都要记上（Codex 在 #113 指出）', async () => {
    // 两个标签页翻同一篇的同一段：BatchQueue / RequestQueue 按 dedupKey 合并，
    // 执行那头只看得见先到的那份 QueueItem。记在执行路径上的话第二个 scope 漏掉，
    // 它后面的批次照样发得出去，第二波又回来了
    let calls = 0
    const { port } = fakePort()
    const service = createTranslateService({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }),
      cache: port,
    })
    const [a, b] = await Promise.all([
      service.translate({ ...req(['x']), scope: 'tabA' }),
      service.translate({ ...req(['x']), scope: 'tabB' }),
    ])
    expect([a.ok, b.ok]).toEqual([false, false])
    const afterFirst = calls
    // 两个会话各自的后续块都不该再问端点
    await service.translate({ ...req(['y']), scope: 'tabA' })
    await service.translate({ ...req(['z']), scope: 'tabB' })
    expect(calls).toBe(afterFirst)
  })

  it('同一次调用里「满批 + 欠满的尾巴」：满批失败后尾巴不许再发出去（Codex 在 #113 指出）', async () => {
    // 图片 OCR 的行数不受 provider 的 maxBatchItems 约束，一次调用会被拆成满批 + 尾巴。
    // 满批按条数立刻派发、秒失败，尾巴还在等 batchDelay。等 allSettled 才记状态的话，
    // 它得先把尾巴等出来——而尾巴是**发出去**才失败的
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async () => { calls++; throw new ProviderError('auth', 'bad key') }, 'mock', { maxBatchItems: 2 }),
    })
    const res = await service.translate({ ...req(['a', 'b', 'c', 'd', 'e']), scope: 's1' })
    expect(res.ok).toBe(false)
    // 5 条 / 每批 2 条 = 满批 + 满批 + 尾巴。两个满批同 tick 就按条数派发出去了，拦不住
    //（和 8 个并发槽被占满同理）；要挡住的是还在攒的那条尾巴——它不该变成第三个请求
    expect(calls).toBe(2)
  })

  it('新会话并进一个已致命会话的批次时，这一批照常发（Codex 在 #113 指出）', async () => {
    // 去重按缓存键合并：被保留的 QueueItem 带的是旧（已致命的）scope，新会话只出现在 meta.scopes 里。
    // 只看 item.scope 的话会把这一批当死的拒掉，把陈旧的 auth 回给新调用方，再把新 scope 也标成致命
    let calls = 0
    const { port } = fakePort()
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        calls++
        if (calls === 1) throw new ProviderError('auth', 'bad key')
        return { segments: r.segments.map(s => ({ ...s, text: '译' })), provider: 'mock' }
      }),
      cache: port,
    })
    // 先让 s1 致命
    expect((await service.translate({ ...req(['a']), scope: 's1' })).ok).toBe(false)
    // s1 与 s2 同一 tick 发同一段：攒进同一批，meta.scopes = [s1, s2]
    const [dead, live] = await Promise.all([
      service.translate({ ...req(['b']), scope: 's1' }),
      service.translate({ ...req(['b']), scope: 's2' }),
    ])
    // 批里还有活着的订阅者，就不能当死的拒掉
    expect(live.ok && live.result.segments[0]?.text).toBe('译')
    expect(dead.ok).toBe(true)
    expect(calls).toBe(2)
  })

  it('只有 no-key / auth 黏：别的错不该把整轮翻译废掉', () => {
    // 与 fallback.ts 的 PERMANENT_KINDS 同一份判断。bad-request 是「这一批的问题」，
    // 换一批就可能好，黏住它等于因为一个坏块放弃整篇
    let calls = 0
    const service = createTranslateService({
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
    const again = await service.translate({ ...req(['a']), cache: { paper: '2410.00260', renderPath: 'tags', bypass: true } })
    expect(calls).toBe(2)
    expect(reads).toHaveLength(1)
    expect(writes).toHaveLength(2)
    expect(again.ok && again.result.segments[0]?.text).toBe('译2:text-a')
    // 覆盖后普通请求命中的是新译文
    const third = await service.translate(req(['a']))
    expect(calls).toBe(2)
    expect(third.ok && third.result.segments[0]?.text).toBe('译2:text-a')
  })

  it('占位符校验不过的译文照常返回，但不写缓存（Codex 在 #30 指出）', async () => {
    // 期望从请求文本反推，不再靠调用方传 accept 回调（issue #42）：a 的译文丢了 <x id="1"/>
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

  it('markers 路径的校验按 renderPath 分派：拿 tags 的分词器扫会一个占位符都认不出来（#104）', async () => {
    // 这是本次改动最容易漏的那个洞：expectationsFromText 若不按格式分派，slots 为空 → 校验恒真 →
    // 被打烂的译文静默进缓存。b 的译文完整、a 丢了记号，只有 b 该入库
    const { port, writes } = fakePort()
    const service = createTranslateService({
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

  it('反推的期望对纯文本同样生效：runs 路径的译文凭空多出标签也不入库', async () => {
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

describe('系统性失败不该被批级重试放大（Codex 在 #61 指出）', () => {
  const callOf = (n: number) => ({
    request: { segments: Array.from({ length: n }, (_, i) => ({ id: `s${i}`, text: `text-${i}` })), source: 'en' as const, target: 'zh-CN' },
  })

  it('声明 isolatable: false 的 invalid-response 立刻上报，不重试不逐条兜底', async () => {
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async () => {
        calls++
        // 免费引擎返回的整个响应就不是 JSON：拆多小都一样
        throw new ProviderError('invalid-response', '返回的不是 JSON', { isolatable: false })
      }, 'mock', { kind: 'mt', maxBatchItems: 100 }),
    })
    const res = await service.translate(callOf(8))
    expect(res).toMatchObject({ ok: false, error: { kind: 'invalid-response' } })
    // 一次就够：转成批次错误的话是 1 + 3 次重试 + 8 次逐条 = 12 次
    expect(calls).toBe(1)
  })

  it('可拆分的 invalid-response 照旧重试并逐条兜底：拆小能定位到闯祸的那一段', async () => {
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        calls++
        // 只有多段一起发才坏；单段发就好了
        if (r.segments.length > 1) throw new ProviderError('invalid-response', 'id 对不上')
        return { segments: r.segments, provider: 'mock' }
      }, 'mock', { kind: 'llm', maxBatchItems: 100 }),
      batch: { maxRetries: 1 },
    })
    const res = await service.translate(callOf(3))
    expect(res.ok).toBe(true)
    // 首次 + 1 次重试 + 3 次逐条
    expect(calls).toBe(5)
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

describe('句子标记：引擎不汇报句边界时由服务层插（§8.6）', () => {
  /** 只在收到的文本里保留标记、把英文换成中文的假引擎——正是 Google 的行为 */
  const echoing = (transform: (text: string) => string, extra: Partial<TranslationProvider> = {}) =>
    provider(async ({ segments }) => ({ segments: segments.map(s => ({ id: s.id, text: transform(s.text) })), provider: 'mock' }), 'mock', extra)

  // 切点由调用方给：选哪里切要看块本身（§8.6），服务层只按给的位置插
  const twoSentences = (ids: string[]) => ({
    request: { segments: ids.map(id => ({ id, text: 'One sentence here. Two sentences here.', cuts: [19] })), source: 'en' as const, target: 'zh-CN' },
    cache: { paper: 'p', renderPath: 'tags' as RenderPath },
  })

  it('插标记、摘标记，并把两侧边界作为对齐带出来', async () => {
    let sent = ''
    const service = createTranslateService({
      getProvider: async () => echoing(t => { sent = t; return t.replace('One sentence here. ', '第一句。').replace('Two sentences here.', '第二句。') }),
    })
    const res = await service.translate(twoSentences(['a']))
    expect(res.ok).toBe(true)
    // 送出去的那份带标记
    expect(sent).toMatch(/<x id="\d+"\/>/)
    if (!res.ok) return
    const seg = res.result.segments[0]!
    // 回来的译文一个标记都不剩
    expect(seg.text).toBe('第一句。第二句。')
    expect(seg.alignment).toEqual({ source: [19, 19], target: [4, 4] })
  })

  it('调用方没给切点就不插——选哪里切要看块本身（§8.6）', async () => {
    let sent = ''
    const service = createTranslateService({ getProvider: async () => echoing(t => { sent = t; return '译文' }) })
    await service.translate({
      request: { segments: [{ id: 'a', text: 'One sentence here. Two sentences here.' }], source: 'en', target: 'zh-CN' },
      cache: { paper: 'p', renderPath: 'tags' as RenderPath },
    })
    expect(sent).toBe('One sentence here. Two sentences here.')
  })

  it('引擎自己汇报的就不插', async () => {
    let sent = ''
    const service = createTranslateService({
      getProvider: async () => echoing(t => { sent = t; return '译文' }, { reportsSentences: true }),
    })
    await service.translate(twoSentences(['a']))
    expect(sent).toBe('One sentence here. Two sentences here.')
  })

  it('标记被引擎丢了：不给对齐，但文本照样干净', async () => {
    // 没有对齐只是没有高亮；而残留的标记会让 validate 判定占位符对不上、整块翻译作废
    const service = createTranslateService({
      getProvider: async () => echoing(() => '第一句。第二句。'),
    })
    const res = await service.translate(twoSentences(['a']))
    if (!res.ok) return
    expect(res.result.segments[0]!.text).toBe('第一句。第二句。')
    expect(res.result.segments[0]!.alignment).toBeUndefined()
  })

  it('标记乱序：不给对齐，且把残留的标记摘干净', async () => {
    const service = createTranslateService({
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

  it('单句块不插标记，但照样给出整段对整段的对齐', async () => {
    // 空切点数组说的是「这一块只有一句」。整段对整段是安全的对齐，不需要任何标记，
    // 而单句块占正文一大半——把它和「不该对齐」混为一谈等于把它们全排除在高亮之外
    let sent = ''
    const service = createTranslateService({ getProvider: async () => echoing(t => { sent = t; return '一句译文。' }) })
    const res = await service.translate({
      request: { segments: [{ id: 'a', text: 'Only one sentence here.', cuts: [] }], source: 'en', target: 'zh-CN' },
      cache: { paper: 'p', renderPath: 'tags' as RenderPath },
    })
    expect(sent).toBe('Only one sentence here.')
    if (!res.ok) return
    expect(res.result.segments[0]!.alignment).toEqual({ source: ['Only one sentence here.'.length], target: ['一句译文。'.length] })
  })

  it('插完会超出引擎单次上限就不插', async () => {
    // `BatchQueue` 的字符上限只拦「合批」，一条任务超了也照发不误（Codex 在 #137 指出）。
    // 没有对齐只是没有高亮，而超限是整批失败
    let sent = ''
    const text = `${'x'.repeat(40)}. ${'y'.repeat(40)}.`
    const service = createTranslateService({
      getProvider: async () => echoing(t => { sent = t; return '译文' }, { maxBatchChars: text.length + 5 }),
    })
    await service.translate({
      request: { segments: [{ id: 'a', text, cuts: [42] }], source: 'en', target: 'zh-CN' },
      cache: { paper: 'p', renderPath: 'tags' as RenderPath },
    })
    expect(sent).toBe(text)
  })

  it('切点进缓存键：同样的线上文本、不同的切点不能互相命中', async () => {
    // 两个块可以序列化成同一份线上文本而槽位语义不同，`cutsOf` 因此给出不同切点。
    // 键里不带它，第二个块会命中第一个的条目，连同对不上的那份对齐（Codex 在 #137 指出）
    const { port, writes } = fakePort()
    const service = createTranslateService({ getProvider: async () => echoing(() => '译文一。译文二。'), cache: port })
    const text = 'One sentence here. Two sentences here.'
    await service.translate({ request: { segments: [{ id: 'a', text, cuts: [19] }], source: 'en', target: 'zh-CN' }, cache: { paper: 'p', renderPath: 'tags' as RenderPath } })
    await service.translate({ request: { segments: [{ id: 'b', text, cuts: [] }], source: 'en', target: 'zh-CN' }, cache: { paper: 'p', renderPath: 'tags' as RenderPath } })
    const keys = writes.flat().map(w => w.key)
    expect(new Set(keys).size).toBe(2)
  })

  it('只有 tags 这条路插：markers 没有活得下来的标记，runs 的段拼回去没有线上偏移', async () => {
    for (const renderPath of ['markers', 'runs'] as RenderPath[]) {
      let sent = ''
      const service = createTranslateService({ getProvider: async () => echoing(t => { sent = t; return '译文' }) })
      await service.translate({
        request: { segments: [{ id: 'a', text: 'One sentence here. Two sentences here.', cuts: [19] }], source: 'en', target: 'zh-CN' },
        cache: { paper: 'p', renderPath },
      })
      expect([renderPath, sent]).toEqual([renderPath, 'One sentence here. Two sentences here.'])
    }
  })

  it('不带缓存的调用（连接测试）也不插', async () => {
    let sent = ''
    const service = createTranslateService({ getProvider: async () => echoing(t => { sent = t; return '译文' }) })
    await service.translate({ request: { segments: [{ id: 'a', text: 'One sentence here. Two sentences here.', cuts: [19] }], source: 'en', target: 'zh-CN' } })
    expect(sent).toBe('One sentence here. Two sentences here.')
  })
})
