// 翻译服务：查缓存 → 只把未命中的段落交给 provider → 回写缓存。
// 与运行上下文无关：缓存通过 CachePort 注入，background 用本地 Dexie，content 用消息代理（DESIGN §8.0）。
import PQueue from 'p-queue'
import { cacheKeyFor, type RenderPath } from '@/cache/key'
import { withRetry, type RetryOptions } from './retry'
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
  cache?: { paper: string; renderPath: RenderPath }
}

export type TranslateMessageResponse =
  | { ok: true; result: TranslateResult; cached: number }
  | { ok: false; error: { kind: ProviderErrorKind; message: string } }

export interface TranslateServiceDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  getModel?: () => Promise<string | undefined>
  cache?: CachePort
  retry?: RetryOptions
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
          cacheKeyFor({ providerId: provider.id, model, target: request.target, renderPath: cache.renderPath, text: segment.text }),
        ))
        request.segments.forEach((segment, i) => keys.set(segment.id, computed[i]!))
        const hits = await store.getMany(computed)
        request.segments.forEach((segment, i) => {
          const hit = hits[i]
          if (hit !== null && hit !== undefined) translated.set(segment.id, hit)
        })
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
