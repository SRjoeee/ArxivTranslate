// The configuration's shape (DESIGN §9). A change of shape bumps version and gets a migration in storage.ts.
import { z } from 'zod'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { DEFAULT_APPEARANCE, appearanceSchema } from './appearance'
import { BUILT_IN_SERVICES, SERVICE_ID_RE, serviceSchema } from './services'
import { DEFAULT_LANG_CODE, langCodeSchema } from './languages'

export const CONFIG_VERSION = 13

/** The three reading modes (DESIGN §7); `mode` is shared with the image translation's mode gate */
export const MODE_VALUES = ['stack', 'side', 'only'] as const
const modeSchema = z.enum(MODE_VALUES)

/** The glossary's limits. Shared by the migration and the schema, so one change applies to both */
export const GLOSSARY_LIMITS = { term: 120, translation: 200, entries: 200, totalChars: 6000 } as const

const glossaryChars = (entries: readonly { term: string; translation: string }[]) =>
  entries.reduce((n, e) => n + e.term.length + e.translation.length, 0)

/**
 * Tidy a glossary of unknown origin into a valid value: invalid entries dropped, the excess truncated.
 * A migration must run it: earlier versions had no such limits, and copied over as it was, `getConfig()` would judge the
 * whole configuration invalid over one over-long term and fall back to the defaults — the reader would see API key, engine and prompts all gone (Codex on #52)
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
  /** A built-in id or the id of one of `services` (spec §2, v12) */
  // The zod messages below reach the reader verbatim through the settings page's fallback notice (ui/strings.ts fallbackText),
  // so they are product copy in the interface's default language, not developer text; mapping them onto the locale pack is an open item
  provider: z.string().refine(v => (BUILT_IN_SERVICES as readonly string[]).includes(v) || SERVICE_ID_RE.test(v), '不是有效的翻译服务'),
  /** The reader's own services (v12); keys stay local (CLAUDE.md rule 7) */
  services: z.array(serviceSchema).max(20).default([]),
  /** ISO 639-3 (since v4; languages.ts); an LLM gets the English name, Google a BCP-47 conversion */
  targetLanguage: langCodeSchema,
  mode: modeSchema,
  /** The prompt library (ported from Read Frog): the id in use + the reader's own */
  prompts: z.object({
    promptId: z.string().min(1),
    patterns: z.array(z.object({ id: z.string().min(1), name: z.string(), systemPrompt: z.string(), prompt: z.string() })),
  }).default(DEFAULT_PROMPTS_CONFIG),
  /**
   * The glossary (§8.2): carried by every batch's prompt, so a term is translated the same way throughout a paper. LLMs
   * only; the free engines read no context. Capped at 200 entries — about 2–3 KB, about 700 tokens, of the abstract's order; beyond that, matching per passage is v2's business
   */
  glossary: z.array(z.object({
    // Each entry is capped in length too: capping the count alone, a whole document pasted in as one entry would be
    // accepted, then enter every batch's prompt and every segment's cache key (Codex on #52)
    term: z.string().min(1).max(GLOSSARY_LIMITS.term),
    translation: z.string().min(1).max(GLOSSARY_LIMITS.translation),
  })).max(GLOSSARY_LIMITS.entries).refine(
    entries => glossaryChars(entries) <= GLOSSARY_LIMITS.totalChars,
    { message: `术语表总长超过 ${GLOSSARY_LIMITS.totalChars} 字，会显著增加每一批的 token` },
  ).default([]),
  /** Appearance profiles (§7.5, v12): the reader's style list and band list, and which of each is active */
  appearance: appearanceSchema.default(DEFAULT_APPEARANCE),
  /** The engine fallback chain (§8.5): a failing first choice switches to the free engines of itself, so the whole page does not stop */
  fallback: z.object({ enabled: z.boolean() }).default({ enabled: true }),
  /** The viewport translation range (§10, Read Frog's preload): how many pixels below the viewport count as near (0–10000), how much must show to count as entered (0–1) */
  preload: z.object({
    margin: z.number().min(0).max(10_000),
    threshold: z.number().min(0).max(1),
  }).default({ ...DEFAULT_PRELOAD }),
  /**
   * Reading aid (§7.7, since v10): on hover the matching sentence in the original and in the translation is marked
   * with a band (issue #105). On by default — it shows anything only when the engine reported sentence boundaries and
   * both sides could be rebuilt, silent and free otherwise. With a default, so existing storage without the field passes validation and CONFIG_VERSION needs no bump
   */
  reading: z.object({ sentenceHighlight: z.boolean() }).default({ sentenceHighlight: true }),
  /**
   * Image translation (§15). `enabled` is the reader's switch (popup, v11); `modes` says in which
   * display modes the overlays show, a detail kept on the options page. Both are display gates:
   * switching to a mode that is off only hides the overlays, nothing is re-requested. Without the
   * helper the bitmap path does not run; SVG figures need no helper
   */
  image: z.object({ enabled: z.boolean(), modes: z.array(modeSchema).max(3) }).default({ enabled: true, modes: [...MODE_VALUES] }),
  /**
   * The **interface's** language (v13), not the paper's: a reader may translate into Japanese and
   * still want the buttons in Japanese, or in English, and neither choice implies the other.
   * `auto` follows the browser. An unknown code falls back at read time rather than failing the
   * whole configuration — a pack removed in a later version must not cost the reader their key
   */
  uiLanguage: z.string().default('auto'),
})

export type Config = z.infer<typeof configSchema>

export const DEFAULT_CONFIG: Config = {
  version: CONFIG_VERSION,
  // The free service that keeps formulas and links intact and needs no key (UI.md §2, 2026-09-10)
  provider: 'microsoft',
  services: [],
  targetLanguage: DEFAULT_LANG_CODE,
  // Side by side is how most readers stay on a wide screen (the owner, 2026-09-11); on a narrow window the page falls
  // back to stacked on its own (§7.2 / S-P-74), so this default reads fine on a small screen too
  mode: 'side',
  glossary: [],
  appearance: DEFAULT_APPEARANCE,
  fallback: { enabled: true },
  prompts: DEFAULT_PROMPTS_CONFIG,
  preload: { ...DEFAULT_PRELOAD },
  reading: { sentenceHighlight: true },
  image: { enabled: true, modes: [...MODE_VALUES] },
  uiLanguage: 'auto',
}
