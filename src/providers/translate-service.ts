// The translation service: read the cache → hand only the misses to the provider → write the cache back.
// The request layer is Read Frog's utils/request, ported (DESIGN §8.2, §10): RequestQueue governs rate (a token
// bucket), timeouts, retries, the 429 pause and the single probe after it, draining the whole queue on 401 / no-key,
// cancellation by scope; BatchQueue collects segments of one batch key into a batch, and its dispatch gate makes it
// collect more and send less under a rate limit. Assembled as Read Frog's background/translation-queues.ts, only on
// the content side (§8.0). Independent of the run context: the cache comes through a CachePort — the background uses the local Dexie, the content side a message proxy.
import type { WireFormat } from '@/core/protector'
import { wireFormatOf } from '@/cache/key'
import type { CachedEntry } from '@/cache/store'
import { cacheKeyFor, type RenderPath } from '@/cache/key'
import { type SentenceAlignment, verifyAlignment } from './alignment'
import { markSentences, stripMarkers, unmarkSentences, type MarkedText } from './sentence-markers'
// validate is imported deep rather than through the protector's barrel: serialize / rehydrate touch the DOM and must not enter the background bundle
import { decodeText } from '@/core/protector/text'
import { tokenize } from '@/core/protector/tokens'
import { expectationsFromText, validate } from '@/core/protector/validate'
import { createGlossaryMatcher, type GlossaryEntry } from './glossary'
import { getRandomUUID } from '@/shared/uuid'
import { BatchCountMismatchError, BatchQueue, type BatchExecutionMeta, type BatchOptions } from './request/batch-queue'
import { type CancelledScopeRegistry, isTranslationCancelledError, TranslationCancelledError } from './request/cancellation'
import { REQUEST_TIMEOUT_ERROR_NAME, RequestQueue, type QueueOptions } from './request/request-queue'
import { attachRequestErrorMeta } from './request/retry-policy'
import { ProviderError, isPermanentErrorKind, type ProviderErrorKind, type TranslatedSegment, type TranslateRequest, type TranslationProvider, type TranslateSegment } from './types'

/**
 * What one segment's translation carries through the queue. `alignment` is present only when the
 * engine reported sentence boundaries and they reconstructed both texts (`alignment.ts`).
 *
 * The queue used to be string-valued, which silently dropped the alignment between the provider and
 * the caller — the type reached the message boundary but the data never did (issue #105).
 */
export interface TranslationOutcome {
  text: string
  alignment?: SentenceAlignment
}

export interface CacheEntry {
  /** The sentence alignment the engine reported and that passed verification; absent, nothing is written */
  alignment?: SentenceAlignment
  key: string
  translation: string
  paper: string
}

/** The cache's minimal interface; bulk reads and writes, no round trip per segment */
export interface CachePort {
  getMany(keys: string[]): Promise<(CachedEntry | null)[]>
  putMany(entries: CacheEntry[]): Promise<void>
}

export type TranslateMessageRequest = {
  request: Omit<TranslateRequest, 'signal'>
  providerId?: string
  /** Absent, nothing is cached (the settings page's connection test, say) */
  cache?: {
    paper: string
    renderPath: RenderPath
    /** Write only, no read: the resend after a failed placeholder validation must not get that bad translation back (§6.3) */
    bypass?: boolean
  }
}

/** The cancellation scope: one id per run, withdrawn as a whole on restore. Crosses the message boundary, so both paths carry it */
export type TranslateCall = TranslateMessageRequest & {
  scope?: string
}

export type TranslateMessageResponse =
  // `alignment` is plain number arrays, so it survives the structured clone across the message boundary
  | { ok: true; result: { segments: TranslatedSegment[]; provider: string; model?: string }; cached: number }
  /**
   * `partial` carries the segments of this call that did come through — a call can be split into
   * several `BatchQueue` batches, and one batch failing must not bury another's finished work
   * (Codex on #163): those translations are already in the cache, but without them here the caller
   * marks every segment failed and the reader is told nothing arrived. Absent when none did.
   */
  | { ok: false; error: { kind: ProviderErrorKind; message: string; isolatable: boolean }; partial?: TranslatedSegment[] }

export interface TranslateServiceDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  getModel?: () => Promise<string | undefined>
  cache?: CachePort
  /** Queue parameter overrides (tests): timeoutMs is the base of the batch timeout formula; rate / capacity take provider.rateLimit first, then this, then 8 / 20 */
  queue?: Partial<QueueOptions>
  /** The cache read's waiting cap (tests); CACHE_READ_BUDGET_MS by default */
  cacheReadBudgetMs?: number
  /** Batching parameter overrides (tests) */
  batch?: Partial<Pick<BatchOptions<QueueItem, TranslationOutcome>, 'batchDelay' | 'maxRetries' | 'enableFallbackToIndividual'>>
  /**
   * Scopes the session router has ended for certain (ADR-0005). Read after the cache read, before the cache write
   * and by the batch queue's liveness hook, so a call that was suspended when its scope was drained never enters a
   * queue and never writes a result (#1881)
   */
  cancelled: Pick<CancelledScopeRegistry, 'has'>
  /**
   * Whether the chain this service belongs to has been retired — a service on it deleted, the sessions moved on
   * (ADR-0005). Unlike the registry this is not about a scope: a connection test carries none, and it must not
   * reach the endpoint with a deleted key either (#157), so every call is refused after its awaits and every
   * batch at dispatch
   */
  retired?: () => boolean
}

export interface TranslateService {
  translate(call: TranslateCall): Promise<TranslateMessageResponse>
  /** Drain the scope's queued and in-flight requests; returns how many. Refusing the scope's later calls is the registry's job, not this method's */
  cancel(scope: string): number
  /** Drain every scoped request, queued or in flight, whichever session left it here; returns how many. Retirement of the chain (ADR-0005) */
  cancelAll(): number
}

/** Read Frog's default queue parameters (DEFAULT_CONFIG.pageTranslation.requestQueueConfig and the constants of translation-queues.ts) */
export const DEFAULT_RATE_LIMIT = { rate: 8, capacity: 20 } as const

/**
 * The cache read's waiting cap. The cache is an optimisation, not a dependency: the service **waits for the cache
 * before requesting**, and a read that hangs stops the whole page's translation right there (experiment 2 of issue
 * #45). The content side's message port has its own 1.5 s budget; this is the last gate — with any CachePort (the background's direct Dexie, a test double) the translation cannot be dragged down by the cache
 */
export const CACHE_READ_BUDGET_MS = 2_000

/**
 * The cap on requests in flight and the total limit of one batch (issue #43). The token bucket governs the rate only,
 * and a slow response leaves the number in flight unbounded — a paper of 220 blocks collects fifty-odd batches, and
 * all of them at one endpoint at once invite 429 and hit the browser's connection limit. 8 equals the rate: with
 * responses under a second the gate never trips, and it caps slow ones only. The total limit is 180 seconds: one
 * attempt is at most 120 seconds (20 s + 15 ms a character), and a lasting 429's pause windows drag the total to
 * minutes (measured: not finished after 60 seconds); at the limit the batch fails and the reader retries, better than hanging indefinitely
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
/** The batch timeout grows with the character count: base + 15 ms a character, capped at 120 s (Read Frog utils/constants/translate.ts). A 1000-character batch gets 35 s */
const BATCH_TIMEOUT_PER_CHAR_MS = 15
const MAX_BATCH_TIMEOUT_MS = 120_000

/** One segment in the queue: BatchQueue batches by batchKey, deduplicates by dedupKey, cancels by scope; the result is only the translated string (deduplication hands one result to two entries) */
interface QueueItem {
  uid: string
  id: string
  text: string
  /**
   * The raw wire text. `text` may carry sentence markers (§8.6), and verifying the alignment and the placeholder
   * integrity both compare against the unmarked copy
   */
  source: string
  /** Which markers were inserted into this segment (§8.6); none when not inserted */
  marks?: MarkedText
  batchKey: string
  dedupKey?: string
  scope?: string
  scheduleAt: number
  provider: TranslationProvider
  request: Pick<TranslateRequest, 'source' | 'target' | 'context'>
  /** The glossary terms this segment matched (§8.2); undefined without a glossary, exactly as before */
  terms?: readonly GlossaryEntry[]
}

/**
 * The sessions in which this engine has already failed unrecoverably. Per session rather than per service lifetime:
 * a dead round is that round dead, and another page, or a retranslation after the reader fixed the key, should try
 * again. Recorded per service, one failed “test connection” on the settings page would block the whole page's translation after — e2e caught that.
 */
interface FatalState {
  scopes: Map<string, unknown>
}

interface ProviderQueues {
  requestQueue: RequestQueue
  fatal: FatalState
  /**
   * Every provider batches. Read Frog's `shouldUseBatchQueue` batches for LLMs only, because its free engines are
   * **single-item APIs**; ours are not — `translateHtml` takes 150 items at once (RESEARCH §6.6), and the built-in
   * engine declares 20. Copying that test would throw away the free engines' greatest advantage: measured, 216 blocks
   * went out as 61 requests with a median of 2 items each (cap 100 items / 8000 characters, §8.3). A provider with
   * `maxItemsPerBatch` 1 degenerates in BatchQueue to one request per item of itself, with no separate path
   */
  batchQueue: BatchQueue<QueueItem, TranslationOutcome>
}

/** The ids the provider sees must be unique: segments of different calls may share an id (the same paragraph resent, a connection test fired three times) and mix into one batch */
function uniqueIds(items: QueueItem[]): string[] {
  const seen = new Set<string>()
  return items.map((item, i) => {
    const id = seen.has(item.id) ? `${item.id}~${i}` : item.id
    seen.add(id)
    return id
  })
}

/**
 * Only a translation that passed placeholder validation is cached: a bad one in the store would be read first every
 * time and cost another request to redo (Codex on #30). The expectations are derived from **the request text** —
 * both formats' escaping guarantees “a placeholder on the wire was written by us” (the unforgeability argument of
 * protector/text.ts), so no validation callback has to cross the message boundary (issue #42). **The format must
 * follow renderPath**: the tags tokeniser over markers text recognises no placeholder, the expectations are empty → validation always passes → a torn translation enters the cache silently
 */
const admits = (source: string, translated: string, format: WireFormat): boolean =>
  validate(translated, expectationsFromText(source, format)).ok

/** Over budget counts as all misses: one more request is cheaper than the whole page stopping here. The OCR service's cache read uses it too (Codex on #87) */
export async function readWithBudget(store: CachePort, keys: string[], budgetMs: number): Promise<(CachedEntry | null)[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hits = await Promise.race([
    store.getMany(keys),
    new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), budgetMs) }),
  ]).finally(() => clearTimeout(timer))
  // A count that does not match means this response is not paired with the request, and indexing into it would mix things up: the whole batch is a miss
  if (hits !== null && hits.length === keys.length) return hits
  console.warn(`[axt] cache read ${hits === null ? `did not return within ${budgetMs} ms` : 'returned a count that does not match the request'}; translating as a miss`)
  return keys.map(() => null)
}

export function createTranslateService(deps: TranslateServiceDeps): TranslateService {
  const queues = new Map<string, ProviderQueues>()
  /** A call that must not go on: its scope is dead, or this whole chain is */
  const refused = (scope: string | undefined): boolean => deps.retired?.() === true || (scope !== undefined && deps.cancelled.has(scope))
  const baseTimeoutMs = deps.queue?.timeoutMs ?? DEFAULT_QUEUE_OPTIONS.timeoutMs
  const timeoutFor = (chars: number) => Math.min(baseTimeoutMs + chars * BATCH_TIMEOUT_PER_CHAR_MS, MAX_BATCH_TIMEOUT_MS)

  /**
   * Turn the provider's “ids do not match / structure broken” into the batch error BatchQueue knows, marked
   * non-retryable. **Not for one declared `isolatable: false`** (Codex on #61): BatchQueue retries and falls back
   * per item on `BatchCountMismatchError` only, and converting would stack 3 batch-level retries + one request per
   * segment on a systemic failure — a batch of 100 segments fired 104 times for nothing. A free engine returning
   * non-JSON is that case, the same however small the split. RequestQueue no longer retries this error as an unknown
   * error; BatchQueue retries it 3 times and then falls back per item. Unmarked, 3 × 4 = 12 requests would go out before the per-item fallback; and with the kind set, the raw model output in the message is not misread by the "429" / "timeout" regex
   */
  const asBatchError = (e: unknown, expected: number): unknown =>
    e instanceof ProviderError && e.kind === 'invalid-response' && e.isolatable
      ? attachRequestErrorMeta(new BatchCountMismatchError(expected, 0, [e.message]), { kind: 'bad-request', isRetryable: false })
      : e

  /**
   * Sending and receiving one batch. **Sentence markers enter and leave at this layer** (§8.6): when the engine does
   * not report sentence boundaries itself, the boundaries cut earlier are inserted into the wire text as
   * `<x id="N"/>`, removed on return, and the translation side's boundaries read off along the way.
   *
   * Here rather than in each provider because it is engine-independent — any engine that keeps `tags` qualifies,
   * and one copy per provider would be one bug per provider. What cannot be removed cleanly returns as the raw text with no alignment; no alignment is only no highlight (`alignment.ts`)
   */
  /**
   * A segment's shape on entering the queue: the text to send, the raw text, the markers inserted (§8.6).
   *
   * Only the `tags` path inserts: `markers` has no marker that survives the wire; `runs` sends fragmented plain-text
   * runs whose joining yields no wire offsets, so an alignment would have nothing to hang on. An engine that reports its own (Microsoft) gets none either
   */
  const markedItem = (provider: TranslationProvider, renderPath: RenderPath | undefined, segment: TranslateSegment): { text: string; source: string; marks?: MarkedText } => {
    const plain = { text: segment.text, source: segment.text }
    const cuts = segment.cuts
    if (provider.reportsSentences || renderPath !== 'tags' || !cuts) return plain
    // A one-sentence block: whole to whole is a safe alignment, no marker needed (§8.6)
    if (cuts.length === 0) return { ...plain, marks: { text: segment.text, source: [segment.text.length], ids: [] } }
    const marks = markSentences(segment.text, cuts)
    if (!marks) return plain
    // **A single item can be over the cap too**: BatchQueue's character cap stops only the *merging*, and an
    // oversized task is sent all the same (Codex on #137). Over the cap once inserted, nothing is inserted — no alignment is only no highlight, while over the cap is a whole batch failed
    if (marks.text.length > provider.maxBatchChars) return plain
    return { text: marks.text, source: segment.text, marks }
  }

  /**
   * One prompt per batch, so the terms are the batch's **union**, still in the glossary's own order — the same set of
   * terms renders as the same text in any batch. Each segment's cache key carries only its own terms: a term absent
   * from a segment cannot change that segment's translation (Read Frog's `mergeBatchGlossaryTerms` makes the same trade-off)
   */
  const batchRequestOf = (items: QueueItem[]): QueueItem['request'] => {
    const first = items[0]!
    const all = first.request.context?.glossary
    if (!all || items.every(item => item.terms === undefined)) return first.request
    const used = new Set(items.flatMap(item => (item.terms ?? []).map(entry => entry.term)))
    const matched = all.filter(entry => used.has(entry.term))
    return { ...first.request, context: { ...first.request.context, glossary: matched.length > 0 ? matched : undefined } }
  }

  const translateItems = async (items: QueueItem[], ids: string[], signal: AbortSignal | undefined): Promise<TranslationOutcome[]> => {
    // The last check before the endpoint, and the only one a retry passes through: the request queue retries the
    // stored thunk without re-entering the batch queue, so a chain retired between two attempts must stop here.
    // Non-retryable, so the queue does not try a third time (ADR-0005). The chain only, never the scopes: the items
    // carry the first subscriber's scope, and a deduplicated peer — another tab, an unscoped connection test, a late
    // joiner during a retry backoff — is known to the queue alone, which drains by refcount (eighteenth pass)
    if (deps.retired?.()) throw attachRequestErrorMeta(new TranslationCancelledError(items[0]?.scope), { isRetryable: false })
    const first = items[0]!
    try {
      const result = await first.provider.translate({
        ...batchRequestOf(items),
        segments: items.map((item, i) => ({ id: ids[i]!, text: item.text })),
        signal,
      })
      const byId = new Map(result.segments.map(s => [s.id, s]))
      return ids.map((id, i) => {
        const segment = byId.get(id)
        if (!segment) return { text: '' }
        const mark = items[i]?.marks
        if (!mark) return { text: segment.text, alignment: segment.alignment }
        const back = unmarkSentences(segment.text, mark.ids)
        // Not removed cleanly, it falls back to “no alignment”: a bad boundary would highlight the wrong sentence, worse
        // than none. The text still has to be stripped once — `unmarkSentences` failing, it may still carry markers, which must never enter the DOM
        if (!back) return { text: stripMarkers(segment.text, mark.ids) }
        return { text: back.text, alignment: { source: mark.source, target: back.target } }
      })
    } catch (e) {
      throw asBatchError(e, items.length)
    }
  }

  const queuesFor = (provider: TranslationProvider): ProviderQueues => {
    const existing = queues.get(provider.id)
    if (existing) return existing
    const rate = provider.rateLimit?.rate ?? deps.queue?.rate ?? DEFAULT_RATE_LIMIT.rate
    const capacity = provider.rateLimit?.capacity ?? deps.queue?.capacity ?? DEFAULT_RATE_LIMIT.capacity
    // The concurrency cap and the token bucket are two gates (§8.3): a fast endpoint needs only the concurrency, and a rate limit would make fast responses wait for tokens for nothing
    const maxConcurrent = provider.maxConcurrent ?? deps.queue?.maxConcurrent ?? DEFAULT_QUEUE_OPTIONS.maxConcurrent
    const queueOptions = { ...DEFAULT_QUEUE_OPTIONS, ...deps.queue, rate, capacity, maxConcurrent }
    const maxTotalMs = queueOptions.maxTotalMs
    /**
     * The deadline is per **batch**, not per enqueue: a batch-level retry and the per-item fallback come back with the
     * same meta, and recomputing each time would give 4 retries 4 budgets (Codex on #56)
     */
    const deadlineOf = (meta: { startedAt: number }) => maxTotalMs === undefined ? undefined : meta.startedAt + maxTotalMs
    const fatal: FatalState = { scopes: new Map() }
    /**
     * The error to give when the whole batch belongs to sessions already fatal.
     *
     * The criterion is `meta.scopes` — **the union of scopes at the moment the batch flushed**, not a member's own
     * `item.scope`: deduplication merges a new session's identical segment into an old task still pending, the
     * `QueueItem` kept then still carries the old (fatal) scope, and the new session appears only in `meta.scopes`.
     * Reading the item alone would refuse this batch as dead, return the stale auth error to the new caller, then mark
     * the new scope fatal too — and on down the line (Codex on #113). `undefined` means the batch has an uncancellable
     * (scopeless) member; sent as usual. The same semantics as `rejectIfAllScopesCancelled`
     */
    const fatalFor = (meta: BatchExecutionMeta): unknown => {
      if (fatal.scopes.size === 0 || !meta.scopes || meta.scopes.length === 0) return undefined
      let error: unknown
      for (const s of meta.scopes) {
        if (!fatal.scopes.has(s)) return undefined
        error ??= fatal.scopes.get(s)
      }
      return error
    }
    /**
     * What a request-queue task subscribes for this batch: the batch's scope union as flushed, minus the scopes
     * that died since. A batch retry reuses the meta of its first flush, and re-subscribing a dead scope keeps the
     * task alive after its last live subscriber is drained — the endpoint is then called for nobody (the local
     * review of ADR-0005, nineteenth pass). `null`: every subscriber died, there is nothing to send for.
     * `undefined` stays `undefined` — an unscoped member keeps the batch alive, as in the queues' refcount
     */
    const liveScopes = (meta: BatchExecutionMeta): readonly string[] | undefined | null => {
      if (!meta.scopes || meta.scopes.length === 0) return meta.scopes
      const live = meta.scopes.filter(scope => !deps.cancelled.has(scope))
      return live.length > 0 ? live : null
    }
    const nobodyLeft = (meta: BatchExecutionMeta) => attachRequestErrorMeta(new TranslationCancelledError(meta.scopes?.join(',')), { isRetryable: false })
    const requestQueue = new RequestQueue(queueOptions)
    const batchQueue = new BatchQueue<QueueItem, TranslationOutcome>({
      maxCharactersPerBatch: provider.maxBatchChars,
      maxItemsPerBatch: provider.maxBatchItems,
      batchDelay: deps.batch?.batchDelay ?? BATCH_DELAY_MS,
      maxRetries: deps.batch?.maxRetries ?? BATCH_MAX_RETRIES,
      maxTotalMs,
      enableFallbackToIndividual: deps.batch?.enableFallbackToIndividual ?? true,
      // The dispatch gate: with no free slot under a rate limit the batch keeps collecting up to the cap, instead of flushing a small batch every 100 ms to freeze in the queue
      dispatchGate: { nextDispatchEtaMs: () => requestQueue.nextDispatchEtaMs() },
      getBatchKey: item => item.batchKey,
      getCharacters: item => item.text.length,
      getDedupKey: item => item.dedupKey,
      getScope: item => item.scope,
      isScopeCancelled: scope => refused(scope),
      executeBatch: (items, meta) => {
        // The session this batch belongs to is fatal already: refused on the spot, never entering RequestQueue or hitting
        // the endpoint. BatchQueue retries or falls back per item on BatchCountMismatchError only, so a refusal here is final and takes no second route
        const dead = fatalFor(meta)
        if (dead !== undefined) return Promise.reject(dead)
        const ids = uniqueIds(items)
        const chars = items.reduce((n, item) => n + item.text.length, 0)
        const hash = items.map(item => item.dedupKey ?? item.uid).join('|')
        const scheduleAt = Math.min(...items.map(item => item.scheduleAt))
        const scopes = liveScopes(meta)
        if (scopes === null) return Promise.reject(nobodyLeft(meta))
        return requestQueue.enqueue(signal => translateItems(items, ids, signal), scheduleAt, hash, scopes, { timeoutMs: timeoutFor(chars), deadlineAt: deadlineOf(meta) })
      },
      executeIndividual: (item, meta) => {
        const dead = fatalFor(meta)
        if (dead !== undefined) return Promise.reject(dead)
        // The item's own subscribers as the batch queue hands them over — its scope and the peers deduplicated onto
        // it — minus the ones that died since the flush. Neither the item's scope alone (a peer would be lost) nor
        // the batch's union (an unrelated live tab would keep a closed tab's items running) says who still wants it
        const scopes = liveScopes(meta)
        if (scopes === null) return Promise.reject(nobodyLeft(meta))
        return requestQueue.enqueue(
          async signal => (await translateItems([item], [item.id], signal))[0]!,
          item.scheduleAt,
          item.dedupKey ?? item.uid,
          scopes,
          // The per-item fallback is the last leg of the same batch of text and gets no fresh full budget (Codex on #56)
          { timeoutMs: timeoutFor(item.text.length), deadlineAt: deadlineOf(meta) },
        )
      },
      onError: (error, context) => {
        console.warn(`[axt] batch failed (${context.isFallback ? 'per-item fallback' : `before retry ${context.retryCount}`}): ${error.message}`)
      },
    })
    const pair: ProviderQueues = { requestQueue, batchQueue, fatal }
    queues.set(provider.id, pair)
    return pair
  }

  const translate = async ({ request, providerId, cache, scope }: TranslateCall): Promise<TranslateMessageResponse> => {
    /** Nothing of this call goes back: its scope died, or its chain was retired */
    const refusal = (): TranslateMessageResponse => ({ ok: false, error: { kind: 'aborted', message: scope === undefined ? 'cancelled (chain retired)' : `cancelled (scope: ${scope})`, isolatable: false } })
    try {
      const provider = await deps.getProvider(providerId)
      const model = (await deps.getModel?.()) ?? ''
      const store = cache && deps.cache ? deps.cache : null

      // Only the glossary terms this segment really uses are sent (§8.2): the whole table in every batch could double
      // the request and sat in the cache key too — one term changed, the whole site's cache void. Matched against **the
      // text with the placeholders removed**: the `<x id="1"/>` in the wire text would keep a term from spanning them, and the attribute name itself would match as text (`id`)
      const glossary = request.context?.glossary ?? []
      const matcher = glossary.length > 0 ? createGlossaryMatcher(glossary) : null
      const wire = wireFormatOf(cache?.renderPath ?? 'tags')
      // Entities decoded token by token, then joined: `&` / `<` / `>` are escaped in the wire text (serialize.ts), so the
      // terms `R&D`, `<UNK>` never match against `R&amp;D`, `&lt;UNK&gt;` (Codex on #163). Joined before decoding, an
      // entity would be conjured out of nothing — `foo&` + a placeholder + `amp;bar` reads like `&amp;` — hence decoded per run
      const proseOf = (text: string) => Array.from(tokenize(text, wire)).filter(t => t.kind === 'text').map(t => decodeText(t.text)).join('')
      const termsFor = (segment: { text: string }) => (matcher ? matcher.match(proseOf(segment.text)) : [])
      /** The terms this segment itself uses go into its own key; without a glossary the key is byte for byte what it was */
      const contextFor = (segment: { text: string }) => {
        if (!provider.promptKey || !request.context) return undefined
        if (!matcher) return request.context
        const matched = termsFor(segment)
        return matched.length > 0 ? { ...request.context, glossary: matched } : { ...request.context, glossary: undefined }
      }

      // 1. The cache: every key computed at once, one bulk read
      const keys = new Map<string, string>()
      const translated = new Map<string, TranslationOutcome>()
      if (store && cache) {
        const computed = await Promise.all(request.segments.map(segment =>
          cacheKeyFor({ providerId: provider.cacheId ?? provider.id, model, promptKey: provider.promptKey ?? '', context: contextFor(segment), target: request.target, renderPath: cache.renderPath, text: segment.text, ...(segment.cuts ? { cuts: segment.cuts } : {}) }),
        ))
        request.segments.forEach((segment, i) => {
          keys.set(segment.id, computed[i]!)
        })
        // A resend writes but does not read: the bad translation is in the store already, and reading it back would only be bad again
        if (!cache.bypass) {
          const hits = await readWithBudget(store, computed, deps.cacheReadBudgetMs ?? CACHE_READ_BUDGET_MS)
          request.segments.forEach((segment, i) => {
            const hit = hits[i]
            if (hit === null || hit === undefined) return
            // On a hit the alignment is **verified once more**: the source text is only available at this step, and a
            // key collision or a changed source is caught here — better no highlight than one on the wrong sentence (the principle of alignment.ts)
            translated.set(segment.id, { text: hit.translation, alignment: verifyAlignment(hit.alignment, segment.text, hit.translation) })
          })
        }
      }
      // The main thread was yielded during the cache read, and the scope may have been withdrawn meanwhile (Read Frog's translation-queues.ts checks after the await too)
      if (refused(scope)) return refusal()
      const cached = translated.size

      // 2. The misses enqueued segment by segment; the segments of one call share a batch key and collect together
      const misses = request.segments.filter(s => !translated.has(s.id))
      if (misses.length > 0) {
        const pair = queuesFor(provider)
        const now = Date.now()
        // The context means something for engines with a prompt only, the same test as the cache key's (cacheKeyFor
        // above). Without it, the sectionTitle run.ts puts into the context changes the key at every section, and a free
        // engine's batches could never span a section — batching as good as off (§8.3).
        // **Batched by the glossary's state, not by the match result**: with the match result as the batch key, two
        // segments using different terms could never collect together, and batching would be for nothing
        const batchContext = provider.promptKey ? request.context : undefined
        const batchKey = JSON.stringify([provider.id, model, provider.promptKey ?? '', request.target, cache?.renderPath ?? '', batchContext ?? null])
        const items: QueueItem[] = misses.map(segment => ({
          uid: getRandomUUID(),
          id: segment.id,
          // **Inserted here, not at dispatch**: batching measures size by `item.text.length`, and inserted at dispatch a
          // batch right at the cap would exceed it once the markers are in (Codex on #137)
          ...markedItem(provider, cache?.renderPath, segment),
          // The terms this segment uses; at dispatch the batch's union goes into the prompt (see translateItems)
          terms: matcher ? termsFor(segment) : undefined,
          batchKey,
          dedupKey: cache && !cache.bypass ? keys.get(segment.id) : undefined,
          scope,
          scheduleAt: now,
          provider,
          request: { source: request.source, target: request.target, context: request.context },
        }))
        /**
         * Recorded on the first reject, not after `allSettled`. One call's segments may be cut into “a full batch + an
         * under-filled tail” (an image's OCR line count is not bound by the provider's maxBatchItems); the full batch
         * dispatches at once by count and fails in a moment, while the tail still waits for batchDelay / the dispatch
         * gate. Recorded only after `allSettled`, the tail would have to be waited out first — and the tail fails only
         * **once sent**, so a second wave came back (Codex on #113). The scope attribution at the caller's layer is unaffected: this catch sits in the caller's closure
         */
        const noteFatal = (e: unknown) => {
          // An error that voids this chain for the round (PERMANENT_ERROR_KINDS): only a changed key can help, and a changed
          // key rebuilds the transport and clears the mark with it; the fallback chain is unaffected — every engine on it has its own service and queues (the steps of `transport.ts`)
          if (scope && e instanceof ProviderError && isPermanentErrorKind(e.kind)) pair.fatal.scopes.set(scope, e)
        }
        const settled = await Promise.allSettled(items.map(item => pair.batchQueue.enqueue(item).catch(e => {
          noteFatal(e)
          throw e
        })))

        // 3. The successful and admitted ones are cached first: one call's segments may span two batches, and one
        //    failing must not lose the other's results, or run.ts's halving resend spends money for nothing
        const writes: CacheEntry[] = []
        const failures: unknown[] = []
        settled.forEach((outcome, i) => {
          const item = items[i]!
          if (outcome.status === 'rejected') {
            failures.push(outcome.reason)
            return
          }
          // Whichever engine the alignment came from, it is verified once at this layer: per-provider verification would
          // miss the ones that never implemented it, and the cache-hit path has to verify too — one gate on both sides is symmetric.
          // Compared against the unmarked copy: `item.text` may carry sentence markers and its length would not match (§8.6)
          const value: TranslationOutcome = { text: outcome.value.text, alignment: verifyAlignment(outcome.value.alignment, item.source, outcome.value.text) }
          translated.set(item.id, value)
          const key = keys.get(item.id)
          if (store && cache && key && admits(item.source, value.text, wireFormatOf(cache.renderPath))) {
            writes.push(value.alignment
              ? { key, translation: value.text, paper: cache.paper, alignment: value.alignment }
              : { key, translation: value.text, paper: cache.paper })
          }
        })
        // The last word, after every batch has settled: the scope died or the chain was retired meanwhile, and
        // nothing of this call goes back — no cache write (a batch that finished before the drain would land in
        // the cache after "restore the page"; Codex on #33), no `partial` for the caller to render, no result
        // from a task an unscoped subscriber kept alive through the drain (the local review of ADR-0005,
        // fifteenth pass)
        if (refused(scope)) return refusal()
        if (store && writes.length > 0) {
          await store.putMany(writes)
          // The write was one more wait: a drop or a retirement during it must not hand the result over either.
          // What was written stays — sound translations under keys derived from their content
          if (refused(scope)) return refusal()
        }
        if (failures.length > 0) {
          const error = pickError(failures)
          // The key unset / refused: any further request this round is the same 401. `failQueue` drains only the tasks
          // queued in RequestQueue **at that moment**, and with the concurrency slots full the waiting area is exactly
          // empty — the remaining blocks are still collecting in BatchQueue and dispatch as usual once collected, so a
          // second wave comes (issue #96 measured 7 more sent at +744 ms). The state is made sticky here.
          // Recorded at the **caller's** layer, not on the execution path: deduplication merges two tabs' identical
          // segments into one queue task, the execution side sees only the first caller's QueueItem, the second's scope is
          // missed, and its later batches still go out (Codex on #113). Every caller gets this refusal itself, so recording here misses none.
          // The successful ones go back with the failure: they are in the cache already, but the caller has to **render**
          // them by this, or the reader sees “this batch all failed” and a retry answers them from the cache in a moment (Codex on #163)
          const partial = request.segments.flatMap(s => {
            const done = translated.get(s.id)
            if (!done) return []
            return [done.alignment ? { id: s.id, text: done.text, alignment: done.alignment } : { id: s.id, text: done.text }]
          })
          return partial.length > 0
            ? { ok: false, error: toErrorInfo(error), partial }
            : { ok: false, error: toErrorInfo(error) }
        }
      }

      // 4. Merged in the original order
      const segments = request.segments.map(s => {
        const outcome = translated.get(s.id)
        return outcome?.alignment ? { id: s.id, text: outcome.text, alignment: outcome.alignment } : { id: s.id, text: outcome?.text ?? '' }
      })
      return { ok: true, result: { segments, provider: provider.id, model: model || undefined }, cached }
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) }
    }
  }

  /**
   * Drain only: whether the scope is dead from now on is the session router's decision, written to the registry
   * this service reads before anything here is drained (ADR-0005). Batch queue before request queue — the other
   * way round, a batch still gathering flushes new tasks between the two drains (Read Frog translation-queues.ts:616)
   */
  const cancel = (scope: string): number => {
    let cancelled = 0
    for (const { requestQueue, batchQueue } of queues.values()) {
      cancelled += batchQueue.cancelByScope(scope)
      cancelled += requestQueue.cancelByScope(scope)
    }
    return cancelled
  }

  // Same order as cancel(): a batch still gathering flushes new tasks between the two drains the other way round.
  // Unscoped work (a connection test) is not drained — the retirement gate refuses its next attempt
  const cancelAll = (): number => {
    let cancelled = 0
    for (const { requestQueue, batchQueue } of queues.values()) {
      cancelled += batchQueue.cancelWhere(() => true)
      cancelled += requestQueue.cancelWhere(() => true)
    }
    return cancelled
  }

  return { translate, cancel, cancelAll }
}

/** Which error to report when several segments of one call failed: a configuration error first (run.ts stops by it), then a real failure, cancellation last */
function pickError(errors: unknown[]): unknown {
  const kinds = errors.map(e => toErrorInfo(e).kind)
  const fatal = kinds.findIndex(isPermanentErrorKind)
  if (fatal >= 0) return errors[fatal]
  const real = kinds.findIndex(kind => kind !== 'aborted')
  return real >= 0 ? errors[real] : errors[0]
}

/**
 * An error crossing the message boundary carries `isolatable` (§8.5): the content side's `translateSegments` decides
 * by it whether to split the batch in half and retry. **Without it every failure would be split** — a systemic
 * `bad-request` over 4 segments became 7 calls (research audit B20 measured `4,2,1,1,2,1,1`), while the service layer
 * had long ruled on the same matter (`asBatchError` does not turn a systemic failure into a batch error, Codex on
 * #61). A non-`ProviderError` takes the default by kind, the criterion being `ISOLATABLE_BY_KIND` of types.ts
 */
export function toErrorInfo(e: unknown): { kind: ProviderErrorKind; message: string; isolatable: boolean } {
  if (e instanceof ProviderError) return { kind: e.kind, message: e.message, isolatable: e.isolatable }
  if (isTranslationCancelledError(e)) return { kind: 'aborted', message: (e as Error).message, isolatable: false }
  // Recovering from a timeout is the queue's job (a budget by character count, a deadline per batch); splitting again at the content layer multiplies the two — 8 segments measured 15 calls
  if (e instanceof Error && e.name === REQUEST_TIMEOUT_ERROR_NAME) return { kind: 'timeout', message: e.message, isolatable: false }
  // A count mismatch is the very picture of “some segment led the output astray”: splitting locates it
  if (e instanceof BatchCountMismatchError) return { kind: 'invalid-response', message: e.message, isolatable: true }
  return { kind: 'unknown', message: e instanceof Error ? e.message : String(e), isolatable: true }
}
