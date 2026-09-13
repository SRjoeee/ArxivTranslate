import type { RenderPath } from '@/cache/key'
import type { Config } from '@/config/schema'
import { serviceOf } from '@/config/services'
import { createChromeBuiltinProvider } from './chrome-builtin'
import { createGoogleWebProvider } from './google-web'
import { createMicrosoftProvider } from './microsoft'
import { createOpenAICompatProvider } from './openai-compat'
import type { TranslationProvider } from './types'

/** The chosen service: one of the reader's (an OpenAI-compatible engine carrying the service's id) or a built-in */
export function getProvider(config: Config): TranslationProvider {
  const service = serviceOf(config, config.provider)
  if (service) return createOpenAICompatProvider(service, { prompts: config.prompts })
  switch (config.provider) {
    case 'google-web':
      return createGoogleWebProvider()
    case 'chrome-builtin':
      return createChromeBuiltinProvider(config.targetLanguage)
    default:
      // The shipped default; also where a deleted service's id lands
      return createMicrosoftProvider(config.targetLanguage)
  }
}

/**
 * The free engines of the fallback chain, by priority (DESIGN §8.5). None needs a key or costs anything.
 * The built-in engine first: offline, 10–20 ms a sentence, under no rate limit at all; with the language pack not downloaded isAvailable() is false and it is skipped of itself
 */
const FREE_ENGINES: readonly ((config: Config) => TranslationProvider)[] = [
  config => createChromeBuiltinProvider(config.targetLanguage),
  () => createGoogleWebProvider(),
]
// `microsoft` is **deliberately not in this table** (#98): it keeps markers only, and on the chain it would shrink
// the intersection to {markers} for the most common combination, “Google chosen + the built-in without a pack”,
// losing inline styling for a whole session for a fallback never used. The other way round, with Microsoft chosen
// Google still joins as the fallback, since Google keeps both formats. Only the symptom is avoided here: the
// negotiation itself is order-dependent, and before #103 opens the chain to customisation the rule has to become “the first choice decides the format”

/**
 * Assemble the fallback chain and settle the wire format: the configured engine first, then the free engines it does
 * not duplicate (DESIGN §8.5).
 *
 * Two filters:
 * - a step whose `isAvailable()` is false is dropped (an LLM without a key, a built-in engine that cannot be
 *   probed), so no link of the chain is bound to fail; the first engine is **kept** when unavailable — the popup has
 *   to say “no API key configured” by it rather than quietly switching to a free engine
 * - **the first-choice engine decides the format**: the first of its preference order, and a candidate that cannot
 *   keep it stays off the chain. `run.ts` takes the capabilities once at the start, and one session has one format
 *   (changing halfway would render earlier and later blocks in two shapes).
 *
 * This rule is **order-independent**, which is why it replaced the old one. The old rule shrank the intersection with
 * the iteration order, so **a fallback engine could change the first choice's render format**: Google chosen
 * (tags|markers) with the built-in lacking its pack, a markers-only fallback would drag the whole session to markers,
 * paired placeholders flattened, inline styling gone from the whole page — for a reader who only wanted a fallback.
 * #103 is to open the chain's order to customisation, and that rule would turn “adjust the fallback priority” into
 * “silently change the render format”. Today both rules produce the same chains (a markers engine could never rescue a
 * tags session), so this trades order-dependent for order-independent, no behaviour change.
 *
 * - Google chosen (`['tags','markers']`) → `tags` locked → the built-in (`['tags']`) joins, markers-only ones stay out
 * - Microsoft chosen (`['markers']`) → `markers` locked → Google keeps both and joins as the fallback
 * - a first choice with `wireFormats: []` (not one placeholder kept) → the whole session takes `runs`. runs sends
 *   plain-text runs and needs no common format, so the format gate steps aside entirely, or the first choice failing would leave no fallback (Codex on #107)
 */
export async function buildChain(
  config: Config,
  /** Test injection. Only synthetic engines reach the combinations not wired yet (a markers-only engine, one with empty `wireFormats`) */
  deps: { primary?: TranslationProvider; freeEngines?: readonly ((config: Config) => TranslationProvider)[] } = {},
): Promise<{ chain: TranslationProvider[]; renderPath: RenderPath }> {
  const freeEngines = deps.freeEngines ?? FREE_ENGINES
  const primary = deps.primary ?? getProvider(config)
  const chain = [primary]
  const format = primary.wireFormats[0]
  if (config.fallback.enabled) {
    for (const create of freeEngines) {
      const candidate = create(config)
      if (candidate.id === primary.id) continue
      if (format !== undefined && !candidate.wireFormats.includes(format)) {
        console.warn(`[axt] ${candidate.displayName} does not support this session's wire format ${format}; not joining the fallback chain`)
        continue
      }
      if (!(await candidate.isAvailable())) continue
      chain.push(candidate)
    }
  }
  if (format === undefined) return { chain, renderPath: 'runs' }
  // Returned directly, no conversion: `RenderPath = WireFormat | 'runs'` accepts any wire format already. Keeping
  // `format === 'markers' ? … : 'tags'` would **silently rewrite** a third WireFormat added later into tags, and a
  // provider supporting only the new format would get batches serialised as tags and wreck the placeholders (Codex on #116)
  return { chain, renderPath: format }
}

export { PROMPT_VERSION } from './prompt'
export * from './prompt-library'
export * from './types'
