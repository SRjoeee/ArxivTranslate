// background 的翻译处理：先查缓存，只把未命中的段落交给 provider；每个 provider 一个 p-queue，
// 按其 concurrency 限流；失败交给 withRetry + 移植的策略。
import PQueue from 'p-queue'
import { cacheKeyFor, type RenderPath, type TranslationCache } from '@/cache'
import { withRetry, type RetryOptions } from '@/providers/retry'
import { ProviderError, type ProviderErrorKind, type TranslateRequest, type TranslateResult, type TranslationProvider } from '@/providers/types'

export type TranslateMessageRequest = {
  request: Omit<TranslateRequest, 'signal'>
  providerId?: string
  /** 不带即不缓存（如设置页的连接测试） */
  cache?: { paper: string; renderPath: RenderPath }
}
export type TranslateMessageResponse =
  | { ok: true; result: TranslateResult; cached: number }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }
export interface ProviderStatus {
  providerId: string
  available: boolean
  model?: string
  /** content 侧规划批次与选择渲染路径要用（§2 第 3 条） */
  maxBatchChars: number
  maxBatchItems: number
  preservesMarkup: boolean
  /** 排查往返耗时用的墙钟：handler 收到与答复的时刻（毫秒） */
  receivedAt: number
  answeredAt: number
  /** handler 内部分步耗时（毫秒），排查冷启动时的几秒空转 */
  steps: { config: number; available: number; model: number }
}

export interface TranslateHandlerDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  getModel?: () => Promise<string | undefined>
  cache?: TranslationCache
  retry?: RetryOptions
}

export function createTranslateHandler(deps: TranslateHandlerDeps) {
  const queues = new Map<string, PQueue>()
  const queueFor = (provider: TranslationProvider) => {
    let queue = queues.get(provider.id)
    if (!queue) {
      queue = new PQueue({ concurrency: provider.concurrency })
      queues.set(provider.id, queue)
    }
    return queue
  }

  return async ({ request, providerId, cache }: TranslateMessageRequest): Promise<TranslateMessageResponse> => {
    try {
      const provider = await deps.getProvider(providerId)
      const model = (await deps.getModel?.()) ?? ''
      const store = cache && deps.cache ? deps.cache : null

      // 1. 查缓存
      const keys = new Map<string, string>()
      const translated = new Map<string, string>()
      if (store && cache) {
        for (const segment of request.segments) {
          const key = await cacheKeyFor({ providerId: provider.id, model, target: request.target, renderPath: cache.renderPath, text: segment.text })
          keys.set(segment.id, key)
          const hit = await store.get(key)
          if (hit !== null) translated.set(segment.id, hit)
        }
      }
      const cached = translated.size

      // 2. 只翻译未命中的
      const misses = request.segments.filter(s => !translated.has(s.id))
      let resultProvider = provider.id
      let resultModel: string | undefined = model || undefined
      if (misses.length > 0) {
        const result = (await queueFor(provider).add(() =>
          withRetry(() => provider.translate({ ...request, segments: misses }), deps.retry),
        )) as TranslateResult
        resultProvider = result.provider
        resultModel = result.model
        for (const segment of result.segments) {
          translated.set(segment.id, segment.text)
          const key = keys.get(segment.id)
          if (store && cache && key) await store.set(key, segment.text, cache.paper)
        }
      }

      // 3. 按原顺序合并
      const segments = request.segments.map(s => ({ id: s.id, text: translated.get(s.id) ?? '' }))
      return { ok: true, result: { segments, provider: resultProvider, model: resultModel }, cached }
    } catch (e) {
      return { ok: false, error: toErrorInfo(e) }
    }
  }
}

export function createStatusHandler(deps: { getProvider: () => Promise<TranslationProvider>; getModel: () => Promise<string | undefined> }) {
  return async (): Promise<ProviderStatus> => {
    const receivedAt = Date.now()
    // getProvider 内部要先读配置，是 background 冷启动后的第一次 storage 访问
    const provider = await deps.getProvider()
    const afterProvider = Date.now()
    const available = await provider.isAvailable()
    const afterAvailable = Date.now()
    const model = await deps.getModel()
    const afterModel = Date.now()
    return {
      providerId: provider.id,
      available,
      model,
      maxBatchChars: provider.maxBatchChars,
      maxBatchItems: provider.maxBatchItems,
      preservesMarkup: provider.preservesMarkup,
      receivedAt,
      answeredAt: afterModel,
      steps: { config: afterProvider - receivedAt, available: afterAvailable - afterProvider, model: afterModel - afterAvailable },
    }
  }
}

function toErrorInfo(e: unknown): { kind: ProviderErrorKind; message: string } {
  if (e instanceof ProviderError) return { kind: e.kind, message: e.message }
  return { kind: 'unknown', message: e instanceof Error ? e.message : String(e) }
}
