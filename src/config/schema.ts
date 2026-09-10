// 配置形状（DESIGN §9）。改形状就升 version 并在 storage.ts 的 migrations 里写迁移。
import { z } from 'zod'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { DEFAULT_APPEARANCE, appearanceSchema } from './appearance'
import { BUILT_IN_SERVICES, SERVICE_ID_RE, serviceSchema } from './services'
import { DEFAULT_LANG_CODE, langCodeSchema } from './languages'

export const CONFIG_VERSION = 13

/** 三种阅读模式（DESIGN §7）；`mode` 与图片翻译的模式闸共用 */
export const MODE_VALUES = ['stack', 'side', 'only'] as const
const modeSchema = z.enum(MODE_VALUES)

/** 术语表的限额。迁移与 schema 共用，改一处两边同时生效 */
export const GLOSSARY_LIMITS = { term: 120, translation: 200, entries: 200, totalChars: 6000 } as const

const glossaryChars = (entries: readonly { term: string; translation: string }[]) =>
  entries.reduce((n, e) => n + e.term.length + e.translation.length, 0)

/**
 * 把来历不明的术语表规整成合法值：非法条目丢掉，超额部分截断。
 * 迁移时必须过一遍——旧版本没有这些限额，直接抄过来的话 `getConfig()` 会因为一条超长术语
 * 判定整份配置不合法而回退默认值，用户看到的是 API key、引擎、提示词全没了（Codex 在 #52 指出）
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
  provider: z.string().refine(v => (BUILT_IN_SERVICES as readonly string[]).includes(v) || SERVICE_ID_RE.test(v), '不是有效的翻译服务'),
  /** The reader's own services (v12); keys stay local (CLAUDE.md rule 7) */
  services: z.array(serviceSchema).max(20).default([]),
  /** ISO 639-3（v4 起；languages.ts），LLM 填英文名、Google 转 BCP-47 */
  targetLanguage: langCodeSchema,
  mode: modeSchema,
  /** 提示词库（移植自 Read Frog）：当前选用的 id + 用户自定义 */
  prompts: z.object({
    promptId: z.string().min(1),
    patterns: z.array(z.object({ id: z.string().min(1), name: z.string(), systemPrompt: z.string(), prompt: z.string() })),
  }).default(DEFAULT_PROMPTS_CONFIG),
  /**
   * 术语表（§8.2）：每批 prompt 都带上，让同一篇里的术语译法统一。只对 LLM 有效，免费引擎不看上下文。
   * 上限 200 条——200 条约 2–3 KB、约 700 token，与摘要同量级；再多就该按段落命中过滤，那是 v2 的事
   */
  glossary: z.array(z.object({
    // 单条也要限长：只限条数的话，一整篇文档被当成一条粘进来照样收下，
    // 然后进每一批 prompt 与每个分段的缓存键（Codex 在 #52 指出）
    term: z.string().min(1).max(GLOSSARY_LIMITS.term),
    translation: z.string().min(1).max(GLOSSARY_LIMITS.translation),
  })).max(GLOSSARY_LIMITS.entries).refine(
    entries => glossaryChars(entries) <= GLOSSARY_LIMITS.totalChars,
    { message: `术语表总长超过 ${GLOSSARY_LIMITS.totalChars} 字，会显著增加每一批的 token` },
  ).default([]),
  /** Appearance profiles (§7.5, v12): the reader's style list and band list, and which of each is active */
  appearance: appearanceSchema.default(DEFAULT_APPEARANCE),
  /** 引擎降级链（§8.5）：首选引擎失败时自动切到免费引擎，别让整页翻译停死 */
  fallback: z.object({ enabled: z.boolean() }).default({ enabled: true }),
  /** 按视口翻译的范围（§10，Read Frog 的 preload）：视口下方多少像素算临近（0–10000）、露出多少比例算进入（0–1） */
  preload: z.object({
    margin: z.number().min(0).max(10_000),
    threshold: z.number().min(0).max(1),
  }).default({ ...DEFAULT_PRELOAD }),
  /**
   * 阅读辅助（§7.7，v10 起）：悬停时把原文与译文里对应的那一句一起用底色标出来（issue #105）。
   * 默认开——它只在引擎报了句边界、且两边都能重建时才有东西可显示，其余情形本就无声无息、无代价。
   * 带 default，所以没有这个字段的既有存储照常通过校验，不用升 CONFIG_VERSION
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
  mode: 'stack',
  glossary: [],
  appearance: DEFAULT_APPEARANCE,
  fallback: { enabled: true },
  prompts: DEFAULT_PROMPTS_CONFIG,
  preload: { ...DEFAULT_PRELOAD },
  reading: { sentenceHighlight: true },
  image: { enabled: true, modes: [...MODE_VALUES] },
  uiLanguage: 'auto',
}
