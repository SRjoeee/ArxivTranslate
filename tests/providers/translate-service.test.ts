import { describe, expect, it, vi } from 'vitest'
import { attachRequestErrorMeta } from '@/providers/retry-policy'
import { createTranslateService, type CacheEntry, type CachePort } from '@/providers/translate-service'
import { ProviderError, type TranslationProvider } from '@/providers/types'

const provider = (translate: TranslationProvider['translate'], id = 'mock'): TranslationProvider => ({
  id, displayName: id, kind: 'llm', preservesMarkup: true,
  maxBatchChars: 1000, maxBatchItems: 4, concurrency: 2,
  isAvailable: async () => true, translate,
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

describe('createTranslateService', () => {
  it('缓存读写各一次批量调用，不是每段一次', async () => {
    const { port, reads, writes } = fakePort()
    const service = createTranslateService({
      getProvider: async () => provider(async r => ({ segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' })),
      getModel: async () => 'm/1',
      cache: port,
    })
    const res = await service(req(['a', 'b', 'c']))
    expect(res.ok).toBe(true)
    expect(reads).toHaveLength(1)
    expect(reads[0]).toHaveLength(3)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toHaveLength(3)
  })

  it('命中的段落不再发给 provider，返回按原顺序合并', async () => {
    const { port } = fakePort()
    const calls: string[][] = []
    const service = createTranslateService({
      getProvider: async () => provider(async r => { calls.push(r.segments.map(s => s.id)); return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' } }),
      getModel: async () => 'm/1',
      cache: port,
    })
    await service(req(['a', 'b']))
    const second = await service(req(['a', 'b', 'c']))
    expect(calls).toEqual([['a', 'b'], ['c']])
    expect(second.ok && second.cached).toBe(2)
    expect(second.ok && second.result.segments.map(s => s.id)).toEqual(['a', 'b', 'c'])
    expect(second.ok && second.result.segments[2]?.text).toBe('译:text-c')
  })

  it('不带 cache 字段时完全不碰缓存（设置页的连接测试）', async () => {
    const { port, reads, writes } = fakePort()
    const service = createTranslateService({
      getProvider: async () => provider(async r => ({ segments: r.segments, provider: 'mock' })),
      cache: port,
    })
    const res = await service({ request: { segments: [{ id: 'x', text: 'hi' }], source: 'en', target: 'zh-CN' } })
    expect(res.ok).toBe(true)
    expect(reads).toHaveLength(0)
    expect(writes).toHaveLength(0)
  })

  it('provider 抛错转成错误响应，不抛出', async () => {
    const service = createTranslateService({
      getProvider: async () => provider(async () => { throw new ProviderError('auth', 'bad key') }),
      retry: { maxRetries: 0 },
    })
    expect(await service(req(['a']))).toEqual({ ok: false, error: { kind: 'auth', message: 'bad key' } })
  })

  it('缓存读失败不影响翻译（端口自行降级为未命中）', async () => {
    const port: CachePort = { getMany: async keys => keys.map(() => null), putMany: vi.fn(async () => {}) }
    const service = createTranslateService({
      getProvider: async () => provider(async r => ({ segments: r.segments.map(s => ({ ...s, text: '译' })), provider: 'mock' })),
      cache: port,
    })
    const res = await service(req(['a']))
    expect(res.ok && res.cached).toBe(0)
    expect(port.putMany).toHaveBeenCalled()
  })

  it('provider 挂住不返回时按超时重试，重试用尽转成错误响应，而不是永远等待', async () => {
    // 实测 2312.17527：最后一块等了 220s 还没回，整篇停在"进行中"
    let calls = 0
    const provider = {
      id: 'stuck', preservesMarkup: true, maxBatchChars: 1000, maxBatchItems: 10, concurrency: 1,
      isAvailable: async () => true,
      translate: () => { calls++; return new Promise<never>(() => {}) }, // 不配合 signal 也不返回
    }
    const translate = createTranslateService({
      getProvider: async () => provider as never,
      requestTimeoutMs: 20,
      retry: { maxRetries: 1, baseRetryDelayMs: 0, sleep: async () => {} },
    })
    const res = await translate({ request: { segments: [{ id: 'a', text: 'x' }], source: 'en', target: 'zh' } })
    expect(res.ok).toBe(false)
    expect(calls).toBe(2) // 首次 + 重试一次
    if (!res.ok) expect(res.error.kind).toBe('timeout')
  })

  it('cache.bypass：只写不读，重发不会拿回缓存里那份坏译文（Codex 在 #9 指出）', async () => {
    const { port, reads, writes } = fakePort()
    let calls = 0
    const service = createTranslateService({
      getProvider: async () => provider(async r => { calls++; return { segments: r.segments.map(s => ({ ...s, text: `译${calls}:${s.text}` })), provider: 'mock' } }),
      getModel: async () => 'm/1',
      cache: port,
    })
    await service(req(['a']))
    const again = await service({ ...req(['a']), cache: { paper: '2410.00260', renderPath: 'markup', bypass: true } })
    expect(calls).toBe(2)
    expect(reads).toHaveLength(1)
    expect(writes).toHaveLength(2)
    expect(again.ok && again.result.segments[0]?.text).toBe('译2:text-a')
    // 覆盖后普通请求命中的是新译文
    const third = await service(req(['a']))
    expect(calls).toBe(2)
    expect(third.ok && third.result.segments[0]?.text).toBe('译2:text-a')
  })

  it('429 暂停整条队列：排在后面的请求等暂停结束再发，不会一起撞限流（Codex 在 #6 / #10 指出）', async () => {
    const order: string[] = []
    const resolvers: (() => void)[] = []
    let first = true
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        order.push(`call:${r.segments[0]?.id}`)
        if (first) {
          first = false
          throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
        }
        return { segments: r.segments, provider: 'mock' }
      }, 'mock'),
      // 睡眠由测试放行：暂停期间队列是不是真的停了才看得出来
      retry: { sleep: () => new Promise<void>(resolve => { resolvers.push(resolve); order.push('sleep') }) },
    })
    const a = service(req(['a']))
    await vi.waitFor(() => expect(order).toContain('sleep'))
    // 队列并发 2：不暂停的话 b 会立刻发出去
    const b = service(req(['b']))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(order).not.toContain('call:b')
    resolvers.splice(0).forEach(resolve => resolve())
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.ok && rb.ok).toBe(true)
    expect(order.indexOf('call:b')).toBeGreaterThan(order.indexOf('sleep'))
  })

  it('在飞的任务每次尝试前也要过共享暂停这道闸：自己睡醒了、暂停还没结束就接着等（Codex 在 #30 指出）', async () => {
    let calls = 0
    const resolvers: (() => void)[] = []
    const service = createTranslateService({
      getProvider: async () => provider(async r => {
        if (calls++ === 0) throw attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '1' }, isRetryable: true })
        return { segments: r.segments, provider: 'mock' }
      }, 'gated'),
      retry: { sleep: () => new Promise<void>(resolve => { resolvers.push(resolve) }) },
    })
    const a = service(req(['a']))
    // 429 后有两次 sleep：withRetry 自己的，与队列暂停的
    await vi.waitFor(() => expect(resolvers).toHaveLength(2))
    // 只放行任务自己的那次：它醒了，但共享暂停还在，不能再打端点
    resolvers[0]!()
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(calls).toBe(1)
    resolvers[1]!()
    const ra = await a
    expect(ra.ok).toBe(true)
    expect(calls).toBe(2)
  })
})
