// background 侧的翻译入口：只服务设置页的连接测试与不便直连的调用方；
// 页面翻译的请求跑在 content（DESIGN §8.0），两边共用 src/providers/translate-service.ts。
import { cachePortOf, type TranslationCache } from '@/cache'
import type { QueueOptions } from '@/providers/request/request-queue'
import { createTranslateService } from '@/providers/translate-service'
import type { TranslationProvider } from '@/providers/types'

export type { TranslateMessageRequest, TranslateMessageResponse } from '@/providers/translate-service'

export interface ProviderStatus {
  providerId: string
  /** 配置里选的那个引擎能不能用 */
  available: boolean
  /**
   * 首选不可用时，降级链上第一个能用的引擎（§8.5）。有它就能翻——
   * popup 的「翻译」按钮据此判断，否则会出现「链上有 Google 兜底、按钮却是灰的」（Codex 在 #50 指出）
   */
  fallback?: { id: string; displayName: string }
  model?: string
  /** content 侧规划批次与选择渲染路径要用（§2 第 3 条） */
  maxBatchChars: number
  maxBatchItems: number
  preservesMarkup: boolean
}

export interface TranslateHandlerDeps {
  getProvider: (providerId?: string) => Promise<TranslationProvider>
  getModel?: () => Promise<string | undefined>
  cache?: TranslationCache
  /** 队列参数覆盖（测试用） */
  queue?: Partial<QueueOptions>
}

/** 消息处理函数：只暴露 translate；background 没有可取消的 scope */
export function createTranslateHandler(deps: TranslateHandlerDeps) {
  return createTranslateService({ ...deps, cache: deps.cache ? cachePortOf(deps.cache) : undefined }).translate
}

export function createStatusHandler(deps: {
  getProvider: () => Promise<TranslationProvider>
  getModel: () => Promise<string | undefined>
  /** 降级链（§8.5）；不给就只看首选引擎 */
  getChain?: () => Promise<TranslationProvider[]>
}) {
  return async (): Promise<ProviderStatus> => {
    const provider = await deps.getProvider()
    const available = await provider.isAvailable()
    // 首选不可用时看看链上还有没有能用的：有就照样能翻，只是走降级引擎
    let fallback: ProviderStatus['fallback']
    if (!available && deps.getChain) {
      for (const step of (await deps.getChain()).filter(s => s.id !== provider.id)) {
        if (await step.isAvailable()) {
          fallback = { id: step.id, displayName: step.displayName }
          break
        }
      }
    }
    return {
      providerId: provider.id,
      available,
      ...(fallback ? { fallback } : {}),
      model: await deps.getModel(),
      maxBatchChars: provider.maxBatchChars,
      maxBatchItems: provider.maxBatchItems,
      preservesMarkup: provider.preservesMarkup,
    }
  }
}
