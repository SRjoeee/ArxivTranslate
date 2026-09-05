// 配置形状（DESIGN §9）。改形状就升 version 并在 storage.ts 的 migrations 里写迁移。
import { z } from 'zod'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'

export const CONFIG_VERSION = 3

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
  targetLanguage: z.string().min(2),
  mode: z.enum(['stack', 'side', 'only']),
  /** 提示词库（移植自 Read Frog）：当前选用的 id + 用户自定义 */
  prompts: z.object({
    promptId: z.string().min(1),
    patterns: z.array(z.object({ id: z.string().min(1), name: z.string(), systemPrompt: z.string(), prompt: z.string() })),
  }).default(DEFAULT_PROMPTS_CONFIG),
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
  targetLanguage: 'zh-CN',
  mode: 'stack',
  prompts: DEFAULT_PROMPTS_CONFIG,
  preload: { ...DEFAULT_PRELOAD },
}
