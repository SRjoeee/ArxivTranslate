// 配置存储：WXT 自带的带版本迁移的存储项 + 读写时 zod 校验（做法借鉴 Read Frog config/storage.ts）。
import { storage } from 'wxt/utils/storage'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { CONFIG_VERSION, DEFAULT_CONFIG, configSchema, type Config } from './schema'

export const configItem = storage.defineItem<Config>('local:config', {
  fallback: DEFAULT_CONFIG,
  version: CONFIG_VERSION,
  migrations: {
    // v1 -> v2：加提示词库；已存的 API key 与其他字段原样保留
    2: (v1: Omit<Config, 'version' | 'prompts'>) => ({ ...v1, version: 2 as const, prompts: DEFAULT_PROMPTS_CONFIG }),
  },
})

/** 读到的值不合 schema（升级失败、手工改坏）时回退默认，不让扩展挂掉 */
export async function getConfig(): Promise<Config> {
  const parsed = configSchema.safeParse(await configItem.getValue())
  if (parsed.success) return parsed.data
  console.warn('[axt] 配置不合法，已回退默认值')
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
