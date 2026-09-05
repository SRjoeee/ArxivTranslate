// 配置存储：WXT 自带的带版本迁移的存储项 + 读写时 zod 校验（做法借鉴 Read Frog config/storage.ts）。
import { storage } from 'wxt/utils/storage'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import { fromBcp47 } from './languages'
import { CONFIG_VERSION, DEFAULT_CONFIG, configSchema, normalizeGlossary, type Config } from './schema'

export const configItem = storage.defineItem<Config>('local:config', {
  fallback: DEFAULT_CONFIG,
  version: CONFIG_VERSION,
  migrations: {
    // v1 -> v2：加提示词库；已存的 API key 与其他字段原样保留
    2: (v1: Omit<Config, 'version' | 'prompts' | 'preload'>) => ({ ...v1, version: 2 as const, prompts: DEFAULT_PROMPTS_CONFIG }),
    // v2 -> v3：加按视口翻译的范围（§10）
    3: (v2: Omit<Config, 'version' | 'preload' | 'targetLanguage'> & { version: 2; targetLanguage: string }) => ({ ...v2, version: 3 as const, preload: { ...DEFAULT_PRELOAD } }),
    // v3 -> v4：目标语言从 BCP-47 换成 ISO 639-3（zh-CN → cmn、zh-TW → cmn-Hant、ja → jpn）
    4: (v3: Omit<Config, 'version' | 'targetLanguage' | 'fallback'> & { version: 3; targetLanguage: string }) => ({ ...v3, version: 4 as const, targetLanguage: fromBcp47(v3.targetLanguage) }),
    // v4 -> v5：加引擎降级链，默认开启（硬规则 4：失败必须可恢复，不能让扩展整体挂掉）
    5: (v4: Omit<Config, 'version' | 'fallback' | 'glossary'> & { version: 4 }) => ({ ...v4, version: 5 as const, fallback: { enabled: true } }),
    // v5 -> v6：加术语表，默认空表（空表不进 prompt 也不进缓存键，行为与之前一致）
    6: (v5: Omit<Config, 'version' | 'glossary' | 'style'> & { version: 5 }) => ({ ...v5, version: 6 as const, glossary: [] }),
    // v6 -> v7：加译文样式（默认 none，与实现之前的外观一致），并把旧术语表规整到 v7 新加的限额内——
    // 不规整的话一条超长术语就会让整份配置校验失败、回退默认值（Codex 在 #52 指出）
    7: (v6: Omit<Config, 'version' | 'style'> & { version: 6 }) => ({
      ...v6,
      version: 7 as const,
      glossary: normalizeGlossary(v6.glossary),
      style: { preset: 'none' as const, customCss: '' },
    }),
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
