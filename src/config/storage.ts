// Configuration storage: WXT versioned storage with migrations and zod validation on reads/writes (based on Read Frog config/storage.ts).
import { storage } from 'wxt/utils/storage'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { fromBcp47 } from './languages'
import { CONFIG_VERSION, DEFAULT_CONFIG, MODE_VALUES, configSchema, normalizeGlossary, type Config } from './schema'

export const configItem = storage.defineItem<Config>('local:config', {
  fallback: DEFAULT_CONFIG,
  version: CONFIG_VERSION,
  migrations: {
    // v1 -> v2: add the prompt library; preserve stored API keys and all other fields.
    2: (v1: Omit<Config, 'version' | 'prompts' | 'preload'>) => ({ ...v1, version: 2 as const, prompts: DEFAULT_PROMPTS_CONFIG }),
    // v2 -> v3: add the viewport translation range (§10).
    3: (v2: Omit<Config, 'version' | 'preload' | 'targetLanguage'> & { version: 2; targetLanguage: string }) => ({ ...v2, version: 3 as const, preload: { ...DEFAULT_PRELOAD } }),
    // v3 -> v4: change target language from BCP-47 to ISO 639-3 (zh-CN → cmn, zh-TW → cmn-Hant, ja → jpn).
    4: (v3: Omit<Config, 'version' | 'targetLanguage' | 'fallback'> & { version: 3; targetLanguage: string }) => ({ ...v3, version: 4 as const, targetLanguage: fromBcp47(v3.targetLanguage) }),
    // v4 -> v5: add the engine fallback chain, enabled by default (hard rule 4: failures must be recoverable without disabling the extension).
    5: (v4: Omit<Config, 'version' | 'fallback' | 'glossary'> & { version: 4 }) => ({ ...v4, version: 5 as const, fallback: { enabled: true } }),
    // v5 -> v6: add an empty glossary by default (omitted from prompts and cache keys, preserving previous behavior).
    6: (v5: Omit<Config, 'version' | 'glossary' | 'style'> & { version: 5 }) => ({ ...v5, version: 6 as const, glossary: [] }),
    // v6 -> v7: add translation styles (default none, preserving the previous appearance) and normalize old glossaries to the new v7 limits.
    // Without normalization, a single long term invalidates the entire config and triggers defaults (Codex #52).
    7: (v6: Omit<Config, 'version' | 'style' | 'image'> & { version: 6 }) => ({
      ...v6,
      version: 7 as const,
      glossary: normalizeGlossary(v6.glossary),
      style: { preset: 'none' as const, customCss: '' },
    }),
    // v7 -> v8: add the image translation mode gate (§15), enabled in all modes by default; inactive without the helper, ready to use when installed.
    8: (v7: Omit<Config, 'version' | 'image'> & { version: 7 }) => ({ ...v7, version: 8 as const, image: { modes: [...MODE_VALUES] } }),
  },
})

/**
 * Reason for the latest `getConfig()` fallback; `null` means the config is valid.
 * Each execution context (popup / content / background) stores its own result because they do not share memory.
 * The popup already calls `getConfig()` itself, so this variable holds the result of its own read.
 */
let fallbackReason: string | null = null

/** Let the UI check whether defaults were used. A fallback disables the saved API key, engine and mode; the user must see this. */
export function configFallbackReason(): string | null {
  return fallbackReason
}

/**
 * Explain why defaults were used. Two known causes:
 * (1) Stored version is newer than the extension: WXT refuses downgrade migrations (observed with v7 config + v6 extension).
 * (2) Data fails schema validation: manual corruption or a field exceeding its limit.
 */
function describeFallback(stored: unknown, issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const version = (stored as { version?: unknown } | null)?.version
  if (typeof version === 'number' && version > CONFIG_VERSION) {
    return `Stored configuration is v${version}, but this extension supports up to v${CONFIG_VERSION} (an older version may be installed)`
  }
  const issue = issues[0]
  if (!issue) return 'Unknown reason'
  const where = issue.path.map(String).join('.')
  return where ? `${where}: ${issue.message}` : issue.message
}

/**
 * Fall back to defaults if stored data fails validation (failed upgrade or manual corruption), keeping the extension usable.
 * **Never fall back silently**: the saved key stops working and translation silently switches to a free engine.
 * Without a visible clue, users cannot diagnose it (observed 2026-09-06 with v7 config + v6 build).
 */
export async function getConfig(): Promise<Config> {
  const stored = await configItem.getValue()
  const parsed = configSchema.safeParse(stored)
  if (parsed.success) {
    fallbackReason = null
    return parsed.data
  }
  fallbackReason = describeFallback(stored, parsed.error.issues)
  console.warn(`[axt] Invalid configuration; using defaults: ${fallbackReason}`)
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
