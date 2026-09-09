// Shared provider interface (DESIGN §8). One file per engine; do not share private implementation details across files.

import { attachRequestErrorMeta, type RequestErrorMeta } from './request/retry-policy'

export interface TranslateSegment {
  id: string
  text: string
}

export interface TranslateContext {
  paperTitle?: string
  /** Truncated paper abstract included in every batch; the paper supplies it, avoiding Read Frog's extra LLM summary call. */
  abstract?: string
  sectionTitle?: string
  glossary?: { term: string; translation: string }[]
}

export interface TranslateRequest {
  segments: TranslateSegment[]
  /** Fixed in v1. */
  source: 'en'
  /** BCP-47, e.g. zh-CN. */
  target: string
  context?: TranslateContext
  /** Does not cross message boundaries; attached by the caller inside background. */
  signal?: AbortSignal
}

export interface TranslateResult {
  segments: TranslateSegment[]
  provider: string
  model?: string
}

export type ProviderKind = 'llm' | 'mt' | 'builtin'

export interface TranslationProvider {
  id: string
  displayName: string
  kind: ProviderKind
  /** true → markup path; false → runs path. */
  preservesMarkup: boolean
  /** Character limit per request. */
  maxBatchChars: number
  /** Segment limit per request. */
  maxBatchItems: number
  /** Request rate (token bucket: rate tokens/second, up to capacity); defaults to the service's 8 / 20, matching Read Frog (§8.2). */
  rateLimit?: { rate: number; capacity: number }
  /**
   * Maximum concurrent requests; defaults to the service's 8. Separate from rateLimit: the token bucket limits starts per second,
   * while this limits requests in flight. Fast endpoints only need concurrency control; rate limiting makes them wait needlessly (§8.3).
   */
  maxConcurrent?: number
  /** Health check: configured key, reachable endpoint, available built-in model. */
  isAvailable(): Promise<boolean>
  translate(request: TranslateRequest): Promise<TranslateResult>
  /** Prompt fingerprint in cache keys (LLM providers only): changing prompts must invalidate old translations. */
  promptKey?: string
  /**
   * Cache identity; defaults to id.
   * Include **non-secret configuration that changes output** under the same id: openai-compat uses one id for every compatible endpoint.
   * With id + model name alone, an OpenRouter model and a local Ollama model with the same name would share translations
   * (issue #45, experiment 3). **Never include API keys** (hard rule 7).
   */
  cacheId?: string
}

export type ProviderErrorKind = 'no-key' | 'network' | 'rate-limit' | 'auth' | 'bad-request' | 'invalid-response' | 'timeout' | 'aborted' | 'unknown'

/**
 * Retry metadata attached at construction for each kind: the ported retry-policy only recognizes its own kinds.
 * Otherwise no-key / aborted become unknown errors and are retried (observed no-key: 4 calls and 7s wasted).
 * Attach it in the constructor, not the provider catch, because no-key and id mismatch errors may be thrown outside try blocks.
 * Provider metadata based on status codes (Retry-After, SDK isRetryable) is layered over these defaults.
 */
const META_BY_KIND: Record<ProviderErrorKind, RequestErrorMeta> = {
  'no-key': { kind: 'access-denied', isRetryable: false }, // Like 401 / 403: no retries; drain the entire queue.
  'auth': { kind: 'access-denied', isRetryable: false },
  'aborted': { isRetryable: false },
  'invalid-response': { isRetryable: false },
  // Invalid requests (4xx except 401/403/429) cannot succeed on retry; let the fallback chain choose another engine (Codex #17).
  'bad-request': { kind: 'bad-request', isRetryable: false },
  'rate-limit': { kind: 'rate-limit' },
  'timeout': { kind: 'timeout', isRetryable: true },
  'network': { kind: 'network', isRetryable: true },
  'unknown': {},
}

export class ProviderError extends Error {
  /**
   * Can retrying this failure with a smaller batch succeed (Codex #61)? Assume yes by default:
   * LLM invalid-response often originates from a single segment; splitting isolates it, so BatchQueue retries three times
   * and then falls back to individual items. A broken server response (non-JSON or invalid shape) is **systemic**,
   * so splitting cannot help: a 100-segment batch wastes 104 requests against a free endpoint we should use sparingly.
   * Providers explicitly set false for such errors so `asBatchError` does not convert them into batch errors.
   */
  readonly isolatable: boolean

  constructor(readonly kind: ProviderErrorKind, message: string, options?: { cause?: unknown; isolatable?: boolean }) {
    super(message, options)
    this.name = 'ProviderError'
    this.isolatable = options?.isolatable ?? true
    attachRequestErrorMeta(this, META_BY_KIND[kind])
  }
}
