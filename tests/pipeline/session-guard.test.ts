// 会话边界的回归测试（issue #45）。原文是三个「断言缺陷存在」的诊断探针，这里改写成期望行为。
import { describe, expect, it, vi } from 'vitest'
import { CACHE_READ_TIMEOUT_MS, createMessageCachePort } from '@/entrypoints/content/cache-port'
import { extract } from '@/core/extractor'
import { startTranslation } from '@/core/pipeline'
import { restore } from '@/core/renderer'
import { createOpenAICompatProvider } from '@/providers/openai-compat'
import { cacheKeyFor } from '@/cache/key'

const docWith = (html: string) => new DOMParser().parseFromString(
  `<!doctype html><html><body><article class="ltx_document">${html}</article></body></html>`,
  'text/html',
)

const paragraphs = (n: number) => Array.from({ length: n }, (_, i) => `<p class="ltx_p">Sentence ${i}.</p>`).join('')

describe('启动期间恢复原文（issue #45 实验 1）', () => {
  it('让出主线程后不再写任何标记：restore 清干净之后不能留下孤儿 data-axt-*', async () => {
    const doc = docWith(paragraphs(40))
    const before = doc.documentElement.outerHTML
    const blocks = extract(doc)
    expect(blocks.length).toBeGreaterThan(1)

    const run = startTranslation({
      doc,
      blocks,
      target: 'cmn',
      mode: 'stack',
      paper: '0000.00000',
      capabilities: { maxBatchChars: 1000, maxBatchItems: 4, preservesMarkup: true },
      preload: { margin: 1000, threshold: 0 },
      transport: async () => ({ ok: false, error: { kind: 'aborted', message: '不该发出请求' } }),
    })
    // 标记循环刚开始就停：初始化在让出主线程时被打断
    run.stop()
    restore(doc)
    await run.ready

    expect(doc.querySelectorAll('[data-axt-id]')).toHaveLength(0)
    expect(doc.querySelectorAll('[data-axt-state]')).toHaveLength(0)
    // DOM 逐节点回到最初（§7.1）
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})

describe('缓存读取的等待预算（issue #45 实验 2）', () => {
  it('缓存消息一直不回时，超过预算就当未命中，不把翻译卡死', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const port = createMessageCachePort(() => new Promise(() => undefined) as never, 20)
    const hits = await port.getMany(['k1', 'k2'])
    expect(hits).toEqual([null, null])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('读缓存'))
    warn.mockRestore()
  })

  it('正常返回时不受预算影响，命中照常返回', async () => {
    const port = createMessageCachePort(async () => ({ hits: ['甲', null] }) as never, 50)
    expect(await port.getMany(['k1', 'k2'])).toEqual(['甲', null])
  })

  it('条数对不上按全未命中处理，坏响应不能错位', async () => {
    const port = createMessageCachePort(async () => ({ hits: ['甲'] }) as never, 50)
    expect(await port.getMany(['k1', 'k2'])).toEqual([null, null])
  })

  it('预算是常量，改动要显式：默认 1.5 秒远大于实测命中往返（36 ms 量级）', () => {
    expect(CACHE_READ_TIMEOUT_MS).toBe(1_500)
  })
})

describe('服务层也有读缓存预算：换任何 CachePort 都不会被拖死（issue #45 实验 2）', () => {
  it('CachePort 永不返回时，翻译照常发出请求', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const { createTranslateService } = await import('@/providers/translate-service')
    const calls: string[][] = []
    const service = createTranslateService({
      getProvider: async () => ({
        id: 'mock', displayName: 'mock', kind: 'llm', preservesMarkup: true, maxBatchChars: 1000, maxBatchItems: 4,
        isAvailable: async () => true,
        translate: async r => { calls.push(r.segments.map(s => s.id)); return { segments: r.segments.map(s => ({ ...s, text: `译:${s.text}` })), provider: 'mock' } },
      }),
      cache: { getMany: () => new Promise(() => undefined), putMany: async () => undefined },
      cacheReadBudgetMs: 20,
    })
    const res = await service.translate({
      request: { segments: [{ id: 'a', text: 'A' }], source: 'en', target: 'cmn' },
      cache: { paper: '0000.00000', renderPath: 'markup' },
    })
    expect(res.ok).toBe(true)
    expect(calls).toEqual([['a']])
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('读缓存'))
    warn.mockRestore()
  })
})

describe('缓存身份包含端点（issue #45 实验 3）', () => {
  const keyOf = (provider: { id: string; cacheId?: string; promptKey?: string }) => cacheKeyFor({
    providerId: provider.cacheId ?? provider.id,
    model: 'same-model',
    promptKey: provider.promptKey ?? '',
    target: 'cmn',
    renderPath: 'markup',
    text: 'Hello',
  })

  it('同模型名、不同 Base URL 不能命中同一条缓存', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://two.example/v1', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).not.toBe(await keyOf(b))
  })

  it('同一域名下的不同路径是不同身份：网关路由可能指向不同后端（Codex 在 #54 指出）', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://one.example/tenant-b/v1', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).not.toBe(await keyOf(b))
  })

  it('只有末尾斜杠之差仍是同一身份', async () => {
    const a = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'dummy', model: 'same-model' })
    const b = createOpenAICompatProvider({ baseURL: 'https://one.example/v1/', apiKey: 'dummy', model: 'same-model' })
    expect(await keyOf(a)).toBe(await keyOf(b))
  })

  it('缓存身份里不含 API key（硬规则 7）', () => {
    const provider = createOpenAICompatProvider({ baseURL: 'https://one.example/v1', apiKey: 'sk-secret-value', model: 'm' })
    expect(provider.cacheId).not.toContain('sk-secret-value')
    expect(provider.cacheId).toBe('openai-compat:https://one.example/v1')
  })

  it('没声明 cacheId 的 provider 仍用 id：免费引擎不受影响', async () => {
    const { createGoogleWebProvider } = await import('@/providers/google-web')
    const google = createGoogleWebProvider()
    expect(google.cacheId).toBeUndefined()
    expect(await keyOf(google)).toBe(await keyOf({ id: 'google-web' }))
  })
})
