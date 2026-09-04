import { describe, expect, it, vi } from 'vitest'
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
})
