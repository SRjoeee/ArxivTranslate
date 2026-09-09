// Configuration schema (DESIGN §9). Bump version and add storage.ts migrations whenever the shape changes.
import { z } from 'zod'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { STYLE_PRESETS } from '@/core/renderer/style-preset'
import { DEFAULT_LANG_CODE, langCodeSchema } from './languages'

export const CONFIG_VERSION = 8

/** Three reading modes (DESIGN §7); shared by `mode` and the image translation mode gate. */
export const MODE_VALUES = ['stack', 'side', 'only'] as const
const modeSchema = z.enum(MODE_VALUES)

/** Glossary limits shared by migrations and the schema: one change updates both. */
export const GLOSSARY_LIMITS = { term: 120, translation: 200, entries: 200, totalChars: 6000 } as const

const glossaryChars = (entries: readonly { term: string; translation: string }[]) =>
  entries.reduce((n, e) => n + e.term.length + e.translation.length, 0)

/**
 * Normalize an untrusted glossary: discard invalid entries and truncate anything over the limits.
 * Migrations must do this because older versions had no limits. Copying a long term unchanged makes
 * `getConfig()` reject the entire config and fall back to defaults, losing the active API key, engine and prompts (Codex #52).
 */
export function normalizeGlossary(value: unknown): { term: string; translation: string }[] {
  if (!Array.isArray(value)) return []
  const kept: { term: string; translation: string }[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) continue
    const { term, translation } = raw as { term?: unknown; translation?: unknown }
    if (typeof term !== 'string' || typeof translation !== 'string') continue
    if (term.length === 0 || term.length > GLOSSARY_LIMITS.term) continue
    if (translation.length === 0 || translation.length > GLOSSARY_LIMITS.translation) continue
    if (kept.length >= GLOSSARY_LIMITS.entries) break
    if (glossaryChars([...kept, { term, translation }]) > GLOSSARY_LIMITS.totalChars) break
    kept.push({ term, translation })
  }
  return kept
}

export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  provider: z.enum(['openai-compat', 'google-web', 'chrome-builtin']),
  openaiCompat: z.object({
    baseURL: z.url(),
    /** Local storage only; never include in logs, cache keys or fixtures. */
    apiKey: z.string(),
    model: z.string().min(1),
    // Defaults let older stored configs without this field pass validation.
    thinking: z.enum(['enabled', 'disabled']).default('disabled'),
  }),
  /** ISO 639-3 (since v4; languages.ts): LLMs receive the English name; Google receives BCP-47. */
  targetLanguage: langCodeSchema,
  mode: modeSchema,
  /** Prompt library (ported from Read Frog): selected id and custom prompts. */
  prompts: z.object({
    promptId: z.string().min(1),
    patterns: z.array(z.object({ id: z.string().min(1), name: z.string(), systemPrompt: z.string(), prompt: z.string() })),
  }).default(DEFAULT_PROMPTS_CONFIG),
  /**
   * Glossary (§8.2): included in every batch prompt for consistent terminology within a paper. LLM-only; free engines ignore context.
   * Limit: 200 entries, about 2–3 KB / 700 tokens, comparable to the abstract. Per-paragraph matching for larger lists is deferred to v2.
   */
  glossary: z.array(z.object({
    // Limit each entry too: a count limit alone accepts an entire document pasted as one entry,
    // then includes it in every batch prompt and every segment cache key (Codex #52).
    term: z.string().min(1).max(GLOSSARY_LIMITS.term),
    translation: z.string().min(1).max(GLOSSARY_LIMITS.translation),
  })).max(GLOSSARY_LIMITS.entries).refine(
    entries => glossaryChars(entries) <= GLOSSARY_LIMITS.totalChars,
    { message: `Glossary exceeds ${GLOSSARY_LIMITS.totalChars} characters and would significantly increase tokens per batch` },
  ).default([]),
  /** Translation style (§7.5): presets add decoration only; custom contains declarations, with selectors supplied by the extension. */
  style: z.object({
    preset: z.enum(STYLE_PRESETS),
    customCss: z.string().max(2000),
  }).default({ preset: 'none', customCss: '' }),
  /** Engine fallback chain (§8.5): automatically switch to free engines if the preferred engine fails, keeping page translation usable. */
  fallback: z.object({ enabled: z.boolean() }).default({ enabled: true }),
  /** Viewport translation range (§10, Read Frog preload): pixels below the viewport considered nearby (0–10000), and visible fraction (0–1). */
  preload: z.object({
    margin: z.number().min(0).max(10_000),
    threshold: z.number().min(0).max(1),
  }).default({ ...DEFAULT_PRELOAD }),
  /**
   * Image translation (§15, since v8): modes that display translation overlays on bitmaps. All three by default; an empty array disables it.
   * Display gate only: switching to a disabled mode hides overlays without new requests. If no helper is detected, settings are disabled and the path is skipped.
   */
  image: z.object({ modes: z.array(modeSchema).max(3) }).default({ modes: [...MODE_VALUES] }),
})

export type Config = z.infer<typeof configSchema>

export const DEFAULT_CONFIG: Config = {
  version: CONFIG_VERSION,
  provider: 'openai-compat',
  openaiCompat: {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: '',
    // Fast, inexpensive default; editable in settings.
    model: 'deepseek/deepseek-v4-flash',
    thinking: 'disabled',
  },
  targetLanguage: DEFAULT_LANG_CODE,
  mode: 'stack',
  glossary: [],
  style: { preset: 'none', customCss: '' },
  fallback: { enabled: true },
  prompts: DEFAULT_PROMPTS_CONFIG,
  preload: { ...DEFAULT_PRELOAD },
  image: { modes: [...MODE_VALUES] },
}
