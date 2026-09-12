// 翻译服务：查缓存 → 只把未命中的段落交给 provider → 回写缓存。
// 请求层是移植的 Read Frog utils/request（DESIGN §8.2、§10）：RequestQueue 管速率（令牌桶）、超时、重试、
// 429 暂停与暂停后的单探针、401 / no-key 排空整队、按 scope 取消；BatchQueue 把同一批次键的段落攒成一批，
// 派发闸让它在限流期间多攒少发。组装方式照 Read Frog 的 background/translation-queues.ts，只是跑在 content 侧（§8.0）。
// 与运行上下文无关：缓存通过 CachePort 注入，background 用本地 Dexie，content 用消息代理。
import type { WireFormat } from '@/core/protector'
import { wireFormatOf } from '@/cache/key'
import type { CachedEntry } from '@/cache/store'
import { cacheKeyFor, type RenderPath } from '@/cache/key'
import { type SentenceAlignment, verifyAlignment } from './alignment'
import { markSentences, stripMarkers, unmarkSentences, type MarkedText } from './sentence-markers'
// 深引 validate 而不是 protector 的桶：serialize / rehydrate 要碰 DOM，那两个不该进 background 的包
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
  /** 引擎报回并已通过校验的句子对齐；没有就不写 */
  alignment?: SentenceAlignment
  key: string
  translation: string
  paper: string
}

/** 缓存的最小接口；批量读写，避免每段一次往返 */
export interface CachePort {
  getMany(keys: string[]): Promise<(CachedEntry | null)[]>
  putMany(entries: CacheEntry[]): Promise<void>
}

export type TranslateMessageRequest = {
  request: Omit<TranslateRequest, 'signal'>
  providerId?: string
  /** 不带即不缓存（如设置页的连接测试） */
  cache?: {
    paper: string
    renderPath: RenderPath
    /** 只写不读：占位符校验失败后的重发，不能再拿回那份坏译文（§6.3） */
    bypass?: boolean
  }
}

/** 取消范围：一次运行一个 id，恢复原文时整体撤掉。可以过消息边界，所以两条路径上都有 */
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
  /** 队列参数覆盖（测试用）：timeoutMs 是批次超时公式的基数；rate / capacity 以 provider.rateLimit 优先，其次这里，最后 8 / 20 */
  queue?: Partial<QueueOptions>
  /** 读缓存的等待上限（测试用）；默认 CACHE_READ_BUDGET_MS */
  cacheReadBudgetMs?: number
  /** 攒批参数覆盖（测试用） */
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

/** Read Frog 的默认队列参数（DEFAULT_CONFIG.pageTranslation.requestQueueConfig 与 translation-queues.ts 里的常量） */
export const DEFAULT_RATE_LIMIT = { rate: 8, capacity: 20 } as const

/**
 * 读缓存的等待上限。缓存是优化不是依赖：服务是**先等缓存再发请求**的，读一旦挂住整页翻译就停在那里
 *（issue #45 的实验 2）。content 侧的消息端口自己也有 1.5s 预算，这里是最后一道闸——
 * 换任何 CachePort 实现（background 直连 Dexie、测试替身）都保证翻译不会被缓存拖死
 */
export const CACHE_READ_BUDGET_MS = 2_000

/**
 * 同时在飞的上限与单批总时限（issue #43）。令牌桶只管速率，响应一慢在飞数就没有上限——
 * 一篇 220 块的论文能攒出 50 多个批次，全部同时打向一个端点会招致 429、撞浏览器连接上限。
 * 取 8 与 rate 相同：响应快于 1 秒时这道闸根本不触发，慢响应下才封顶。
 * 总时限 180 秒：单次尝试最长 120 秒（20s + 15ms/字），持续 429 时暂停窗口会把总时长拖到分钟级
 *（实测 60 秒还没结束），到点就让这批失败、由用户重试，好过无限期悬着
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
/** 批次超时随字数放大：基数 + 每字 15ms，上限 120s（Read Frog utils/constants/translate.ts）。1000 字的批 35s */
const BATCH_TIMEOUT_PER_CHAR_MS = 15
const MAX_BATCH_TIMEOUT_MS = 120_000

/** 进队列的一段：BatchQueue 按 batchKey 攒批、按 dedupKey 去重、按 scope 取消；结果只是译文字符串（去重会把同一结果交给两个条目） */
interface QueueItem {
  uid: string
  id: string
  text: string
  /**
   * 原始的线上文本。`text` 可能带着句子标记（§8.6），而校验对齐、判定占位符完整性
   * 都要拿没插标记的那份比
   */
  source: string
  /** 这一段插了哪些标记（§8.6）；不插就没有 */
  marks?: MarkedText
  batchKey: string
  dedupKey?: string
  scope?: string
  scheduleAt: number
  provider: TranslationProvider
  request: Pick<TranslateRequest, 'source' | 'target' | 'context'>
  /** 这一段匹配到的术语（§8.2）；没配术语表时为 undefined，与从前完全一致 */
  terms?: readonly GlossaryEntry[]
}

/**
 * 这个引擎在**哪些会话**里已经出过不可恢复的错。粒度是会话而不是 service 生命周期：
 * 一轮翻译死了就是这一轮死了，换个页面、或者用户改完 key 重翻，都该重新试一次。
 * 按 service 记的话，设置页点一次「测试连接」失败就会把随后的整页翻译也堵死——e2e 抓到过。
 */
interface FatalState {
  scopes: Map<string, unknown>
}

interface ProviderQueues {
  requestQueue: RequestQueue
  fatal: FatalState
  /**
   * 每个 provider 都攒批。Read Frog 的 `shouldUseBatchQueue` 只给 LLM 攒，因为它的免费引擎是**单条接口**；
   * 我们的不是——`translateHtml` 一次能带 150 条（RESEARCH §6.6），内置引擎声明 20 条。照抄那条判断
   * 等于把免费引擎最大的优势扔掉：实测 216 块发了 61 个请求、中位每个只装 2 条（上限 100 条 / 8000 字，§8.3）。
   * `maxItemsPerBatch` 为 1 的 provider 由 BatchQueue 自然退化成一条一个请求，不需要另一条路径
   */
  batchQueue: BatchQueue<QueueItem, TranslationOutcome>
}

/** provider 看到的 id 必须唯一：不同调用的段可能同 id（同一段落重发、连接测试连发三次）混进一批 */
function uniqueIds(items: QueueItem[]): string[] {
  const seen = new Set<string>()
  return items.map((item, i) => {
    const id = seen.has(item.id) ? `${item.id}~${i}` : item.id
    seen.add(id)
    return id
  })
}

/**
 * 只有占位符校验通过的译文才写缓存：坏译文入了库，之后每次都要先读到它、再花一次请求重来
 *（Codex 在 #30 指出）。期望从**请求文本**反推——两种格式的转义都保证「线上出现的占位符
 * 必然是我们写进去的」（protector/text.ts 的不可伪造性论证），所以不需要把校验回调传过消息边界（issue #42）。
 * **格式必须跟着 renderPath 走**：拿 tags 的分词器扫 markers 文本会认不出任何占位符，
 * 期望为空 → 校验恒真 → 被打烂的译文静默进缓存
 */
const admits = (source: string, translated: string, format: WireFormat): boolean =>
  validate(translated, expectationsFromText(source, format)).ok

/** 超预算就当全部未命中：多花一次请求，好过整页停在这里。OCR 服务读缓存也用它（Codex 在 #87 指出） */
export async function readWithBudget(store: CachePort, keys: string[], budgetMs: number): Promise<(CachedEntry | null)[]> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const hits = await Promise.race([
    store.getMany(keys),
    new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), budgetMs) }),
  ]).finally(() => clearTimeout(timer))
  // 条数对不上说明这份响应与请求不配对，按索引取会张冠李戴：整批当未命中
  if (hits !== null && hits.length === keys.length) return hits
  console.warn(`[axt] 读缓存${hits === null ? `超过 ${budgetMs} ms 未返回` : '返回条数与请求不符'}，按未命中继续翻译`)
  return keys.map(() => null)
}

export function createTranslateService(deps: TranslateServiceDeps): TranslateService {
  const queues = new Map<string, ProviderQueues>()
  /** A call that must not go on: its scope is dead, or this whole chain is */
  const refused = (scope: string | undefined): boolean => deps.retired?.() === true || (scope !== undefined && deps.cancelled.has(scope))
  const baseTimeoutMs = deps.queue?.timeoutMs ?? DEFAULT_QUEUE_OPTIONS.timeoutMs
  const timeoutFor = (chars: number) => Math.min(baseTimeoutMs + chars * BATCH_TIMEOUT_PER_CHAR_MS, MAX_BATCH_TIMEOUT_MS)

  /**
   * 把 provider 报的"id 对不上 / 结构坏了"换成 BatchQueue 认的批次错误，并标成不可重试。
   * **声明 `isolatable: false` 的不转**（Codex 在 #61 指出）：BatchQueue 只对 `BatchCountMismatchError`
   * 重试与逐条兜底，转过去就等于给系统性失败叠上 3 次批级重试 + 每段一次请求——
   * 100 段的一批白打 104 次。免费引擎返回的不是 JSON 就属于这种，拆多小都一样。
   * RequestQueue 不再按未知错误重试，BatchQueue 重试 3 次后逐条兜底。不标的话逐条兜底前要先打 3 × 4 = 12 次；
   * 标了 kind 也免得消息里带的模型原始输出被 "429" / "timeout" 的正则误判
   */
  const asBatchError = (e: unknown, expected: number): unknown =>
    e instanceof ProviderError && e.kind === 'invalid-response' && e.isolatable
      ? attachRequestErrorMeta(new BatchCountMismatchError(expected, 0, [e.message]), { kind: 'bad-request', isRetryable: false })
      : e

  /**
   * 一批的发送与接收。**句子标记在这一层进出**（§8.6）：引擎自己不汇报句边界时，把切好的边界
   * 以 `<x id="N"/>` 插进线上文本，回来再摘掉、顺带读出译文侧的边界。
   *
   * 放在这里而不是各 provider 里，是因为它与引擎无关——凡是保得住 `tags` 的引擎都适用，
   * 而每个 provider 各写一份就会各错一份。摘不干净的那些返回原样文本、不带对齐，
   * 没有对齐只是没有高亮（`alignment.ts`）
   */
  /**
   * 一段进队列时的形态：要送的文本、原始文本、插了哪些标记（§8.6）。
   *
   * 只有 `tags` 这条路插：`markers` 那条线上没有活得下来的标记；`runs` 送的是切碎的纯文本段、
   * 拼回去不产出线上偏移，对齐在那里没有东西可挂。引擎自己汇报的（微软）也不插
   */
  const markedItem = (provider: TranslationProvider, renderPath: RenderPath | undefined, segment: TranslateSegment): { text: string; source: string; marks?: MarkedText } => {
    const plain = { text: segment.text, source: segment.text }
    const cuts = segment.cuts
    if (provider.reportsSentences || renderPath !== 'tags' || !cuts) return plain
    // 一句话的块：整段对整段就是安全的对齐，不必插任何标记（§8.6）
    if (cuts.length === 0) return { ...plain, marks: { text: segment.text, source: [segment.text.length], ids: [] } }
    const marks = markSentences(segment.text, cuts)
    if (!marks) return plain
    // **单条也可能超限**：`BatchQueue` 的字符上限只拦「合批」，一条任务超了也照发不误
    //（Codex 在 #137 指出）。插完超了就不插——没有对齐只是没有高亮，而超限是整批失败
    if (marks.text.length > provider.maxBatchChars) return plain
    return { text: marks.text, source: segment.text, marks }
  }

  /**
   * 一批发一份提示词，所以术语取这一批的**并集**，顺序仍按术语表本身——
   * 同一组术语在任何批次里都渲染成同一段文字。各段的缓存键只带自己那几条：
   * 一条没在本段出现的术语改不了本段的译文（Read Frog 的 `mergeBatchGlossaryTerms` 是同一个取舍）
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
        // 摘不干净就退回「没有对齐」：坏的边界会把高亮打在错的句子上，比没有高亮更糟。
        // 文本仍然要摘一遍——`unmarkSentences` 失败时它可能还带着标记，那绝不能进 DOM
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
    // 并发上限与令牌桶是两种闸（§8.3）：响应快的端点靠并发就够，用速率限反而让快响应白等令牌
    const maxConcurrent = provider.maxConcurrent ?? deps.queue?.maxConcurrent ?? DEFAULT_QUEUE_OPTIONS.maxConcurrent
    const queueOptions = { ...DEFAULT_QUEUE_OPTIONS, ...deps.queue, rate, capacity, maxConcurrent }
    const maxTotalMs = queueOptions.maxTotalMs
    /**
     * 期限按**整批**算，不按每次入队算：批级重试与逐条兜底都带着同一个 meta 再来，
     * 各自重算就等于 4 次重试 4 份预算（Codex 在 #56 指出）
     */
    const deadlineOf = (meta: { startedAt: number }) => maxTotalMs === undefined ? undefined : meta.startedAt + maxTotalMs
    const fatal: FatalState = { scopes: new Map() }
    /**
     * 整批都属于已致命的会话时给出那个错。
     *
     * 判据取 `meta.scopes`——**批次在 flush 那一刻的 scope 并集**，不是成员自己的 `item.scope`：
     * 去重会把新会话的相同段落并进一个还挂着的旧任务，此时被保留的 `QueueItem` 带的仍是旧（已致命的）
     * scope，而新会话只出现在 `meta.scopes` 里。只看 item 的话会把这一批当成死的拒掉，把陈旧的 auth
     * 错误回给新调用方，接着又把新 scope 也标成致命——一路串下去（Codex 在 #113 指出）。
     * `undefined` 表示批里有不可取消（无 scope）的成员，照常发。与 `rejectIfAllScopesCancelled` 同一套语义
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
      // 派发闸：限流期间没有空位时批次继续攒到上限，而不是每 100ms 刷出一小批排在队里冻着
      dispatchGate: { nextDispatchEtaMs: () => requestQueue.nextDispatchEtaMs() },
      getBatchKey: item => item.batchKey,
      getCharacters: item => item.text.length,
      getDedupKey: item => item.dedupKey,
      getScope: item => item.scope,
      isScopeCancelled: scope => refused(scope),
      executeBatch: (items, meta) => {
        // 这一批所属的会话已经致命：当场拒，不进 RequestQueue、不打端点。BatchQueue 只对
        // BatchCountMismatchError 重试或走逐条兜底，所以这里拒了就是终局，不会绕出第二条路
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
        // The batch's live subscribers, not the item's own scope: a deduplicated peer's interest in this item is
        // known to the batch, and a scope that died since the flush must not be subscribed again
        const scopes = liveScopes(meta)
        if (scopes === null) return Promise.reject(nobodyLeft(meta))
        return requestQueue.enqueue(
          async signal => (await translateItems([item], [item.id], signal))[0]!,
          item.scheduleAt,
          item.dedupKey ?? item.uid,
          scopes,
          // 逐条兜底是同一批文本的最后一程，不能再拿一份完整预算（Codex 在 #56 指出）
          { timeoutMs: timeoutFor(item.text.length), deadlineAt: deadlineOf(meta) },
        )
      },
      onError: (error, context) => {
        console.warn(`[axt] 批次失败（${context.isFallback ? '逐条兜底' : `第 ${context.retryCount} 次重试前`}）：${error.message}`)
      },
    })
    const pair: ProviderQueues = { requestQueue, batchQueue, fatal }
    queues.set(provider.id, pair)
    return pair
  }

  const translate = async ({ request, providerId, cache, scope }: TranslateCall): Promise<TranslateMessageResponse> => {
    /** Nothing of this call goes back: its scope died, or its chain was retired */
    const refusal = (): TranslateMessageResponse => ({ ok: false, error: { kind: 'aborted', message: scope === undefined ? '已取消（链已退役）' : `已取消（scope: ${scope}）`, isolatable: false } })
    try {
      const provider = await deps.getProvider(providerId)
      const model = (await deps.getModel?.()) ?? ''
      const store = cache && deps.cache ? deps.cache : null

      // 术语表只发这一段真的用到的（§8.2）：整张表进每一批，请求可能因此翻倍，
      // 缓存键里也带着整张表——改一条术语，全站缓存作废。匹配用的是**去掉占位符之后的正文**：
      // 线上文本里那些 `<x id="1"/>` 会让术语跨不过去，属性名本身也会被当成正文命中（`id`）
      const glossary = request.context?.glossary ?? []
      const matcher = glossary.length > 0 ? createGlossaryMatcher(glossary) : null
      const wire = wireFormatOf(cache?.renderPath ?? 'tags')
      // 逐个文本 token 解实体再拼：线上文本里 `&` / `<` / `>` 是转义过的（serialize.ts），术语
      // `R&D`、`<UNK>` 对着 `R&amp;D`、`&lt;UNK&gt;` 永远匹配不上（Codex 在 #163 指出）。
      // 先拼后解会凭空造出实体——`foo&` + 占位符 + `amp;bar` 拼起来像个 `&amp;`，所以逐段解
      const proseOf = (text: string) => Array.from(tokenize(text, wire)).filter(t => t.kind === 'text').map(t => decodeText(t.text)).join('')
      const termsFor = (segment: { text: string }) => (matcher ? matcher.match(proseOf(segment.text)) : [])
      /** 这一段自己用到的术语进它自己的键；没配术语表时与从前逐字节相同 */
      const contextFor = (segment: { text: string }) => {
        if (!provider.promptKey || !request.context) return undefined
        if (!matcher) return request.context
        const matched = termsFor(segment)
        return matched.length > 0 ? { ...request.context, glossary: matched } : { ...request.context, glossary: undefined }
      }

      // 1. 查缓存：一次算完所有键，一次批量读
      const keys = new Map<string, string>()
      const translated = new Map<string, TranslationOutcome>()
      if (store && cache) {
        const computed = await Promise.all(request.segments.map(segment =>
          cacheKeyFor({ providerId: provider.cacheId ?? provider.id, model, promptKey: provider.promptKey ?? '', context: contextFor(segment), target: request.target, renderPath: cache.renderPath, text: segment.text, ...(segment.cuts ? { cuts: segment.cuts } : {}) }),
        ))
        request.segments.forEach((segment, i) => {
          keys.set(segment.id, computed[i]!)
        })
        // 重发只写不读：坏译文已经在库里，读回来只会再坏一次
        if (!cache.bypass) {
          const hits = await readWithBudget(store, computed, deps.cacheReadBudgetMs ?? CACHE_READ_BUDGET_MS)
          request.segments.forEach((segment, i) => {
            const hit = hits[i]
            if (hit === null || hit === undefined) return
            // 命中时**重新校验一次**对齐：源文本到这一步才有，键碰撞或源文变动都会在这里被挡下，
            // 宁可没有高亮也不要把高亮打在错的句子上（alignment.ts 的那条原则）
            translated.set(segment.id, { text: hit.translation, alignment: verifyAlignment(hit.alignment, segment.text, hit.translation) })
          })
        }
      }
      // 读缓存时让出过主线程，这期间 scope 可能已被撤销（Read Frog translation-queues.ts 也在 await 之后查一次）
      if (refused(scope)) return refusal()
      const cached = translated.size

      // 2. 未命中的逐段入队；同一次调用的段落批次键相同，会攒在一起
      const misses = request.segments.filter(s => !translated.has(s.id))
      if (misses.length > 0) {
        const pair = queuesFor(provider)
        const now = Date.now()
        // 上下文只对有提示词的引擎有意义，和缓存键同一条判断（见上面的 cacheKeyFor）。
        // 不加这道判断的话，run.ts 往 context 里塞的 sectionTitle 每换一节就变一次键，
        // 免费引擎的批次永远跨不了章节——攒批等于没开（§8.3）
        // **按术语表的状态分批，不按匹配结果分批**：拿匹配结果当批次键的话，
        // 用到不同术语的两段就攒不到一起，攒批等于白做
        const batchContext = provider.promptKey ? request.context : undefined
        const batchKey = JSON.stringify([provider.id, model, provider.promptKey ?? '', request.target, cache?.renderPath ?? '', batchContext ?? null])
        const items: QueueItem[] = misses.map(segment => ({
          uid: getRandomUUID(),
          id: segment.id,
          // **在这里插，不在派发时插**：攒批按 `item.text.length` 算大小，派发时才插的话
          // 一个贴着上限的批次会在插完之后超限（Codex 在 #137 指出）
          ...markedItem(provider, cache?.renderPath, segment),
          // 这一段用到的术语；派发时取整批的并集发进提示词（见 translateItems）
          terms: matcher ? termsFor(segment) : undefined,
          batchKey,
          dedupKey: cache && !cache.bypass ? keys.get(segment.id) : undefined,
          scope,
          scheduleAt: now,
          provider,
          request: { source: request.source, target: request.target, context: request.context },
        }))
        /**
         * 一条 reject 就记，不等 `allSettled`。一次调用的段落可能被拆成「满批 + 欠满的尾巴」
         *（图片 OCR 的行数不受 provider 的 maxBatchItems 约束），满批按条数立刻派发并秒失败，
         * 尾巴还在等 batchDelay / 派发闸。等 `allSettled` 才记的话，它得先把尾巴也等出来——
         * 而尾巴是**发出去**才失败的，第二波又回来了（Codex 在 #113 指出）。
         * 记在调用方这一层的 scope 归属不受影响：这个 catch 就在调用方的闭包里
         */
        const noteFatal = (e: unknown) => {
          // 会让这条链路本轮整个作废的错（PERMANENT_ERROR_KINDS）：换 key 才可能好转，而换 key 会重建 transport、标记随之清掉；
          // 降级链不受影响——链上每个引擎有各自的 service 与队列表（`transport.ts` 的 steps）
          if (scope && e instanceof ProviderError && isPermanentErrorKind(e.kind)) pair.fatal.scopes.set(scope, e)
        }
        const settled = await Promise.allSettled(items.map(item => pair.batchQueue.enqueue(item).catch(e => {
          noteFatal(e)
          throw e
        })))

        // 3. 先把成功且放行的写缓存：一次调用的段可能横跨两批，一批失败另一批的成果不能丢，
        //    否则 run.ts 对半拆分重发是白花钱
        const writes: CacheEntry[] = []
        const failures: unknown[] = []
        settled.forEach((outcome, i) => {
          const item = items[i]!
          if (outcome.status === 'rejected') {
            failures.push(outcome.reason)
            return
          }
          // 无论对齐来自哪个引擎，都在这一层校验一次：provider 各自校验会漏掉没实现的那些，
          // 而缓存命中那条路也要校验，两边用同一个闸才对称
          // 用没插标记的那份比：`item.text` 可能带着句子标记，长度对不上（§8.6）
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
          // key 没配 / 不认：这轮里再打多少次都是同一个 401。`failQueue` 只排空**那一刻**排在
          // RequestQueue 里的任务，而占满并发槽时等待区恰好是空的——剩下的块还在 BatchQueue 里攒批，
          // 攒完照常派发，于是有第二波（issue #96 实测 +744 ms 又发了 7 个）。这里把状态黏住。
          //
          // 记在**调用方**这一层而不是执行路径上：去重会让两个标签页的相同段落并进同一个队列任务，
          // 执行那头只看得见第一个调用方的 QueueItem，第二个的 scope 就漏了，它后面的批次照样发得出去
          //（Codex 在 #113 指出）。而每个调用方都会各自拿到这个拒绝，在这里记一个都不漏
          // 成功的那些随失败一起回去：它们已经写进缓存，但调用方要据此**渲染**出来，
          // 否则读者看到的是「这一批全失败」，重试时它们又从缓存里秒回（Codex 在 #163 指出）
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

      // 4. 按原顺序合并
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

/** 一次调用里多段失败时报哪个：配置错误优先（run.ts 据此停下），其次真正的失败，最后才是取消 */
function pickError(errors: unknown[]): unknown {
  const kinds = errors.map(e => toErrorInfo(e).kind)
  const fatal = kinds.findIndex(isPermanentErrorKind)
  if (fatal >= 0) return errors[fatal]
  const real = kinds.findIndex(kind => kind !== 'aborted')
  return real >= 0 ? errors[real] : errors[0]
}

/**
 * 错误过消息边界时带上 `isolatable`（§8.5）：content 侧的 `translateSegments` 靠它决定
 * 要不要把批次对半拆开重试。**不带的话每种失败都会拆**——4 段的系统性 `bad-request` 变成
 * 7 次调用（研究审计 B20 实测 `4,2,1,1,2,1,1`），而 service 这一层早就为同一件事
 * 立过规矩（`asBatchError` 不把系统性失败转成批次错误，Codex 在 #61 指出）。
 * 不是 `ProviderError` 的按 kind 取默认值，判据见 types.ts 的 `ISOLATABLE_BY_KIND`
 */
export function toErrorInfo(e: unknown): { kind: ProviderErrorKind; message: string; isolatable: boolean } {
  if (e instanceof ProviderError) return { kind: e.kind, message: e.message, isolatable: e.isolatable }
  if (isTranslationCancelledError(e)) return { kind: 'aborted', message: (e as Error).message, isolatable: false }
  // 超时的恢复归队列（按字数给预算、按整批记期限），内容层再拆就是两层相乘——实测 8 段 15 次
  if (e instanceof Error && e.name === REQUEST_TIMEOUT_ERROR_NAME) return { kind: 'timeout', message: e.message, isolatable: false }
  // 条数对不上正是"某一段把输出带偏了"的典型：拆小能定位到它
  if (e instanceof BatchCountMismatchError) return { kind: 'invalid-response', message: e.message, isolatable: true }
  return { kind: 'unknown', message: e instanceof Error ? e.message : String(e), isolatable: true }
}
