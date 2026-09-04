import type { Config } from '@/config/schema'
import { createGoogleWebProvider } from './google-web'
import { createOpenAICompatProvider } from './openai-compat'
import type { TranslationProvider } from './types'

/** 按配置取 provider。chrome-builtin 还没接（DESIGN §8.1） */
export function getProvider(config: Config): TranslationProvider {
  switch (config.provider) {
    case 'openai-compat':
      return createOpenAICompatProvider(config.openaiCompat)
    case 'google-web':
      return createGoogleWebProvider()
  }
}

export { PROMPT_VERSION } from './prompt'
export * from './types'
