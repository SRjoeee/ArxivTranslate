import type { Config } from '@/config/schema'
import { createChromeBuiltinProvider } from './chrome-builtin'
import { createGoogleWebProvider } from './google-web'
import { createOpenAICompatProvider } from './openai-compat'
import type { TranslationProvider } from './types'

/** Select a provider from configuration. */
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
 * Free fallback engines in priority order (DESIGN §8.5); no keys or fees.
 * Built-in comes first: offline, 10–20 ms per sentence and no rate limits. isAvailable() skips it until its language pack is downloaded.
 */
const FREE_ENGINES: readonly ((config: Config) => TranslationProvider)[] = [
  config => createChromeBuiltinProvider(config.targetLanguage),
  () => createGoogleWebProvider(),
]

/**
 * Assemble the chain: configured engine first, then non-duplicate free engines (DESIGN §8.5).
 *
 * Two filters:
 * - Drop unavailable steps (LLMs without keys or undetected built-in APIs), avoiding engines guaranteed to fail.
 *   **Keep** an unavailable first engine so the popup can explain the missing key instead of silently switching to a free engine.
 * - Drop engines with a different preservesMarkup capability: run.ts reads capabilities only once at startup to choose its rendering path.
 *   Switching paths mid-run would mix rendered shapes. All v1 providers use true; this guards future additions.
 */
export async function buildChain(config: Config): Promise<TranslationProvider[]> {
  const primary = getProvider(config)
  if (!config.fallback.enabled) return [primary]
  const chain = [primary]
  for (const create of FREE_ENGINES) {
    const candidate = create(config)
    if (candidate.id === primary.id) continue
    if (candidate.preservesMarkup !== primary.preservesMarkup) {
      console.warn(`[axt] ${candidate.displayName} has a different preservesMarkup capability from the preferred engine; excluded from fallback chain`)
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
