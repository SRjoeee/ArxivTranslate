// 配置形状（DESIGN §9）。改形状就升 version 并在 storage.ts 的 migrations 里写迁移。
import { z } from 'zod'

export const CONFIG_VERSION = 1

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
}
