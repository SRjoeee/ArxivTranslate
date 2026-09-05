// 翻译服务：查缓存 → 只把未命中的段落交给 provider → 回写缓存。
// 与运行上下文无关：缓存通过 CachePort 注入，background 用本地 Dexie，content 用消息代理（DESIGN §8.0）。
import PQueue from 'p-queue'
import { cacheKeyFor, type RenderPath } from '@/cache/key'
import { withRetry, type RetryOptions } from './retry'
import { attachRequestErrorMeta } from './retry-policy'
import { ProviderError, type ProviderErrorKind, type TranslateRequest, type TranslateResult, type TranslationProvider } from './types'

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

export type TranslateMessageResponse =
  | { ok: true; result: TranslateResult; cached: number }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }

export interface TranslateServiceDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  getModel?: () => Promise<string | undefined>
  cache?: CachePort
  retry?: RetryOptions
  /** 单次请求的上限；默认 60s。LLM 翻一批含几十个占位符的段落可能要十几秒，但不会到一分钟 */
  requestTimeoutMs?: number
}

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000

/**
 * 给一次请求加上限。没有上限时一个挂住的连接会让整篇翻译永远停在"进行中"
 *（实测 2312.17527：153 块翻了 152 块，最后一块等了 220s 还没回，`translation done` 永远不打）。
 * 用 race 而不是只传 signal：provider 不配合 signal 时也能被切断；超时按可重试的 timeout 处理，
 * 重试用尽才把这一块标成失败，其余块不受影响。
 */
async function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const timeout = AbortSignal.timeout(ms)
  const cutoff = new Promise<never>((_, reject) => {
    timeout.addEventListener('abort', () => {
      reject(attachRequestErrorMeta(new ProviderError('timeout', `请求超过 ${ms}ms 没有返回`), { kind: 'timeout', isRetryable: true }))
    }, { once: true })
  })
  try {
    return await Promise.race([run(timeout), cutoff])
  } catch (error) {
    // provider 配合 signal 时抛的是 aborted；只要是我们的超时触发的，就按 timeout 算
    if (timeout.aborted && error instanceof ProviderError && error.kind === 'aborted') {
      throw attachRequestErrorMeta(new ProviderError('timeout', `请求超过 ${ms}ms 没有返回`, { cause: error }), { kind: 'timeout', isRetryable: true })
    }
    throw error
  }
}

export function createTranslateService(deps: TranslateServiceDeps) {
  const queues = new Map<string, PQueue>()
  const queueFor = (provider: TranslationProvider) => {
    let queue = queues.get(provider.id)
    if (!queue) {
      queue = new PQueue({ concurrency: provider.concurrency })
      queues.set(provider.id, queue)
    }
    return queue
  }

  /**
   * 429 时暂停整条队列：concurrency 只是并发上限，撞上限流的那个任务自己睡着时，
   * 其余 worker 还会继续往同一个端点打（Codex 在 #6 / #10 指出）。
   * 队列到时自动恢复；多次暂停取最晚的那个截止时间。
   * 已在飞的任务不受 queue.pause() 约束，所以它们**每次尝试前**也要过 awaitPause 这道闸：
   * 自己睡醒了但别的任务把暂停延长了，就接着等（Codex 在 #30 指出）
   */
  const pausedUntil = new Map<string, number>()
  const pauses = new Map<string, Promise<void>>()
  const sleepFn = () => deps.retry?.sleep ?? ((wait: number) => new Promise<void>(resolve => setTimeout(resolve, wait)))
  const pauseQueue = (provider: TranslationProvider, ms: number) => {
    const queue = queueFor(provider)
    const until = Date.now() + ms
    if ((pausedUntil.get(provider.id) ?? 0) >= until) return
    pausedUntil.set(provider.id, until)
    queue.pause()
    const done = sleepFn()(ms).then(() => {
      // 被更长的暂停取代：由那一次负责恢复
      if (pausedUntil.get(provider.id) !== until) return
      pausedUntil.delete(provider.id)
      pauses.delete(provider.id)
      queue.start()
    })
    pauses.set(provider.id, done)
  }
  const awaitPause = async (provider: TranslationProvider) => {
    let pending: Promise<void> | undefined
    while ((pending = pauses.get(provider.id))) await pending
  }

  return async ({ request, providerId, cache }: TranslateMessageRequest): Promise<TranslateMessageResponse> => {
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
        request.segments.forEach((segment, i) => keys.set(segment.id, computed[i]!))
        // 重发只写不读：坏译文已经在库里，读回来只会再坏一次
        if (!cache.bypass) {
          const hits = await store.getMany(computed)
          request.segments.forEach((segment, i) => {
            const hit = hits[i]
            if (hit !== null && hit !== undefined) translated.set(segment.id, hit)
          })
        }
      }
      const cached = translated.size

      // 2. 只翻译未命中的
      const misses = request.segments.filter(s => !translated.has(s.id))
      let resultProvider = provider.id
      let resultModel: string | undefined = model || undefined
      if (misses.length > 0) {
        const timeoutMs = deps.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS
        const retry: RetryOptions = {
          ...deps.retry,
          onPause: ms => {
            deps.retry?.onPause?.(ms)
            pauseQueue(provider, ms)
          },
        }
        const attempt = async () => {
          await awaitPause(provider)
          return withTimeout(signal => provider.translate({ ...request, segments: misses, signal }), timeoutMs)
        }
        const result = (await queueFor(provider).add(() => withRetry(attempt, retry))) as TranslateResult
        resultProvider = result.provider
        resultModel = result.model
        const writes: CacheEntry[] = []
        for (const segment of result.segments) {
          translated.set(segment.id, segment.text)
          const key = keys.get(segment.id)
          if (store && cache && key) writes.push({ key, translation: segment.text, paper: cache.paper })
        }
        if (store && writes.length > 0) await store.putMany(writes)
      }

      // 3. 按原顺序合并
      const segments = request.segments.map(s => ({ id: s.id, text: translated.get(s.id) ?? '' }))
      return { ok: true, result: { segments, provider: resultProvider, model: resultModel }, cached }
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) }
    }
  }
}

export function toErrorInfo(e: unknown): { kind: ProviderErrorKind; message: string } {
  if (e instanceof ProviderError) return { kind: e.kind, message: e.message }
  return { kind: 'unknown', message: e instanceof Error ? e.message : String(e) }
}
