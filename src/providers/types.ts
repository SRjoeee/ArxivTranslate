// The uniform provider interface (DESIGN §8). One file per engine; no sharing of unpublished interface details across files.

import type { WireFormat } from '@/core/protector/tokens'
import type { SentenceAlignment } from './alignment'
import { attachRequestErrorMeta, type RequestErrorMeta } from './request/retry-policy'

export interface TranslateSegment {
  id: string
  text: string
  /**
   * The positions of the sentence boundaries in `text` (§8.6). **Given by the caller; the service does not cut on its
   * own**: choosing the cut points needs the block itself — `sentenceCuts` needs a `SplitContext` built from the
   * placeholder slots to tell an annotation from a formula, and its measured precision expressly excludes reference
   * blocks, where callers must not run it. None of that can be seen in the wire text.
   * Absent, no marker is inserted. Neither when the engine reports sentence boundaries itself (Microsoft)
   */
  cuts?: number[]
}

export interface TranslateContext {
  paperTitle?: string
  /** The paper's abstract (truncated), with every batch: a paper brings its abstract, no extra LLM call to generate one as in Read Frog */
  abstract?: string
  sectionTitle?: string
  glossary?: { term: string; translation: string }[]
}

export interface TranslateRequest {
  segments: TranslateSegment[]
  /** Fixed in v1 */
  source: 'en'
  /** BCP-47, such as zh-CN */
  target: string
  context?: TranslateContext
  /** Never crosses a message boundary; attached by the caller inside the background */
  signal?: AbortSignal
}

/**
 * A translated segment. `alignment` is present only when the engine could report sentence
 * boundaries **and** they reconstructed both texts (see `alignment.ts`). There is no capability
 * flag on the provider: an engine that can report it does, and the pipeline never branches on which
 * mechanism produced it — that is the one architectural requirement issue #105 puts on this layer.
 */
export interface TranslatedSegment extends TranslateSegment {
  alignment?: SentenceAlignment
}

export interface TranslateResult {
  segments: TranslatedSegment[]
  provider: string
  model?: string
}

export type ProviderKind = 'llm' | 'mt' | 'builtin'

export interface TranslationProvider {
  id: string
  displayName: string
  kind: ProviderKind
  /**
   * The wire formats this engine can keep, **in order of preference**; the intersection is negotiated with the other
   * engines on the chain (§8.5). An empty array = not one placeholder survives, runs only. Not a boolean: Google keeps
   * both formats, which a boolean cannot say and would force “choose Microsoft, lose the fallback”
   */
  wireFormats: readonly WireFormat[]
  /** The character cap of one request */
  maxBatchChars: number
  /** The segment cap of one request */
  maxBatchItems: number
  /** The request rate (a token bucket: rate a second, at most capacity accumulated); undeclared, the service default of 8 / 20, Read Frog's defaults (§8.2) */
  rateLimit?: { rate: number; capacity: number }
  /**
   * The cap on requests in flight at once; undeclared, the service default of 8. A different gate from rateLimit: the
   * token bucket governs “how many a second”, this governs “how many outstanding”. A fast endpoint needs only this, and a rate limit would make fast responses wait for tokens for nothing (§8.3)
   */
  maxConcurrent?: number
  /** The health check: is the key set, is the endpoint reachable, is the built-in model available */
  isAvailable(): Promise<boolean>
  translate(request: TranslateRequest): Promise<TranslateResult>
  /**
   * Reports sentence boundaries itself (§8.6). For an engine that declares it the service inserts no sentence markers
   * — Microsoft's `sentLen` is native, and markers would only rewrite the request for nothing. For the others (Google,
   * the LLMs) the service inserts `<x id="N"/>` boundary markers under the `tags` format and takes them off again (`sentence-markers.ts`)
   */
  reportsSentences?: boolean
  /** The prompt fingerprint, entering the cache key (LLM providers only): another prompt must not hit the old translations */
  promptKey?: string
  /**
   * The cache identity, entering the cache key; the id when undeclared.
   * **Non-secret configuration that changes the output** under one id belongs here: the openai-compat id is the same
   * for every OpenAI-compatible endpoint, and with id + model name alone a model of that name on OpenRouter and on a
   * local Ollama would share cache entries and pollute each other's translations (experiment 3 of issue #45). **Never
   * the API key** (hard rule 7)
   */
  cacheId?: string
}

export type ProviderErrorKind = 'no-key' | 'network' | 'rate-limit' | 'auth' | 'bad-request' | 'invalid-response' | 'timeout' | 'aborted' | 'unknown'

/**
 * The kinds that continuing can only repeat: a missing or rejected key. The one definition (ADR-0004) behind the
 * fallback chain's permanent demotion, the translate service's per-scope stop, both pipelines' halt and the page's
 * restart-on-hand-over decision. A new key rebuilds the chain (`chainConfigChanged`), which is what clears them.
 */
export const PERMANENT_ERROR_KINDS: ReadonlySet<ProviderErrorKind> = new Set<ProviderErrorKind>(['no-key', 'auth'])

export function isPermanentErrorKind(kind: string): kind is 'no-key' | 'auth' {
  return PERMANENT_ERROR_KINDS.has(kind as ProviderErrorKind)
}

/**
 * The retry metadata of each kind, attached at construction: the ported retry-policy knows only its own kinds, and
 * would retry no-key / aborted as unknown errors (measured: no-key called 4 times, 7 s wasted). Attached in the
 * constructor rather than in a provider's catch because no-key and a mismatched id are thrown straight from outside
 * the try. The metadata a provider adds afterwards by status code (Retry-After, the SDK's isRetryable) layers on top
 */
const META_BY_KIND: Record<ProviderErrorKind, RequestErrorMeta> = {
  'no-key': { kind: 'access-denied', isRetryable: false }, // as 401 / 403: no retry, the whole queue drains
  'auth': { kind: 'access-denied', isRetryable: false },
  'aborted': { isRetryable: false },
  'invalid-response': { isRetryable: false },
  // The request itself is wrong (4xx other than 401/403/429): any number of retries gives the same, so the fallback chain changes engine (Codex on #17)
  'bad-request': { kind: 'bad-request', isRetryable: false },
  'rate-limit': { kind: 'rate-limit' },
  'timeout': { kind: 'timeout', isRetryable: true },
  'network': { kind: 'network', isRetryable: true },
  'unknown': {},
}

/**
 * Whether, by kind, **a retry with a smaller batch could succeed**. A provider that knows more overrides it by
 * constructor argument.
 *
 * One criterion only: was this failure **caused by some segment**, or is the whole road blocked?
 * - `invalid-response`: most likely some segment led the model's output astray, and splitting finds it (a wholly
 *   broken server response is declared false by the provider itself)
 * - `timeout`: the smaller the batch, the likelier it returns within the budget
 * - `unknown`: no evidence, the old behaviour kept (split)
 * - `rate-limit` / `network` / `bad-request`: splitting only **multiplies the same failure by the segment count** —
 *   counter-productive above all on quotas, one batch becoming seven requests. `bad-request`'s metadata has long
 *   said “any number of retries gives the same, let the fallback chain change engine”, and splitting is the same case
 * - `no-key` / `auth`: the whole queue drains, splitting is never reached
 * - `aborted`: the result is no longer wanted
 */
const ISOLATABLE_BY_KIND: Record<ProviderErrorKind, boolean> = {
  'invalid-response': true,
  'unknown': true,
  // `timeout` used to count as isolatable (“a smaller batch might return within the budget”), changed after measuring:
  // one batch of 8 segments fanned out to **15 calls** at the content layer (`8,4,2,1,1,2,1,1,4,2,1,1,2,1,1`), while
  // the queue itself retries by retry-policy on top — up to 45 requests, each waiting out its own timeout, exactly
  // the “whole page stuck in progress” the timeout was set to avoid. Recovering from a timeout is the queue's job: it
  // budgets by character count and records the whole batch's deadline in meta; data and responsibility both live there (tests/pipeline has the regression)
  'timeout': false,
  'rate-limit': false,
  'network': false,
  'bad-request': false,
  'no-key': false,
  'auth': false,
  'aborted': false,
}

export class ProviderError extends Error {
  /**
   * Whether this failure **could succeed retried with a smaller batch** (Codex on #61). The default comes by kind, and
   * a provider may override it: a wholly broken server response (not JSON, wrong shape) is a **systemic** failure,
   * the same however small the split — a batch of 100 segments would fire 104 requests for nothing, at the free
   * endpoints we mean to spare.
   *
   * Used in two places: `asBatchError` decides whether to turn it into a batch error (BatchQueue retries 3 times and
   * then falls back one by one); carried across the message boundary by `toErrorInfo`, the content side's
   * `translateSegments` decides by it whether to split in half — without it, a systemic `bad-request` over 4
   * segments split into 7 calls (`4,2,1,1,2,1,1`, measured by research audit B20)
   */
  readonly isolatable: boolean

  constructor(readonly kind: ProviderErrorKind, message: string, options?: { cause?: unknown; isolatable?: boolean }) {
    super(message, options)
    this.name = 'ProviderError'
    this.isolatable = options?.isolatable ?? ISOLATABLE_BY_KIND[kind]
    attachRequestErrorMeta(this, META_BY_KIND[kind])
  }
}
