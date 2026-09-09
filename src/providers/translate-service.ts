// Translation service: read cache → send only misses to the provider → write results to cache.
// Request layer ported from Read Frog utils/request (DESIGN §8.2, §10): RequestQueue controls token-bucket rate, timeouts, retries,
// 429 pauses with a single recovery probe, full queue draining on 401/no-key, and scope cancellation. BatchQueue groups segments by batch key;
// its dispatch gate accumulates larger batches during rate limits. Wiring follows Read Frog background/translation-queues.ts (§8.0).
// Runtime-independent: CachePort is injected; background uses local Dexie and content uses a message proxy.
import { cacheKeyFor, type RenderPath } from '@/cache/key'
// Import validate directly, not the protector barrel: serialize/rehydrate touch the DOM and do not belong in the background bundle.
import { expectationsFromText, validate } from '@/core/protector/validate'
import { getRandomUUID } from '@/shared/uuid'
import { BatchCountMismatchError, BatchQueue, type BatchOptions } from './request/batch-queue'
import { CancelledScopeRegistry, isTranslationCancelledError } from './request/cancellation'
import { REQUEST_TIMEOUT_ERROR_NAME, RequestQueue, type QueueOptions } from './request/request-queue'
import { attachRequestErrorMeta } from './request/retry-policy'
import { ProviderError, type ProviderErrorKind, type TranslateRequest, type TranslationProvider } from './types'

export interface CacheEntry {
  key: string
  translation: string
  paper: string
}

/** Minimal cache interface, with bulk reads/writes to avoid one round trip per segment. */
export interface CachePort {
  getMany(keys: string[]): Promise<(string | null)[]>
  putMany(entries: CacheEntry[]): Promise<void>
}

export type TranslateMessageRequest = {
  request: Omit<TranslateRequest, 'signal'>
  providerId?: string
  /** Omit to disable caching, e.g. for settings connection tests. */
  cache?: {
    paper: string
    renderPath: RenderPath
    /** Write-only retry after placeholder validation failure; do not read the same invalid translation again (§6.3). */
    bypass?: boolean
  }
}

/** Cancellation scope: one id per run, cancelled on restore. Serializable across messages, so present in both transport paths. */
export type TranslateCall = TranslateMessageRequest & {
  scope?: string
}

export type TranslateMessageResponse =
  | { ok: true; result: { segments: { id: string; text: string }[]; provider: string; model?: string }; cached: number }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }

export interface TranslateServiceDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  getModel?: () => Promise<string | undefined>
  cache?: CachePort
  /** Test queue overrides: timeoutMs is the batch timeout base; rate/capacity precedence is provider.rateLimit, these values, then 8/20. */
  queue?: Partial<QueueOptions>
  /** Cache read timeout for tests; defaults to CACHE_READ_BUDGET_MS. */
  cacheReadBudgetMs?: number
  /** Batch parameter overrides for tests. */
  batch?: Partial<Pick<BatchOptions<QueueItem, string>, 'batchDelay' | 'maxRetries' | 'enableFallbackToIndividual'>>
}

export interface TranslateService {
  translate(call: TranslateCall): Promise<TranslateMessageResponse>
  /** Cancel queued/in-flight requests for this scope; return the count. Subsequent calls with the same scope return aborted. */
  cancel(scope: string): number
}

/** Read Frog queue defaults (DEFAULT_CONFIG.pageTranslation.requestQueueConfig and translation-queues.ts constants). */
export const DEFAULT_RATE_LIMIT = { rate: 8, capacity: 20 } as const

/**
 * Cache read deadline. Cache is an optimization, not a dependency: the service waits for it before requesting translation,
 * so a hung read would stall the whole page (issue #45, experiment 2). The content message port also has a 1.5s budget; this final gate
 * guarantees any CachePort implementation (background Dexie or test double) cannot stall translation indefinitely.
 */
export const CACHE_READ_BUDGET_MS = 2_000

/**
 * Concurrency limit and total batch deadline (issue #43). Token buckets limit rate, not in-flight count when responses are slow.
 * A 220-block paper can create over 50 batches; sending all at once invites 429s and browser connection-limit exhaustion.
 * Use 8, matching rate: this gate does not engage for subsecond responses, only caps slow requests.
 * Total deadline: 180s. One attempt can take 120s (20s + 15ms/character), and persistent 429 pauses can extend total latency into minutes
 * (observed unfinished at 60s). Fail the batch at the deadline for user retry rather than leave it pending indefinitely.
 */
export const DEFAULT_MAX_CONCURRENT = 8
export const DEFAULT_MAX_TOTAL_MS = 180_000

const DEFAULT_QUEUE_OPTIONS = {
  timeoutMs: 20_000,
  maxRetries: 2,
  baseRetryDelayMs: 1_000,
  maxConcurrent: DEFAULT_MAX_CONCURRENT,
  maxTotalMs: DEFAULT_MAX_TOTAL_MS,
} as const
const BATCH_DELAY_MS = 100
const BATCH_MAX_RETRIES = 3
/** Batch timeout: base + 15ms/character, capped at 120s (Read Frog utils/constants/translate.ts). A 1000-character batch gets 35s. */
const BATCH_TIMEOUT_PER_CHAR_MS = 15
const MAX_BATCH_TIMEOUT_MS = 120_000

/** Queued segment: BatchQueue groups by batchKey, deduplicates by dedupKey and cancels by scope; the result is just translated text, shared by duplicates. */
interface QueueItem {
  uid: string
  id: string
  text: string
  batchKey: string
  dedupKey?: string
  scope?: string
  scheduleAt: number
  provider: TranslationProvider
  request: Pick<TranslateRequest, 'source' | 'target' | 'context'>
}

interface ProviderQueues {
  requestQueue: RequestQueue
  /**
   * Batch every provider. Read Frog shouldUseBatchQueue only batches LLMs because its free endpoints accept single items.
   * Ours accept multiple: translateHtml supports 150 (RESEARCH §6.6), and the built-in provider declares 20. Copying that condition
   * discards their advantage: 216 blocks produced 61 requests with a median of 2 items (limit 100 items / 8000 characters, §8.3).
   * BatchQueue naturally handles maxItemsPerBatch = 1 as single-item requests; no separate path is needed.
   */
  batchQueue: BatchQueue<QueueItem, string>
}

/** Provider-facing ids must be unique: different calls can reuse ids (paragraph retries or three successive connection tests) within one batch. */
function uniqueIds(items: QueueItem[]): string[] {
  const seen = new Set<string>()
  return items.map((item, i) => {
    const id = seen.has(item.id) ? `${item.id}~${i}` : item.id
    seen.add(id)
    return id
  })
}

/**
 * Cache only translations that pass placeholder validation; otherwise every subsequent hit needs another request to repair it
 * (Codex #30). Infer expectations from request text: serialize escapes literal source < and >,
 * so request tags must be placeholders. No validation callback needs to cross the message boundary (issue #42).
 */
const admits = (source: string, translated: string): boolean => validate(translated, expectationsFromText(source)).ok

/** Treat an expired budget as all misses: extra requests are better than stalling the page. Also used for OCR cache reads (Codex #87). */
export async function readWithBudget(store: CachePort, keys: string[], budgetMs: number): Promise<(string | null)[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hits = await Promise.race([
    store.getMany(keys),
    new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), budgetMs) }),
  ]).finally(() => clearTimeout(timer))
  // A count mismatch means the response does not correspond to the request; indexed lookup would misassign entries. Treat all as misses.
  if (hits !== null && hits.length === keys.length) return hits
  console.warn(`[axt] Cache read ${hits === null ? `did not return within ${budgetMs} ms` : 'returned a different item count'}; continuing with cache misses`)
  return keys.map(() => null)
}

export function createTranslateService(deps: TranslateServiceDeps): TranslateService {
  const queues = new Map<string, ProviderQueues>()
  const cancelledScopes = new CancelledScopeRegistry()
  const baseTimeoutMs = deps.queue?.timeoutMs ?? DEFAULT_QUEUE_OPTIONS.timeoutMs
  const timeoutFor = (chars: number) => Math.min(baseTimeoutMs + chars * BATCH_TIMEOUT_PER_CHAR_MS, MAX_BATCH_TIMEOUT_MS)

  /**
   * Convert provider id/shape errors into BatchQueue errors, marked non-retryable for RequestQueue.
   * **Do not convert isolatable: false** (Codex #61): BatchQueue retries and falls back per item only for BatchCountMismatchError.
   * Conversion would add three batch retries plus one request per segment to a systemic failure,
   * wasting 104 requests for 100 segments. A free engine's non-JSON response remains invalid at any batch size.
   * RequestQueue must not retry these as unknown errors; BatchQueue handles three retries then individual fallback. Otherwise 3 × 4 = 12 calls occur first.
   * Setting kind also prevents raw model output containing "429" or "timeout" from fooling message-based classification.
   */
  const asBatchError = (e: unknown, expected: number): unknown =>
    e instanceof ProviderError && e.kind === 'invalid-response' && e.isolatable
      ? attachRequestErrorMeta(new BatchCountMismatchError(expected, 0, [e.message]), { kind: 'bad-request', isRetryable: false })
      : e

  const translateItems = async (items: QueueItem[], ids: string[], signal: AbortSignal | undefined): Promise<string[]> => {
    const first = items[0]!
    try {
      const result = await first.provider.translate({ ...first.request, segments: items.map((item, i) => ({ id: ids[i]!, text: item.text })), signal })
      const byId = new Map(result.segments.map(s => [s.id, s.text]))
      return ids.map(id => byId.get(id) ?? '')
    } catch (e) {
      throw asBatchError(e, items.length)
    }
  }

  const queuesFor = (provider: TranslationProvider): ProviderQueues => {
    const existing = queues.get(provider.id)
    if (existing) return existing
    const rate = provider.rateLimit?.rate ?? deps.queue?.rate ?? DEFAULT_RATE_LIMIT.rate
    const capacity = provider.rateLimit?.capacity ?? deps.queue?.capacity ?? DEFAULT_RATE_LIMIT.capacity
    // Concurrency and rate are separate gates (§8.3); fast endpoints need concurrency control, while rate limits may waste time waiting for tokens.
    const maxConcurrent = provider.maxConcurrent ?? deps.queue?.maxConcurrent ?? DEFAULT_QUEUE_OPTIONS.maxConcurrent
    const queueOptions = { ...DEFAULT_QUEUE_OPTIONS, ...deps.queue, rate, capacity, maxConcurrent }
    const maxTotalMs = queueOptions.maxTotalMs
    /**
     * The deadline covers the **entire batch**, not each enqueue: batch retries and individual fallback reuse the same meta.
     * Recomputing it would grant four full budgets for four attempts (Codex #56).
     */
    const deadlineOf = (meta: { startedAt: number }) => maxTotalMs === undefined ? undefined : meta.startedAt + maxTotalMs
    const requestQueue = new RequestQueue(queueOptions)
    const batchQueue = new BatchQueue<QueueItem, string>({
      maxCharactersPerBatch: provider.maxBatchChars,
      maxItemsPerBatch: provider.maxBatchItems,
      batchDelay: deps.batch?.batchDelay ?? BATCH_DELAY_MS,
      maxRetries: deps.batch?.maxRetries ?? BATCH_MAX_RETRIES,
      maxTotalMs,
      enableFallbackToIndividual: deps.batch?.enableFallbackToIndividual ?? true,
      // Dispatch gate: when rate-limited with no free slot, keep accumulating to the cap instead of queueing a tiny frozen batch every 100ms.
      dispatchGate: { nextDispatchEtaMs: () => requestQueue.nextDispatchEtaMs() },
      getBatchKey: item => item.batchKey,
      getCharacters: item => item.text.length,
      getDedupKey: item => item.dedupKey,
      getScope: item => item.scope,
      isScopeCancelled: scope => cancelledScopes.has(scope),
      executeBatch: (items, meta) => {
        const ids = uniqueIds(items)
        const chars = items.reduce((n, item) => n + item.text.length, 0)
        const hash = items.map(item => item.dedupKey ?? item.uid).join('|')
        const scheduleAt = Math.min(...items.map(item => item.scheduleAt))
        return requestQueue.enqueue(signal => translateItems(items, ids, signal), scheduleAt, hash, meta.scopes, { timeoutMs: timeoutFor(chars), deadlineAt: deadlineOf(meta) })
      },
      executeIndividual: (item, meta) => requestQueue.enqueue(
        async signal => (await translateItems([item], [item.id], signal))[0]!,
        item.scheduleAt,
        item.dedupKey ?? item.uid,
        item.scope ? [item.scope] : undefined,
        // Individual fallback is the final stage for the same texts; it must not receive another full budget (Codex #56).
        { timeoutMs: timeoutFor(item.text.length), deadlineAt: deadlineOf(meta) },
      ),
      onError: (error, context) => {
        console.warn(`[axt] Batch failed (${context.isFallback ? 'individual fallback' : `before retry ${context.retryCount}`}): ${error.message}`)
      },
    })
    const pair = { requestQueue, batchQueue }
    queues.set(provider.id, pair)
    return pair
  }

  const translate = async ({ request, providerId, cache, scope }: TranslateCall): Promise<TranslateMessageResponse> => {
    try {
      const provider = await deps.getProvider(providerId)
      const model = (await deps.getModel?.()) ?? ''
      const store = cache && deps.cache ? deps.cache : null

      // 1. Cache lookup: compute all keys, then read in bulk.
      const keys = new Map<string, string>()
      const translated = new Map<string, string>()
      if (store && cache) {
        const computed = await Promise.all(request.segments.map(segment =>
          cacheKeyFor({ providerId: provider.cacheId ?? provider.id, model, promptKey: provider.promptKey ?? '', context: provider.promptKey ? request.context : undefined, target: request.target, renderPath: cache.renderPath, text: segment.text }),
        ))
        request.segments.forEach((segment, i) => {
          keys.set(segment.id, computed[i]!)
        })
        // Retry writes only: rereading an already cached invalid result would repeat the failure.
        if (!cache.bypass) {
          const hits = await readWithBudget(store, computed, deps.cacheReadBudgetMs ?? CACHE_READ_BUDGET_MS)
          request.segments.forEach((segment, i) => {
            const hit = hits[i]
            if (hit !== null && hit !== undefined) translated.set(segment.id, hit)
          })
        }
      }
      // Cache reads yielded; the scope may have been cancelled meanwhile (Read Frog translation-queues.ts also checks after await).
      if (scope && cancelledScopes.has(scope)) return { ok: false, error: { kind: 'aborted', message: `Cancelled (scope: ${scope})` } }
      const cached = translated.size

      // 2. Queue misses individually; segments from one call share a batch key and accumulate together.
      const misses = request.segments.filter(s => !translated.has(s.id))
      if (misses.length > 0) {
        const pair = queuesFor(provider)
        const now = Date.now()
        // Context matters only for engines with prompts, matching cacheKeyFor above.
        // Without this check, sectionTitle supplied by run.ts changes the key at every section boundary,
        // preventing free-engine batches from spanning sections and defeating accumulation (§8.3).
        const batchContext = provider.promptKey ? request.context : undefined
        const batchKey = JSON.stringify([provider.id, model, provider.promptKey ?? '', request.target, cache?.renderPath ?? '', batchContext ?? null])
        const items: QueueItem[] = misses.map(segment => ({
          uid: getRandomUUID(),
          id: segment.id,
          text: segment.text,
          batchKey,
          dedupKey: cache && !cache.bypass ? keys.get(segment.id) : undefined,
          scope,
          scheduleAt: now,
          provider,
          request: { source: request.source, target: request.target, context: request.context },
        }))
        const settled = await Promise.allSettled(items.map(item => pair.batchQueue.enqueue(item)))

        // 3. Cache successful, accepted results first: one call may span two batches; one failure must not discard the other's success,
        //    or run.ts splitting and retrying would waste paid requests.
        const writes: CacheEntry[] = []
        const failures: unknown[] = []
        settled.forEach((outcome, i) => {
          const item = items[i]!
          if (outcome.status === 'rejected') {
            failures.push(outcome.reason)
            return
          }
          translated.set(item.id, outcome.value)
          const key = keys.get(item.id)
          if (store && cache && key && admits(item.text, outcome.value)) writes.push({ key, translation: outcome.value, paper: cache.paper })
        })
        // Recheck cancellation before writing (Codex #33): a call may span multiple batches, and early results
        // can fulfill before cancel(scope) removes the rest. Promise.allSettled would otherwise write those results afterward,
        // violating the promise of no cache writes after restoring the original.
        if (store && writes.length > 0 && !(scope && cancelledScopes.has(scope))) await store.putMany(writes)
        if (failures.length > 0) return { ok: false, error: toErrorInfo(pickError(failures)) }
      }

      // 4. Merge in original order.
      const segments = request.segments.map(s => ({ id: s.id, text: translated.get(s.id) ?? '' }))
      return { ok: true, result: { segments, provider: provider.id, model: model || undefined }, cached }
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) }
    }
  }

  const cancel = (scope: string): number => {
    // Register cancellation before draining: synchronous registration is visible when pending cache reads resume.
    // Cancel batching before request queues; reversing them lets accumulated batches flush new tasks between drains (Read Frog translation-queues.ts:616).
    cancelledScopes.markScope(scope)
    let cancelled = 0
    for (const { requestQueue, batchQueue } of queues.values()) {
      cancelled += batchQueue.cancelByScope(scope)
      cancelled += requestQueue.cancelByScope(scope)
    }
    return cancelled
  }

  return { translate, cancel }
}

/** For multiple segment failures, prefer configuration errors (run.ts halts on them), then actual failures, then cancellations. */
function pickError(errors: unknown[]): unknown {
  const kinds = errors.map(e => toErrorInfo(e).kind)
  const fatal = kinds.findIndex(kind => kind === 'no-key' || kind === 'auth')
  if (fatal >= 0) return errors[fatal]
  const real = kinds.findIndex(kind => kind !== 'aborted')
  return real >= 0 ? errors[real] : errors[0]
}

export function toErrorInfo(e: unknown): { kind: ProviderErrorKind; message: string } {
  if (e instanceof ProviderError) return { kind: e.kind, message: e.message }
  if (isTranslationCancelledError(e)) return { kind: 'aborted', message: (e as Error).message }
  if (e instanceof Error && e.name === REQUEST_TIMEOUT_ERROR_NAME) return { kind: 'timeout', message: e.message }
  if (e instanceof BatchCountMismatchError) return { kind: 'invalid-response', message: e.message }
  return { kind: 'unknown', message: e instanceof Error ? e.message : String(e) }
}
