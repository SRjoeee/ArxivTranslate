// 翻译服务：查缓存 → 只把未命中的段落交给 provider → 回写缓存。
// 请求层是移植的 Read Frog utils/request（DESIGN §8.2、§10）：RequestQueue 管速率（令牌桶）、超时、重试、
// 429 暂停与暂停后的单探针、401 / no-key 排空整队、按 scope 取消；BatchQueue 把同一批次键的段落攒成一批，
// 派发闸让它在限流期间多攒少发。组装方式照 Read Frog 的 background/translation-queues.ts，只是跑在 content 侧（§8.0）。
// 与运行上下文无关：缓存通过 CachePort 注入，background 用本地 Dexie，content 用消息代理。
import { cacheKeyFor, type RenderPath } from '@/cache/key'
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

/** 缓存的最小接口；批量读写，避免每段一次往返 */
export interface CachePort {
  getMany(keys: string[]): Promise<(string | null)[]>
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

/**
 * 进程内调用可以多带两样：校验回调（只把它放行的译文写进缓存——坏译文根本不该入库，Codex 在 #30 指出）
 * 与取消范围（一次运行一个 id，恢复原文时整体撤掉）。两者都过不了消息边界，background 路径上没有
 */
export type TranslateCall = TranslateMessageRequest & {
  accept?: (id: string, text: string) => boolean
  scope?: string
}

export type TranslateMessageResponse =
  | { ok: true; result: { segments: { id: string; text: string }[]; provider: string; model?: string }; cached: number }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }

export interface TranslateServiceDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  getModel?: () => Promise<string | undefined>
  cache?: CachePort
  /** 队列参数覆盖（测试用）：timeoutMs 是批次超时公式的基数；rate / capacity 以 provider.rateLimit 优先，其次这里，最后 8 / 20 */
  queue?: Partial<QueueOptions>
  /** 攒批参数覆盖（测试用） */
  batch?: Partial<Pick<BatchOptions<QueueItem, string>, 'batchDelay' | 'maxRetries' | 'enableFallbackToIndividual'>>
}

export interface TranslateService {
  translate(call: TranslateCall): Promise<TranslateMessageResponse>
  /** 撤掉该 scope 排队与在飞的请求；返回撤掉的条数。之后带同一 scope 的调用直接返回 aborted */
  cancel(scope: string): number
}

/** Read Frog 的默认队列参数（DEFAULT_CONFIG.pageTranslation.requestQueueConfig 与 translation-queues.ts 里的常量） */
export const DEFAULT_RATE_LIMIT = { rate: 8, capacity: 20 } as const
const DEFAULT_QUEUE_OPTIONS = { timeoutMs: 20_000, maxRetries: 2, baseRetryDelayMs: 1_000 } as const
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
  batchKey: string
  dedupKey?: string
  scope?: string
  scheduleAt: number
  provider: TranslationProvider
  request: Pick<TranslateRequest, 'source' | 'target' | 'context'>
}

interface ProviderQueues {
  requestQueue: RequestQueue
  /** 只有 LLM 才攒批（Read Frog 的 shouldUseBatchQueue）；免费引擎一次调用一个任务 */
  batchQueue: BatchQueue<QueueItem, string> | null
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

export function createTranslateService(deps: TranslateServiceDeps): TranslateService {
  const queues = new Map<string, ProviderQueues>()
  const cancelledScopes = new CancelledScopeRegistry()
  const baseTimeoutMs = deps.queue?.timeoutMs ?? DEFAULT_QUEUE_OPTIONS.timeoutMs
  const timeoutFor = (chars: number) => Math.min(baseTimeoutMs + chars * BATCH_TIMEOUT_PER_CHAR_MS, MAX_BATCH_TIMEOUT_MS)

  /**
   * 把 provider 报的"id 对不上 / 结构坏了"换成 BatchQueue 认的批次错误，并标成不可重试：
   * RequestQueue 不再按未知错误重试，BatchQueue 重试 3 次后逐条兜底。不标的话逐条兜底前要先打 3 × 4 = 12 次；
   * 标了 kind 也免得消息里带的模型原始输出被 "429" / "timeout" 的正则误判
   */
  const asBatchError = (e: unknown, expected: number): unknown =>
    e instanceof ProviderError && e.kind === 'invalid-response'
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
    const requestQueue = new RequestQueue({ ...DEFAULT_QUEUE_OPTIONS, ...deps.queue, rate, capacity })
    const batchQueue = provider.kind === 'llm'
      ? new BatchQueue<QueueItem, string>({
          maxCharactersPerBatch: provider.maxBatchChars,
          maxItemsPerBatch: provider.maxBatchItems,
          batchDelay: deps.batch?.batchDelay ?? BATCH_DELAY_MS,
          maxRetries: deps.batch?.maxRetries ?? BATCH_MAX_RETRIES,
          enableFallbackToIndividual: deps.batch?.enableFallbackToIndividual ?? true,
          // 派发闸：限流期间没有空位时批次继续攒到上限，而不是每 100ms 刷出一小批排在队里冻着
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
            return requestQueue.enqueue(signal => translateItems(items, ids, signal), scheduleAt, hash, meta.scopes, { timeoutMs: timeoutFor(chars) })
          },
          executeIndividual: item => requestQueue.enqueue(
            async signal => (await translateItems([item], [item.id], signal))[0]!,
            item.scheduleAt,
            item.dedupKey ?? item.uid,
            item.scope ? [item.scope] : undefined,
            { timeoutMs: timeoutFor(item.text.length) },
          ),
          onError: (error, context) => {
            console.warn(`[axt] 批次失败（${context.isFallback ? '逐条兜底' : `第 ${context.retryCount} 次重试前`}）：${error.message}`)
          },
        })
      : null
    const pair = { requestQueue, batchQueue }
    queues.set(provider.id, pair)
    return pair
  }

  /** 免费引擎：一次调用的未命中段落作一个任务，不攒批 */
  const enqueueWhole = ({ requestQueue }: ProviderQueues, items: QueueItem[]): Promise<string>[] => {
    const first = items[0]!
    const chars = items.reduce((n, item) => n + item.text.length, 0)
    const all = requestQueue.enqueue(
      signal => translateItems(items, items.map(item => item.id), signal),
      first.scheduleAt,
      items.map(item => item.dedupKey ?? item.uid).join('|'),
      first.scope ? [first.scope] : undefined,
      { timeoutMs: timeoutFor(chars) },
    )
    return items.map((_, i) => all.then(texts => texts[i]!))
  }

  const translate = async ({ request, providerId, cache, accept, scope }: TranslateCall): Promise<TranslateMessageResponse> => {
    try {
      const provider = await deps.getProvider(providerId)
      const model = (await deps.getModel?.()) ?? ''
      const store = cache && deps.cache ? deps.cache : null

      // 1. 查缓存：一次算完所有键，一次批量读
      const keys = new Map<string, string>()
      const translated = new Map<string, string>()
      if (store && cache) {
        const computed = await Promise.all(request.segments.map(segment =>
          cacheKeyFor({ providerId: provider.id, model, promptKey: provider.promptKey ?? '', context: provider.promptKey ? request.context : undefined, target: request.target, renderPath: cache.renderPath, text: segment.text }),
        ))
        request.segments.forEach((segment, i) => {
          keys.set(segment.id, computed[i]!)
        })
        // 重发只写不读：坏译文已经在库里，读回来只会再坏一次
        if (!cache.bypass) {
          const hits = await store.getMany(computed)
          request.segments.forEach((segment, i) => {
            const hit = hits[i]
            if (hit !== null && hit !== undefined) translated.set(segment.id, hit)
          })
        }
      }
      // 读缓存时让出过主线程，这期间 scope 可能已被撤销（Read Frog translation-queues.ts 也在 await 之后查一次）
      if (scope && cancelledScopes.has(scope)) return { ok: false, error: { kind: 'aborted', message: `已取消（scope: ${scope}）` } }
      const cached = translated.size

      // 2. 未命中的逐段入队；同一次调用的段落批次键相同，会攒在一起
      const misses = request.segments.filter(s => !translated.has(s.id))
      if (misses.length > 0) {
        const pair = queuesFor(provider)
        const now = Date.now()
        const batchKey = JSON.stringify([provider.id, model, provider.promptKey ?? '', request.target, cache?.renderPath ?? '', request.context ?? null])
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
        const batchQueue = pair.batchQueue
        const settled = await Promise.allSettled(batchQueue ? items.map(item => batchQueue.enqueue(item)) : enqueueWhole(pair, items))

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
          translated.set(item.id, outcome.value)
          const key = keys.get(item.id)
          if (store && cache && key && (!accept || accept(item.id, outcome.value))) writes.push({ key, translation: outcome.value, paper: cache.paper })
        })
        if (store && writes.length > 0) await store.putMany(writes)
        if (failures.length > 0) return { ok: false, error: toErrorInfo(pickError(failures)) }
      }

      // 4. 按原顺序合并
      const segments = request.segments.map(s => ({ id: s.id, text: translated.get(s.id) ?? '' }))
      return { ok: true, result: { segments, provider: provider.id, model: model || undefined }, cached }
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) }
    }
  }

  const cancel = (scope: string): number => {
    // 先登记再排空：登记是同步的，还挂在读缓存上的调用醒来就能看到；
    // 先撤批处理再撤请求队列，反过来攒着的批次会在两次排空之间刷出新任务（Read Frog translation-queues.ts:616）
    cancelledScopes.markScope(scope)
    let cancelled = 0
    for (const { requestQueue, batchQueue } of queues.values()) {
      cancelled += batchQueue?.cancelByScope(scope) ?? 0
      cancelled += requestQueue.cancelByScope(scope)
    }
    return cancelled
  }

  return { translate, cancel }
}

/** 一次调用里多段失败时报哪个：配置错误优先（run.ts 据此停下），其次真正的失败，最后才是取消 */
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
