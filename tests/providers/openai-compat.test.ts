import { APICallError } from 'ai'
import { MockLanguageModelV4 } from 'ai/test'
import { describe, expect, it } from 'vitest'
import { createOpenAICompatProvider } from '@/providers/openai-compat'
import { getRequestErrorMeta } from '@/providers/request/retry-policy'
import { ProviderError, type TranslateRequest } from '@/providers/types'

const cfg = { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'k', model: 'test/model' }
const req: TranslateRequest = {
  segments: [{ id: 's1', text: 'Hello <x id="1"/>' }, { id: 's2', text: 'World' }],
  source: 'en',
  target: 'zh-CN',
  context: { sectionTitle: 'Intro' },
}

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}
const modelReturning = (json: unknown, onCall?: (options: unknown) => void) =>
  new MockLanguageModelV4({
    doGenerate: async (options) => {
      onCall?.(options)
      return { content: [{ type: 'text', text: JSON.stringify(json) }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }
    },
  })
const modelThrowing = (error: unknown) => new MockLanguageModelV4({ doGenerate: async () => { throw error } })

const kindOf = async (p: Promise<unknown>) => {
  try {
    await p
    return 'ok'
  } catch (e) {
    return e instanceof ProviderError ? e.kind : `not-provider-error:${String(e)}`
  }
}

describe('openai-compat provider', () => {
  it('能力声明', () => {
    const p = createOpenAICompatProvider(cfg)
    expect(p.id).toBe('openai-compat')
    expect(p.kind).toBe('llm')
    expect(p.preservesMarkup).toBe(true)
    expect(p.maxBatchChars).toBeGreaterThan(0)
    expect(p.concurrency).toBeGreaterThan(0)
  })

  it('结构化输出：segments 按 id 一一对应，带 provider 与 model', async () => {
    let captured: unknown
    const model = modelReturning({ segments: [{ id: 's1', text: '你好 <x id="1"/>' }, { id: 's2', text: '世界' }] }, o => { captured = o })
    const result = await createOpenAICompatProvider(cfg, { model }).translate(req)
    expect(result).toEqual({ segments: [{ id: 's1', text: '你好 <x id="1"/>' }, { id: 's2', text: '世界' }], provider: 'openai-compat', model: 'test/model' })
    expect(JSON.stringify(captured)).toContain('<x id')
    expect(JSON.stringify(captured)).toContain('Intro')
  })

  it('返回缺 id 或多 id 都是 invalid-response', async () => {
    const missing = modelReturning({ segments: [{ id: 's1', text: 'a' }] })
    expect(await kindOf(createOpenAICompatProvider(cfg, { model: missing }).translate(req))).toBe('invalid-response')
    const extra = modelReturning({ segments: [{ id: 's1', text: 'a' }, { id: 's2', text: 'b' }, { id: 's3', text: 'c' }] })
    expect(await kindOf(createOpenAICompatProvider(cfg, { model: extra }).translate(req))).toBe('invalid-response')
  })

  it('没有 key：不可用，且不调用模型', async () => {
    let calls = 0
    const model = modelReturning({ segments: [] }, () => { calls++ })
    const p = createOpenAICompatProvider({ ...cfg, apiKey: '' }, { model })
    expect(await p.isAvailable()).toBe(false)
    expect(await kindOf(p.translate(req))).toBe('no-key')
    expect(calls).toBe(0)
  })

  it('AI SDK 的 APICallError 映射为 ProviderError 并附带重试元数据', async () => {
    const rateLimited = new APICallError({ message: 'Too Many Requests', url: 'u', requestBodyValues: {}, statusCode: 429, responseHeaders: { 'retry-after': '2' }, isRetryable: true })
    const p = createOpenAICompatProvider(cfg, { model: modelThrowing(rateLimited) })
    try {
      await p.translate(req)
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(ProviderError)
      expect((e as ProviderError).kind).toBe('rate-limit')
      expect(getRequestErrorMeta(e).statusCode).toBe(429)
    }
    const unauthorized = new APICallError({ message: 'Unauthorized', url: 'u', requestBodyValues: {}, statusCode: 401, isRetryable: false })
    expect(await kindOf(createOpenAICompatProvider(cfg, { model: modelThrowing(unauthorized) }).translate(req))).toBe('auth')
    expect(await kindOf(createOpenAICompatProvider(cfg, { model: modelThrowing(new TypeError('fetch failed')) }).translate(req))).toBe('network')
  })

  it('已中止的 signal 直接 aborted', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        if (options.abortSignal?.aborted) throw new DOMException('aborted', 'AbortError')
        return { content: [{ type: 'text', text: '{"segments":[]}' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }
      },
    })
    expect(await kindOf(createOpenAICompatProvider(cfg, { model }).translate({ ...req, signal: AbortSignal.abort() }))).toBe('aborted')
  })
})

describe('openai-compat provider：思考开关与批次能力', () => {
  it('把端点对应的思考关闭字段放进 providerOptions', async () => {
    let captured: unknown
    const model = modelReturning({ segments: [{ id: 's1', text: 'a' }, { id: 's2', text: 'b' }] }, o => { captured = o })
    await createOpenAICompatProvider(cfg, { model }).translate(req)
    expect((captured as { providerOptions?: unknown }).providerOptions).toEqual({ 'openai-compat': { reasoning: { effort: 'none' } } })
  })

  it('批次能力照参考项目的默认值：1000 字 / 4 段，并发 8', () => {
    const p = createOpenAICompatProvider(cfg)
    expect(p.maxBatchChars).toBe(1000)
    expect(p.maxBatchItems).toBe(4)
    expect(p.concurrency).toBe(8)
  })

  it('暴露提示词指纹给缓存键：默认是 default，自定义随文本变', () => {
    expect(createOpenAICompatProvider(cfg).promptKey).toBe('default')
    const custom = { promptId: 'm', patterns: [{ id: 'm', name: 'm', systemPrompt: 'S', prompt: '{{input}}' }] }
    expect(createOpenAICompatProvider(cfg, { prompts: custom }).promptKey).toMatch(/^custom:/)
  })

  it('发给模型的 system prompt 带论文标题与摘要（提示词库 + 协议块）', async () => {
    let sent = ''
    const model = modelReturning({ segments: [{ id: 's1', text: '你好 <x id="1"/>' }, { id: 's2', text: '世界' }] }, options => { sent = JSON.stringify(options) })
    const p = createOpenAICompatProvider(cfg, { model })
    await p.translate({ ...req, context: { paperTitle: 'Graphs', abstract: 'We study graphs.', sectionTitle: 'Intro' } })
    expect(sent).toContain('Paper title: Graphs')
    expect(sent).toContain('Abstract: We study graphs.')
    expect(sent).toContain('Current section: Intro')
    expect(sent).toContain('<document_metadata>')
    expect(sent).toContain('Input and Output Protocol')
  })
})
