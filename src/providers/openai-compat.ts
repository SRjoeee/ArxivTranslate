// openai-compat provider：OpenRouter / DeepSeek / Ollama 等 OpenAI 兼容端点，走 AI SDK 的结构化输出。
// 请求拼装、JSON 解析与 schema 校验交给 SDK；重试交给 withRetry + 移植的 retry policy（SDK 自身 maxRetries 设 0）。
import { APICallError, Output, generateText, type LanguageModel } from 'ai'
import { z } from 'zod'
import { createModel, type OpenAICompatConfig } from './model'
import { buildPrompts } from './prompt'
import { promptKey, type PromptsConfig } from './prompt-library'
import { attachRequestErrorMeta } from './request/retry-policy'
import { thinkingBodyFields } from './thinking'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'

const outputSchema = z.object({
  segments: z.array(z.object({ id: z.string(), text: z.string() })),
})

/** 本机端点的速率：每秒 2 个、最多攒 4 个（Ollama 默认 OLLAMA_NUM_PARALLEL=4） */
export const LOOPBACK_RATE_LIMIT = { rate: 2, capacity: 4 } as const

/** 本机端点（Ollama、LM Studio）不要求 key，SDK 在 key 为空时也不会发 Authorization 头；其余端点没 key 就别发请求（Codex 在 #6 指出） */
function isLoopback(baseURL: string): boolean {
  try {
    const { hostname } = new URL(baseURL)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/** 端点的 origin，用作缓存身份的一部分；解析不了就用原串（总比把不同端点混成一个好） */
function endpointOrigin(baseURL: string): string {
  try {
    return new URL(baseURL).origin
  } catch {
    return baseURL
  }
}

export function createOpenAICompatProvider(
  config: OpenAICompatConfig,
  deps: { model?: LanguageModel; prompts?: PromptsConfig } = {},
): TranslationProvider {
  const hasKey = () => config.apiKey.trim().length > 0 || isLoopback(config.baseURL)
  return {
    id: 'openai-compat',
    displayName: 'OpenAI 兼容端点',
    kind: 'llm',
    preservesMarkup: true,
    // 批次照 Read Frog 的默认值（1000 字 / 4 段）：小批高并发，首屏快、吞吐高；速率用服务默认的 8/s、突发 20（同样是它的默认值）
    maxBatchChars: 1000,
    maxBatchItems: 4,
    // 本机端点压低速率：Ollama 默认只并行 4 个，多出来的在服务端排队，会撞我们的超时再重试，空转
    ...(isLoopback(config.baseURL) ? { rateLimit: LOOPBACK_RATE_LIMIT } : {}),
    promptKey: promptKey(deps.prompts),
    // 端点进缓存身份：同名模型在不同端点上是不同的东西（issue #45）。只取 origin，不带路径也不带 key
    cacheId: `openai-compat:${endpointOrigin(config.baseURL)}`,
    async isAvailable() {
      return hasKey()
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (!hasKey()) throw new ProviderError('no-key', '未配置 API key')
      const model = deps.model ?? createModel(config)
      const extraBody = thinkingBodyFields(config.baseURL, config.thinking ?? 'disabled')
      let output: z.infer<typeof outputSchema>
      const { system, prompt } = buildPrompts(request, deps.prompts)
      try {
        const result = await generateText({
          model,
          output: Output.object({ schema: outputSchema }),
          system,
          prompt,
          temperature: 0.2,
          maxRetries: 0,
          abortSignal: request.signal,
          // 思考开关等端点特有字段；openai-compatible 会把它们并进请求体
          providerOptions: Object.keys(extraBody).length ? { 'openai-compat': extraBody as never } : undefined,
        })
        output = result.output
      } catch (e) {
        throw toProviderError(e)
      }
      return { segments: alignSegments(request, output.segments), provider: 'openai-compat', model: config.model }
    },
  }
}

/** 返回的 id 集合必须与请求完全一致；按请求顺序排列 */
function alignSegments(request: TranslateRequest, returned: { id: string; text: string }[]) {
  const byId = new Map(returned.map(s => [s.id, s.text]))
  const missing = request.segments.filter(s => !byId.has(s.id)).map(s => s.id)
  const extra = returned.filter(s => !request.segments.some(r => r.id === s.id)).map(s => s.id)
  if (missing.length || extra.length || byId.size !== returned.length) {
    throw new ProviderError('invalid-response', `返回的 segment 与请求不一致：缺少 [${missing.join(', ')}]，多出 [${extra.join(', ')}]`)
  }
  return request.segments.map(s => ({ id: s.id, text: byId.get(s.id)! }))
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const name = (e as { name?: unknown })?.name
  if (name === 'AbortError') return new ProviderError('aborted', '请求已中止', { cause: e })
  if (APICallError.isInstance(e)) {
    const status = e.statusCode
    const kind = status === 429 ? 'rate-limit' : status === 401 || status === 403 ? 'auth' : status === undefined ? 'network' : 'unknown'
    const err = new ProviderError(kind, e.message, { cause: e })
    return attachRequestErrorMeta(err, { statusCode: status, responseHeaders: e.responseHeaders, isRetryable: e.isRetryable })
  }
  if (typeof name === 'string' && /NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/.test(name)) {
    // 把模型的原始输出带上一小段，排查"不符合 schema"时能看到它到底返回了什么
    const raw = (e as { text?: unknown }).text
    const snippet = typeof raw === 'string' && raw.trim() ? `；模型原始输出：${raw.trim().slice(0, 300)}` : ''
    return new ProviderError('invalid-response', `${(e as Error).message}${snippet}`, { cause: e })
  }
  if (e instanceof TypeError) return attachRequestErrorMeta(new ProviderError('network', e.message, { cause: e }), { kind: 'network', isRetryable: true })
  return new ProviderError('unknown', e instanceof Error ? e.message : String(e), { cause: e })
}
