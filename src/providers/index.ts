import type { RenderPath } from '@/cache/key'
import type { Config } from '@/config/schema'
import { createChromeBuiltinProvider } from './chrome-builtin'
import { createGoogleWebProvider } from './google-web'
import { createOpenAICompatProvider } from './openai-compat'
import type { TranslationProvider } from './types'

/** 按配置取 provider */
export function getProvider(config: Config): TranslationProvider {
  switch (config.provider) {
    case 'openai-compat':
      return createOpenAICompatProvider(config.openaiCompat, { prompts: config.prompts })
    case 'google-web':
      return createGoogleWebProvider()
    case 'chrome-builtin':
      return createChromeBuiltinProvider(config.targetLanguage)
  }
}

/**
 * 降级链上的免费引擎，按优先级排列（DESIGN §8.5）。都不需要 key、不花钱。
 * 内置引擎在前：离线、单句 10–20 ms，而且不受任何限流；语言包没下载时 isAvailable() 为假，自动被跳过
 */
const FREE_ENGINES: readonly ((config: Config) => TranslationProvider)[] = [
  config => createChromeBuiltinProvider(config.targetLanguage),
  () => createGoogleWebProvider(),
]

/**
 * 组装降级链并确定线上格式：配置里选的引擎在前，其后接不与它重复的免费引擎（DESIGN §8.5）。
 *
 * 两道过滤：
 * - `isAvailable()` 为假的步骤剔除（没配 key 的 LLM、探测不到的内置引擎），免得链里躺着必然失败的一环；
 *   首个引擎不可用时**保留**它——popup 要据此提示"未配置 API key"，而不是悄悄换成免费引擎
 * - **格式由首选引擎决定**：取它偏好序里的第一个，候选支持不了这个格式就不进链。
 *   `run.ts` 只在开始时取一次 capabilities，一次会话只能有一种格式（中途换会让先后渲染的块两套形状）。
 *
 * 这条规则是**顺序无关**的，这是它替换掉旧规则的理由。旧规则让交集随迭代顺序收缩，于是
 * **一个兜底引擎能改变首选引擎的渲染格式**：选了 Google（tags|markers）、内置又没装语言包时，
 * 一个 markers-only 的兜底会把整条会话拖到 markers，成对占位符被拍平、整页内联样式消失——
 * 而用户只是想有个兜底。#103 要开放链的顺序自定义，那条规则会让「调一下兜底优先级」变成
 * 「静默改变渲染格式」。今天两条规则产出的链完全相同（markers 引擎本来就救不了 tags 会话），
 * 所以这是把顺序相关换成顺序无关，不是行为变更。
 *
 * - 选 Google（`['tags','markers']`）→ 锁定 `tags` → 内置（`['tags']`）进链，markers-only 的挡在外面
 * - 选微软（`['markers']`）→ 锁定 `markers` → Google 两种都保得住，进链兜底
 * - 首选 `wireFormats: []`（一个占位符都保不住）→ 整条会话走 `runs`。runs 发的是纯文本段，
 *   不需要共同格式，所以这时格式闸整个让开，否则首选一挂就没得降级（Codex 在 #107 指出）
 */
export async function buildChain(
  config: Config,
  /** 测试注入。用合成引擎才测得到还没接入的组合（markers-only 的引擎、`wireFormats` 为空的引擎） */
  deps: { primary?: TranslationProvider; freeEngines?: readonly ((config: Config) => TranslationProvider)[] } = {},
): Promise<{ chain: TranslationProvider[]; renderPath: RenderPath }> {
  const freeEngines = deps.freeEngines ?? FREE_ENGINES
  const primary = deps.primary ?? getProvider(config)
  const chain = [primary]
  const format = primary.wireFormats[0]
  if (config.fallback.enabled) {
    for (const create of freeEngines) {
      const candidate = create(config)
      if (candidate.id === primary.id) continue
      if (format !== undefined && !candidate.wireFormats.includes(format)) {
        console.warn(`[axt] ${candidate.displayName} 不支持本次会话的线上格式 ${format}，不加入降级链`)
        continue
      }
      if (!(await candidate.isAvailable())) continue
      chain.push(candidate)
    }
  }
  if (format === undefined) return { chain, renderPath: 'runs' }
  return { chain, renderPath: format === 'markers' ? 'markers' : 'tags' }
}

export { PROMPT_VERSION } from './prompt'
export * from './prompt-library'
export * from './types'
