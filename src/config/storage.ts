// 配置存储：WXT 自带的带版本迁移的存储项 + 读写时 zod 校验（做法借鉴 Read Frog config/storage.ts）。
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
    7: (v6: Omit<Config, 'version' | 'style' | 'image'> & { version: 6 }) => ({
      ...v6,
      version: 7 as const,
      glossary: normalizeGlossary(v6.glossary),
      style: { preset: 'none' as const, customCss: '' },
    }),
    // v7 -> v8：加图片翻译的模式闸（§15），默认三种模式都开——helper 没装时它不起作用，装了就直接可用
    8: (v7: Omit<Config, 'version' | 'image'> & { version: 7 }) => ({ ...v7, version: 8 as const, image: { modes: [...MODE_VALUES] } }),
    // v8 -> v9：译文样式加三个可调参数（§7.5）。默认值必须让外观与实现之前逐像素相同——
    // 空颜色 = 跟随原文、opacity 1 = 不透明、空 accent = 用各预设自己的默认色
    // The shape is the one v9 stored, spelled out here: `Config` has moved on (v12 dropped `style`)
    // and a migration must keep describing the version it came from
    9: (v8: Omit<Config, 'version' | 'services' | 'appearance'> & { version: 8; style: { preset: string; customCss: string } }) =>
      ({ ...v8, version: 9 as const, style: { ...v8.style, color: '', opacity: 1, accent: '' } }),
    // v9 -> v10：`provider` 枚举加 'microsoft'。**字段一个没变，升版本号是为了降级**——
    // 不升的话，存了 microsoft 的用户装回旧版时版本仍是 9，下面那条 `version > CONFIG_VERSION`
    // 的守卫不触发，zod 在枚举上解析失败，整份配置**静默重置成默认值**、设置全丢；
    // 升到 10 之后旧版会明确报「存储里的配置是 v10，当前扩展只支持到 v9」（Codex 在 #115 指出）
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
  },
})

interface V11Endpoint { baseURL: string; apiKey: string; model: string; thinking?: 'enabled' | 'disabled' }
interface V11Style { preset: string; customCss: string; color: string; opacity: number; accent: string }

/**
 * v11 `style` → the profile lists (spec §5). An underline preset becomes a copy of 与原文相同 with
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
 * 最近一次 `getConfig()` 的回退原因，`null` 表示配置正常。
 * 每个执行上下文（popup / content / background）各存一份自己那次调用的结果——它们互不共享内存，
 * 而 popup 本来就自己调 `getConfig()`，读这个变量拿到的正是它自己那次的结论
 */
let fallbackReason: string | null = null

/** 供 UI 查询：配置是不是被回退成默认值了。回退时用户的 API key、引擎、模式全部不生效，必须让他看见 */
export function configFallbackReason(): string | null {
  return fallbackReason
}

/**
 * 说清楚为什么回退。两种已知成因：
 * (1) 存储里的版本比当前扩展新——装了更旧的构建，WXT 拒绝降级迁移（实测：v7 配置 + v6 扩展）；
 * (2) 结构不合 schema——手工改坏，或某个字段超出限额
 */
function describeFallback(stored: unknown, issues: readonly { path: PropertyKey[]; message: string }[]): string {
  const version = (stored as { version?: unknown } | null)?.version
  if (typeof version === 'number' && version > CONFIG_VERSION) {
    return `存储里的配置是 v${version}，当前扩展只支持到 v${CONFIG_VERSION}（可能装了更旧的版本）`
  }
  const issue = issues[0]
  if (!issue) return '未知原因'
  const where = issue.path.map(String).join('.')
  return where ? `${where}：${issue.message}` : issue.message
}

/**
 * 读到的值不合 schema（升级失败、手工改坏）时回退默认，不让扩展挂掉。
 * **回退不能是静默的**：用户的 key 明明存着却不生效、翻译悄悄降级到免费引擎，
 * 界面上没有任何线索时谁也发现不了（2026-09-06 实测撞到：v7 配置 + v6 构建）
 */
export async function getConfig(): Promise<Config> {
  const stored = await configItem.getValue()
  const parsed = configSchema.safeParse(stored)
  if (parsed.success) {
    fallbackReason = null
    return parsed.data
  }
  fallbackReason = describeFallback(stored, parsed.error.issues)
  console.warn(`[axt] 配置不合法，已回退默认值：${fallbackReason}`)
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
