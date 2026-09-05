// background 侧的翻译入口：只服务设置页的连接测试与不便直连的调用方；
// 页面翻译的请求跑在 content（DESIGN §8.0），两边共用 src/providers/translate-service.ts。
import { cachePortOf, type TranslationCache } from '@/cache'
import type { QueueOptions } from '@/providers/request/request-queue'
import { createTranslateService } from '@/providers/translate-service'
import type { TranslationProvider } from '@/providers/types'

export type { TranslateMessageRequest, TranslateMessageResponse } from '@/providers/translate-service'

export interface ProviderStatus {
  providerId: string
  available: boolean
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

export function createStatusHandler(deps: { getProvider: () => Promise<TranslationProvider>; getModel: () => Promise<string | undefined> }) {
  return async (): Promise<ProviderStatus> => {
    const provider = await deps.getProvider()
    return {
      providerId: provider.id,
      available: await provider.isAvailable(),
      model: await deps.getModel(),
      maxBatchChars: provider.maxBatchChars,
      maxBatchItems: provider.maxBatchItems,
      preservesMarkup: provider.preservesMarkup,
    }
  }
}
