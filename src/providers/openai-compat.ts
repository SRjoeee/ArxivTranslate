// OpenAI-compatible endpoints (OpenRouter / DeepSeek / Ollama) using AI SDK structured output.
// The SDK handles requests, JSON parsing and schema validation; withRetry and the ported retry policy handle retries (SDK maxRetries = 0).
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

/** Local endpoint rate: 2/second with capacity 4 (Ollama defaults to OLLAMA_NUM_PARALLEL=4). */
export const LOOPBACK_RATE_LIMIT = { rate: 2, capacity: 4 } as const

/** Local endpoints (Ollama, LM Studio) need no key; the SDK omits Authorization when empty. Do not request other endpoints without a key (Codex #6). */
function isLoopback(baseURL: string): boolean {
  try {
    const { hostname } = new URL(baseURL)
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  } catch {
    return false
  }
}

/**
 * Endpoint identity: origin + path. **Keep the path**: routes on the same domain may reach different backends
 * (Codex #54); origin alone would make those routes share cache entries.
 * Normalize trailing slashes so `/v1` and `/v1/` remain equivalent; discard query and hash (they do not select backends).
 * If parsing fails, use the raw string rather than merge distinct endpoints. **No API key** (hard rule 7).
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
    id: 'openai-compat',
    displayName: 'OpenAI-compatible endpoint',
    kind: 'llm',
    preservesMarkup: true,
    // Read Frog default batches (1000 characters / 4 segments): small batches and high concurrency for quick first paint and throughput; service defaults are 8/s, burst 20.
    maxBatchChars: 1000,
    maxBatchItems: 4,
    // Reduce local endpoint rate: Ollama defaults to 4 parallel requests; server-side overflow would hit our timeout and waste retries.
    ...(isLoopback(config.baseURL) ? { rateLimit: LOOPBACK_RATE_LIMIT } : {}),
    promptKey: promptKey(deps.prompts),
    // Include endpoint identity in cache keys: same-named models at different endpoints differ (issue #45). No key is included.
    cacheId: `openai-compat:${endpointIdentity(config.baseURL)}`,
    async isAvailable() {
      return hasKey()
    },
    async translate(request: TranslateRequest): Promise<TranslateResult> {
      if (!hasKey()) throw new ProviderError('no-key', 'API key not configured')
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
          // Endpoint-specific fields such as thinking mode; openai-compatible merges them into the request body.
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

/** Returned ids must exactly match the request; return segments in request order. */
function alignSegments(request: TranslateRequest, returned: { id: string; text: string }[]) {
  const byId = new Map(returned.map(s => [s.id, s.text]))
  const missing = request.segments.filter(s => !byId.has(s.id)).map(s => s.id)
  const extra = returned.filter(s => !request.segments.some(r => r.id === s.id)).map(s => s.id)
  if (missing.length || extra.length || byId.size !== returned.length) {
    throw new ProviderError('invalid-response', `Returned segments do not match the request: missing [${missing.join(', ')}], extra [${extra.join(', ')}]`)
  }
  return request.segments.map(s => ({ id: s.id, text: byId.get(s.id)! }))
}

function toProviderError(e: unknown): ProviderError {
  if (e instanceof ProviderError) return e
  const name = (e as { name?: unknown })?.name
  if (name === 'AbortError') return new ProviderError('aborted', 'Request aborted', { cause: e })
  if (APICallError.isInstance(e)) {
    const status = e.statusCode
    const kind = status === 429 ? 'rate-limit' : status === 401 || status === 403 ? 'auth' : status === undefined ? 'network' : 'unknown'
    const err = new ProviderError(kind, e.message, { cause: e })
    return attachRequestErrorMeta(err, { statusCode: status, responseHeaders: e.responseHeaders, isRetryable: e.isRetryable })
  }
  if (typeof name === 'string' && /NoObjectGenerated|NoOutputGenerated|TypeValidation|JSONParse/.test(name)) {
    // Include a short excerpt of raw model output to diagnose schema mismatches.
    const raw = (e as { text?: unknown }).text
    const snippet = typeof raw === 'string' && raw.trim() ? `; raw model output: ${raw.trim().slice(0, 300)}` : ''
    return new ProviderError('invalid-response', `${(e as Error).message}${snippet}`, { cause: e })
  }
  if (e instanceof TypeError) return attachRequestErrorMeta(new ProviderError('network', e.message, { cause: e }), { kind: 'network', isRetryable: true })
  return new ProviderError('unknown', e instanceof Error ? e.message : String(e), { cause: e })
}
