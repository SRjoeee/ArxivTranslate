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
  it('capability declarations', () => {
    const p = createOpenAICompatProvider(cfg)
    expect(p.id).toBe('openai-compat')
    expect(p.kind).toBe('llm')
    expect(p.preservesMarkup).toBe(true)
    expect(p.maxBatchChars).toBeGreaterThan(0)
    expect(p.maxBatchItems).toBeGreaterThan(0)
  })

  it('structured output maps segments by ID and includes provider and model', async () => {
    let captured: unknown
    const model = modelReturning({ segments: [{ id: 's1', text: '你好 <x id="1"/>' }, { id: 's2', text: '世界' }] }, o => { captured = o })
    const result = await createOpenAICompatProvider(cfg, { model }).translate(req)
    expect(result).toEqual({ segments: [{ id: 's1', text: '你好 <x id="1"/>' }, { id: 's2', text: '世界' }], provider: 'openai-compat', model: 'test/model' })
    expect(JSON.stringify(captured)).toContain('<x id')
    expect(JSON.stringify(captured)).toContain('Intro')
  })

  it('missing or extra result IDs are invalid-response', async () => {
    const missing = modelReturning({ segments: [{ id: 's1', text: 'a' }] })
    expect(await kindOf(createOpenAICompatProvider(cfg, { model: missing }).translate(req))).toBe('invalid-response')
    const extra = modelReturning({ segments: [{ id: 's1', text: 'a' }, { id: 's2', text: 'b' }, { id: 's3', text: 'c' }] })
    expect(await kindOf(createOpenAICompatProvider(cfg, { model: extra }).translate(req))).toBe('invalid-response')
  })

  it('a missing key reports unavailable without calling the model', async () => {
    let calls = 0
    const model = modelReturning({ segments: [] }, () => { calls++ })
    const p = createOpenAICompatProvider({ ...cfg, apiKey: '' }, { model })
    expect(await p.isAvailable()).toBe(false)
    expect(await kindOf(p.translate(req))).toBe('no-key')
    expect(calls).toBe(0)
  })

  it('maps AI SDK APICallError to ProviderError with retry metadata', async () => {
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

  it('an already aborted signal returns aborted immediately', async () => {
    const model = new MockLanguageModelV4({
      doGenerate: async (options) => {
        if (options.abortSignal?.aborted) throw new DOMException('aborted', 'AbortError')
        return { content: [{ type: 'text', text: '{"segments":[]}' }], finishReason: { unified: 'stop', raw: undefined }, usage, warnings: [] }
      },
    })
    expect(await kindOf(createOpenAICompatProvider(cfg, { model }).translate({ ...req, signal: AbortSignal.abort() }))).toBe('aborted')
  })
})

describe('openai-compat provider: thinking settings and batching capabilities', () => {
  it('includes endpoint-specific thinking-disable fields in providerOptions', async () => {
    let captured: unknown
    const model = modelReturning({ segments: [{ id: 's1', text: 'a' }, { id: 's2', text: 'b' }] }, o => { captured = o })
    await createOpenAICompatProvider(cfg, { model }).translate(req)
    expect((captured as { providerOptions?: unknown }).providerOptions).toEqual({ 'openai-compat': { reasoning: { effort: 'none' } } })
  })

  it('uses reference batching defaults of 1000 characters and four segments; undeclared rate uses service defaults of 8/s with burst 20', () => {
    const p = createOpenAICompatProvider(cfg)
    expect(p.maxBatchChars).toBe(1000)
    expect(p.maxBatchItems).toBe(4)
    expect(p.rateLimit).toBeUndefined()
  })

  it('reduces rates for local endpoints: Ollama defaults to four concurrent requests and excess server-side queueing can time out', () => {
    expect(createOpenAICompatProvider({ ...cfg, baseURL: 'http://localhost:11434/v1' }).rateLimit).toEqual({ rate: 2, capacity: 4 })
    expect(createOpenAICompatProvider({ ...cfg, baseURL: 'http://127.0.0.1:1234/v1' }).rateLimit).toEqual({ rate: 2, capacity: 4 })
  })

  it('directly thrown no-key errors include nonretryable, drain-queue metadata because the ported policy does not recognize the kind', async () => {
    const err = await createOpenAICompatProvider({ ...cfg, apiKey: '' }).translate(req).catch((e: unknown) => e)
    expect((err as ProviderError).kind).toBe('no-key')
    expect(getRequestErrorMeta(err)).toMatchObject({ kind: 'access-denied', isRetryable: false })
  })

  it('exposes the prompt fingerprint for cache keys: default for the built-in prompt, content-dependent for custom prompts', () => {
    expect(createOpenAICompatProvider(cfg).promptKey).toBe('default')
    const custom = { promptId: 'm', patterns: [{ id: 'm', name: 'm', systemPrompt: 'S', prompt: '{{input}}' }] }
    expect(createOpenAICompatProvider(cfg, { prompts: custom }).promptKey).toMatch(/^custom:/)
  })

  it('the model system prompt includes paper title and abstract using the prompt library and protocol block', async () => {
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
