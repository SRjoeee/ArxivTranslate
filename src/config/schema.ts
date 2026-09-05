// 配置形状（DESIGN §9）。改形状就升 version 并在 storage.ts 的 migrations 里写迁移。
import { z } from 'zod'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { STYLE_PRESETS } from '@/core/renderer/style-preset'
import { DEFAULT_LANG_CODE, langCodeSchema } from './languages'

export const CONFIG_VERSION = 7

export const configSchema = z.object({
  version: z.literal(CONFIG_VERSION),
  provider: z.enum(['openai-compat', 'google-web']),
  openaiCompat: z.object({
    baseURL: z.url(),
    /** 只存本地，永不进日志、缓存键或 fixture */
    apiKey: z.string(),
    model: z.string().min(1),
    // 用 default 让旧版本存储（没有这个字段）仍能通过校验
    thinking: z.enum(['enabled', 'disabled']).default('disabled'),
  }),
  /** ISO 639-3（v4 起；languages.ts），LLM 填英文名、Google 转 BCP-47 */
  targetLanguage: langCodeSchema,
  mode: z.enum(['stack', 'side', 'only']),
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
    term: z.string().min(1).max(120),
    translation: z.string().min(1).max(200),
  })).max(200).refine(
    entries => entries.reduce((n, e) => n + e.term.length + e.translation.length, 0) <= 6000,
    { message: '术语表总长超过 6000 字，会显著增加每一批的 token' },
  ).default([]),
  /** 译文样式（§7.5）：预设只做叠加装饰，custom 只填声明块、选择器由扩展补 */
  style: z.object({
    preset: z.enum(STYLE_PRESETS),
    customCss: z.string().max(2000),
  }).default({ preset: 'none', customCss: '' }),
  /** 引擎降级链（§8.5）：首选引擎失败时自动切到免费引擎，别让整页翻译停死 */
  fallback: z.object({ enabled: z.boolean() }).default({ enabled: true }),
  /** 按视口翻译的范围（§10，Read Frog 的 preload）：视口下方多少像素算临近（0–10000）、露出多少比例算进入（0–1） */
  preload: z.object({
    margin: z.number().min(0).max(10_000),
    threshold: z.number().min(0).max(1),
  }).default({ ...DEFAULT_PRELOAD }),
})

export type Config = z.infer<typeof configSchema>

export const DEFAULT_CONFIG: Config = {
  version: CONFIG_VERSION,
  provider: 'openai-compat',
  openaiCompat: {
    baseURL: 'https://openrouter.ai/api/v1',
    apiKey: '',
    // 便宜快速档；设置页可改
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
}
