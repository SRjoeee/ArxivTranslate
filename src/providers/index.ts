import type { Config } from '@/config/schema'
import { createOpenAICompatProvider } from './openai-compat'
import type { TranslationProvider } from './types'

/** 按配置取 provider。v1 只有 openai-compat；chrome-builtin / google-gtx 在 Phase 3 接入 */
export function getProvider(config: Config): TranslationProvider {
  switch (config.provider) {
    case 'openai-compat':
      return createOpenAICompatProvider(config.openaiCompat)
  }
}

export { PROMPT_VERSION } from './prompt'
export * from './types'
