import type { Config } from '@/config/schema'
import { createChromeBuiltinProvider } from './chrome-builtin'
import { createGoogleWebProvider } from './google-web'
import { createOpenAICompatProvider } from './openai-compat'
import type { TranslationProvider } from './types'

/** 按配置取 provider */
export function getProvider(config: Config): TranslationProvider {
  switch (config.provider) {
    case 'openai-compat':
      return createOpenAICompatProvider(config.openaiCompat, { prompts: config.prompts })
    case 'google-web':
      return createGoogleWebProvider()
    case 'chrome-builtin':
      return createChromeBuiltinProvider(config.targetLanguage)
  }
}

/**
 * 降级链上的免费引擎，按优先级排列（DESIGN §8.5）。都不需要 key、不花钱。
 * 内置引擎在前：离线、单句 10–20 ms，而且不受任何限流；语言包没下载时 isAvailable() 为假，自动被跳过
 */
const FREE_ENGINES: readonly ((config: Config) => TranslationProvider)[] = [
  config => createChromeBuiltinProvider(config.targetLanguage),
  () => createGoogleWebProvider(),
]

/**
 * 组装降级链：配置里选的引擎在前，其后接不与它重复的免费引擎（DESIGN §8.5）。
 *
 * 两道过滤：
 * - `isAvailable()` 为假的步骤剔除（没配 key 的 LLM、探测不到的内置引擎），免得链里躺着必然失败的一环；
 *   首个引擎不可用时**保留**它——popup 要据此提示"未配置 API key"，而不是悄悄换成免费引擎
 * - `preservesMarkup` 与首个引擎不一致的剔除：它决定渲染路径，而 run.ts 只在开始时取一次 capabilities，
 *   中途换路径会让已经渲染的块与后来的块两套形状。v1 三个 provider 都是 true，这条是给将来的护栏
 */
export async function buildChain(config: Config): Promise<TranslationProvider[]> {
  const primary = getProvider(config)
  if (!config.fallback.enabled) return [primary]
  const chain = [primary]
  for (const create of FREE_ENGINES) {
    const candidate = create(config)
    if (candidate.id === primary.id) continue
    if (candidate.preservesMarkup !== primary.preservesMarkup) {
      console.warn(`[axt] ${candidate.displayName} 的 preservesMarkup 与首选引擎不同，不加入降级链`)
      continue
    }
    if (!(await candidate.isAvailable())) continue
    chain.push(candidate)
  }
  return chain
}

export { PROMPT_VERSION } from './prompt'
export * from './prompt-library'
export * from './types'
