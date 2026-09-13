// Configuration storage: WXT's storage item with versioned migrations + zod validation on read and write (after Read Frog's config/storage.ts).
import { storage } from 'wxt/utils/storage'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { fromBcp47 } from './languages'
import { type Appearance, BUILT_IN_HIGHLIGHTS, BUILT_IN_STYLES, DEFAULT_APPEARANCE, type StyleProfile, newProfileId } from './appearance'
import { CONFIG_VERSION, DEFAULT_CONFIG, MODE_VALUES, configSchema, normalizeGlossary, type Config } from './schema'
import { defaultServiceName, newServiceId } from './services'

export const configItem = storage.defineItem<Config>('local:config', {
  fallback: DEFAULT_CONFIG,
  version: CONFIG_VERSION,
  migrations: {
    // v1 -> v2: the prompt library added; the stored API key and the other fields kept as they were
    2: (v1: Omit<Config, 'version' | 'prompts' | 'preload'>) => ({ ...v1, version: 2 as const, prompts: DEFAULT_PROMPTS_CONFIG }),
    // v2 -> v3: the viewport translation range added (§10)
    3: (v2: Omit<Config, 'version' | 'preload' | 'targetLanguage'> & { version: 2; targetLanguage: string }) => ({ ...v2, version: 3 as const, preload: { ...DEFAULT_PRELOAD } }),
    // v3 -> v4: the target language from BCP-47 to ISO 639-3 (zh-CN → cmn, zh-TW → cmn-Hant, ja → jpn)
    4: (v3: Omit<Config, 'version' | 'targetLanguage' | 'fallback'> & { version: 3; targetLanguage: string }) => ({ ...v3, version: 4 as const, targetLanguage: fromBcp47(v3.targetLanguage) }),
    // v4 -> v5: the engine fallback chain added, on by default (hard rule 4: a failure must be recoverable and never take the extension down)
    5: (v4: Omit<Config, 'version' | 'fallback' | 'glossary'> & { version: 4 }) => ({ ...v4, version: 5 as const, fallback: { enabled: true } }),
    // v5 -> v6: the glossary added, empty by default (an empty glossary enters neither the prompt nor the cache key, so the behaviour is as before)
    6: (v5: Omit<Config, 'version' | 'glossary' | 'style'> & { version: 5 }) => ({ ...v5, version: 6 as const, glossary: [] }),
    // v6 -> v7: the translation style added (default none, the appearance as before the feature), and the old glossary
    // tidied into the limits v7 added — untidied, one over-long term would fail the whole configuration's validation and fall back to the defaults (Codex on #52)
    7: (v6: Omit<Config, 'version' | 'style' | 'image'> & { version: 6 }) => ({
      ...v6,
      version: 7 as const,
      glossary: normalizeGlossary(v6.glossary),
      style: { preset: 'none' as const, customCss: '' },
    }),
    // v7 -> v8: the image translation's mode gate added (§15), all three modes on by default — without the helper it does nothing, with it it works at once
    8: (v7: Omit<Config, 'version' | 'image'> & { version: 7 }) => ({ ...v7, version: 8 as const, image: { modes: [...MODE_VALUES] } }),
    // v8 -> v9: three tunable parameters on the translation style (§7.5). The defaults must leave the appearance pixel for
    // pixel as before: an empty colour = follow the original, opacity 1 = opaque, an empty accent = each preset's own default
    // The shape is the one v9 stored, spelled out here: `Config` has moved on (v12 dropped `style`)
    // and a migration must keep describing the version it came from
    9: (v8: Omit<Config, 'version' | 'services' | 'appearance'> & { version: 8; style: { preset: string; customCss: string } }) =>
      ({ ...v8, version: 9 as const, style: { ...v8.style, color: '', opacity: 1, accent: '' } }),
    // v9 -> v10: the `provider` enum gains 'microsoft'. **Not one field changed; the bump is for downgrades** — unbumped,
    // a reader who stored microsoft and reinstalled an older build keeps version 9, the `version > CONFIG_VERSION` guard
    // below does not fire, zod fails on the enum, and the whole configuration is **silently reset to the defaults**, every
    // setting lost; at 10 the older build reports plainly “the stored configuration is v10, this extension supports up to v9” (Codex on #115)
    10: (v9: Omit<Config, 'version'> & { version: 9 }) => ({ ...v9, version: 10 as const }),
    // v10 -> v11: the image switch the popup shows (`image.enabled`). Derived from what the reader
    // had: any mode ticked means it was on, an empty list means it was off
    11: (v10: Omit<Config, 'version' | 'image'> & { version: 10; image: { modes: Config['image']['modes'] } }) =>
      ({ ...v10, version: 11 as const, image: { enabled: v10.image.modes.length > 0, modes: v10.image.modes } }),
    // v11 -> v12: user-added services replace the single endpoint; appearance profiles replace the
    // preset. Total: every v11 value maps somewhere (spec §5), so nothing falls back to defaults
    12: (v11: Omit<Config, 'version' | 'services' | 'appearance'> & { version: 11; openaiCompat: V11Endpoint; style: V11Style }) => {
      const { openaiCompat, style, ...rest } = v11
      const edited = openaiCompat.apiKey !== '' || openaiCompat.baseURL !== 'https://openrouter.ai/api/v1' || openaiCompat.model !== 'deepseek/deepseek-v4-flash'
      const wasLlm = v11.provider === 'openai-compat'
      const services = wasLlm || edited
        ? [{ id: newServiceId(), kind: 'openai-compat' as const, name: defaultServiceName(openaiCompat.model), baseURL: openaiCompat.baseURL, apiKey: openaiCompat.apiKey, model: openaiCompat.model, thinking: openaiCompat.thinking ?? 'disabled' }]
        : []
      const provider = wasLlm ? services[0]!.id : v11.provider
      return { ...rest, version: 12 as const, provider, services, appearance: migrateStyle(style) }
    },
    // v13: the interface's own language. `auto` is what every existing reader had in effect
    13: (v12: Omit<Config, 'version' | 'uiLanguage'> & { version: 12 }) => ({ ...v12, version: 13 as const, uiLanguage: 'auto' }),
  },
})

interface V11Endpoint { baseURL: string; apiKey: string; model: string; thinking?: 'enabled' | 'disabled' }
interface V11Style { preset: string; customCss: string; color: string; opacity: number; accent: string }

/**
 * v11 `style` → the profile lists (spec §5). An underline preset becomes a copy of “Same as the original” with
 * that underline; `custom` keeps its declarations; the removed effects keep their colour on the
 * follow-original profile; an accent colour becomes the reader's own band profile
 */
function migrateStyle(style: V11Style): Appearance {
  const a: Appearance = { ...DEFAULT_APPEARANCE, styles: [...BUILT_IN_STYLES], highlights: [...BUILT_IN_HIGHLIGHTS] }
  const underline: Record<string, { underline: StyleProfile['underline']; thickness: 1 | 2 }> = {
    underline: { underline: 'solid', thickness: 1 }, dotted: { underline: 'dotted', thickness: 1 }, dashed: { underline: 'dashed', thickness: 1 },
    'dashed-bold': { underline: 'dashed', thickness: 2 }, wavy: { underline: 'wavy', thickness: 1 }, 'wavy-bold': { underline: 'wavy', thickness: 2 },
  }
  const vars = { color: style.color, opacity: style.opacity }
  const own = (name: string, over: Partial<StyleProfile>): string => {
    const id = newProfileId('style')
    a.styles = [...a.styles, { ...BUILT_IN_STYLES[0]!, ...vars, ...over, id, name }]
    return id
  }
  const kept = underline[style.preset]
  if (kept) a.activeStyle = own('下划线', kept)
  else if (style.preset === 'custom') a.activeStyle = own('自定义', { css: style.customCss })
  else if (style.preset === 'blur' || style.preset === 'green' || style.preset === 'muted') {
    a.activeStyle = style.preset
    a.styles = a.styles.map(s => (s.id === style.preset ? { ...s, ...(style.color ? { color: style.color } : {}), opacity: style.opacity } : s))
  } else {
    a.activeStyle = 'follow'
    a.styles = a.styles.map(s => (s.id === 'follow' ? { ...s, ...vars } : s))
  }
  if (style.accent) {
    const id = newProfileId('hl')
    a.highlights = [...a.highlights, { id, name: '自定义', color: style.accent, opacity: 0.22 }]
    a.activeHighlight = id
  }
  return a
}

/**
 * Why the latest `getConfig()` fell back; `null` when the configuration is fine.
 * Each execution context (popup / content / background) keeps the result of its own call — they share no memory,
 * and the popup calls `getConfig()` itself anyway, so reading this variable gives exactly its own conclusion
 */
let fallbackReason: FallbackReason | null = null

/**
 * For the UI: did the configuration fall back to the defaults. On a fallback the reader's API key, engine and mode
 * are all out of effect, and the reader must see it. **The material for the explanation, not a sentence**: the sentence is written in the interface language, and this layer knows no locale pack (Codex on #161)
 */
export function configFallbackReason(): FallbackReason | null {
  return fallbackReason
}

/** `tooNew`: the stored version is newer than this extension; `invalid`: the structure fails the schema, `where` being the failing field */
export type FallbackReason =
  | { kind: 'tooNew'; stored: number; supported: number }
  | { kind: 'invalid'; where: string; message: string }
  | { kind: 'unknown' }

/**
 * Say why it fell back. Two known causes:
 * (1) the stored version is newer than this extension — an older build installed, and WXT refuses a downgrade migration (measured: a v7 configuration + a v6 extension);
 * (2) the structure fails the schema — edited by hand and broken, or a field over its limit
 */
function describeFallback(stored: unknown, issues: readonly { path: PropertyKey[]; message: string }[]): FallbackReason {
  const version = (stored as { version?: unknown } | null)?.version
  if (typeof version === 'number' && version > CONFIG_VERSION) {
    return { kind: 'tooNew', stored: version, supported: CONFIG_VERSION }
  }
  const issue = issues[0]
  if (!issue) return { kind: 'unknown' }
  return { kind: 'invalid', where: issue.path.map(String).join('.'), message: issue.message }
}

/**
 * A stored value failing the schema (a failed upgrade, a hand edit gone wrong) falls back to the defaults rather than
 * taking the extension down. **The fallback cannot be silent**: the reader's key is stored yet out of effect, the
 * translation quietly degrades to a free engine, and with no clue in the interface nobody would find out (met 2026-09-06: a v7 configuration + a v6 build)
 */
export async function getConfig(): Promise<Config> {
  const stored = await configItem.getValue()
  const parsed = configSchema.safeParse(stored)
  if (parsed.success) {
    fallbackReason = null
    return parsed.data
  }
  fallbackReason = describeFallback(stored, parsed.error.issues)
  console.warn(`[axt] invalid configuration, defaults in use: ${fallbackReason}`)
  return DEFAULT_CONFIG
}

export async function setConfig(config: Config): Promise<void> {
  await configItem.setValue(configSchema.parse(config))
}

export function watchConfig(callback: (config: Config) => void) {
  return configItem.watch(value => {
    const parsed = configSchema.safeParse(value)
    if (parsed.success) callback(parsed.data)
  })
}
