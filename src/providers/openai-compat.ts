// The openai-compat provider: OpenRouter / DeepSeek / Ollama and other OpenAI-compatible endpoints, through the AI
// SDK's structured output. Request assembly, JSON parsing and schema validation are the SDK's; retries are withRetry
// plus the ported retry policy (the SDK's own maxRetries is 0).
import { APICallError, Output, generateText, type LanguageModel } from 'ai'
import { z } from 'zod'
import { createModel, type OpenAICompatConfig } from './model'
import { buildPrompts } from './prompt'
import { promptKey, type PromptsConfig } from './prompt-library'
import { attachRequestErrorMeta } from './request/retry-policy'
import { thinkingBodyFields } from './thinking'
import { ProviderError, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'
import { WIRE_FORMATS } from './wire-formats'

const outputSchema = z.object({
  segments: z.array(z.object({ id: z.string(), text: z.string() })),
})

/** The rate of a local endpoint: 2 a second, at most 4 accumulated (Ollama's default OLLAMA_NUM_PARALLEL=4) */
export const LOOPBACK_RATE_LIMIT = { rate: 2, capacity: 4 } as const

/** A local endpoint (Ollama, LM Studio) needs no key, and the SDK sends no Authorization header when the key is empty; any other endpoint without a key must not be asked (Codex on #6) */
function isLoopback(baseURL: string): boolean {
  try {
    const { hostname } = new URL(baseURL)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * The endpoint's identity: origin + path. **The path cannot be dropped** — different paths on one domain may be
 * different gateway routes to different back ends (Codex on #54), and origin alone would make two routes share cache
 * entries. The trailing slash is normalised away, so `/v1` and `/v1/` are one identity; the query string and hash are
 * dropped (they choose no back end). Unparseable, the raw string is used — better than mixing endpoints into one.
 * **Never the API key** (hard rule 7)
 */
function endpointIdentity(baseURL: string): string {
  try {
    const url = new URL(baseURL)
    return url.origin + url.pathname.replace(/\/+$/, '')
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
    id: config.id ?? 'openai-compat',
    kind: 'llm',
    // tags only: the protocol block of the prompt (PROTOCOL_BLOCK in prompt.ts) teaches exactly these tags
    wireFormats: WIRE_FORMATS['openai-compat'],
    // Batches after Read Frog's defaults (1000 characters / 4 segments): small batches at high concurrency, a fast first screen and high throughput; the rate is the service default of 8/s with a burst of 20 (its defaults too)
    maxBatchChars: 1000,
    maxBatchItems: 4,
    // A local endpoint gets a lower rate: Ollama runs 4 in parallel by default, the rest queue on the server, hit our timeout and get retried — idle churn
    ...(isLoopback(config.baseURL) ? { rateLimit: LOOPBACK_RATE_LIMIT } : {}),
    promptKey: promptKey(deps.prompts),
    // The endpoint enters the cache identity: a model of the same name on different endpoints is a different thing (issue #45). Origin only, with neither path nor key
    cacheId: `openai-compat:${endpointIdentity(config.baseURL)}`,
    async isAvailable() {
      return hasKey()
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (!hasKey()) throw new ProviderError('no-key', 'no API key configured')
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
          // Endpoint-specific fields such as the thinking switch; openai-compatible merges them into the request body
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

/** The ids returned must equal the request's exactly; ordered as requested */
function alignSegments(request: TranslateRequest, returned: { id: string; text: string }[]) {
  const byId = new Map(returned.map(s => [s.id, s.text]))
  const missing = request.segments.filter(s => !byId.has(s.id)).map(s => s.id)
  const extra = returned.filter(s => !request.segments.some(r => r.id === s.id)).map(s => s.id)
  if (missing.length || extra.length || byId.size !== returned.length) {
    throw new ProviderError('invalid-response', `the segments returned do not match the request: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`)
  }
  return request.segments.map(s => ({ id: s.id, text: byId.get(s.id)! }))
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const name = (e as { name?: unknown })?.name
  if (name === 'AbortError') return new ProviderError('aborted', 'request aborted', { cause: e })
  if (APICallError.isInstance(e)) {
    const status = e.statusCode
    const kind = status === 429 ? 'rate-limit' : status === 401 || status === 403 ? 'auth' : status === undefined ? 'network' : 'unknown'
    const err = new ProviderError(kind, e.message, { cause: e })
    return attachRequestErrorMeta(err, { statusCode: status, responseHeaders: e.responseHeaders, isRetryable: e.isRetryable })
  }
  if (typeof name === 'string' && /NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/.test(name)) {
    // A short stretch of the model's raw output travels along, so a “does not match the schema” can be diagnosed by what it actually returned
    const raw = (e as { text?: unknown }).text
    const snippet = typeof raw === 'string' && raw.trim() ? `; raw model output: ${raw.trim().slice(0, 300)}` : ''
    return new ProviderError('invalid-response', `${(e as Error).message}${snippet}`, { cause: e })
  }
  if (e instanceof TypeError) return attachRequestErrorMeta(new ProviderError('network', e.message, { cause: e }), { kind: 'network', isRetryable: true })
  return new ProviderError('unknown', e instanceof Error ? e.message : String(e), { cause: e })
}
