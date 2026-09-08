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
 * 组装降级链并协商线上格式：配置里选的引擎在前，其后接不与它重复的免费引擎（DESIGN §8.5）。
 *
 * 两道过滤：
 * - `isAvailable()` 为假的步骤剔除（没配 key 的 LLM、探测不到的内置引擎），免得链里躺着必然失败的一环；
 *   首个引擎不可用时**保留**它——popup 要据此提示"未配置 API key"，而不是悄悄换成免费引擎
 * - **线上格式取交集**：`run.ts` 只在开始时取一次 capabilities，中途换格式会让先后渲染的块两套形状，
 *   所以一次会话只能有一种格式。候选与当前交集无公共格式的剔除。
 *
 * 交集会随着加入的引擎收缩，所以结果**依赖 FREE_ENGINES 的顺序**——那本来就是一份偏好排序。
 * 最终格式取首选引擎偏好序里第一个仍在交集中的：
 * - 选 Google（tags|markers）→ 接上内置（tags）→ 交集 {tags} → 走 tags，内联样式保得住
 * - 选微软（markers）→ 内置（tags）无交集被剔除，Google（tags|markers）留下 → 交集 {markers}
 */
export async function buildChain(
  config: Config,
  /** 测试注入。协商结果依赖顺序与能力，用合成引擎才测得到还没接入的组合（markers-only 的微软、wireFormats 为空的引擎） */
  deps: { primary?: TranslationProvider; freeEngines?: readonly ((config: Config) => TranslationProvider)[] } = {},
): Promise<{ chain: TranslationProvider[]; renderPath: RenderPath }> {
  const freeEngines = deps.freeEngines ?? FREE_ENGINES
  const primary = deps.primary ?? getProvider(config)
  const chain = [primary]
  // 首选一个格式都保不住 → 整条会话走 runs。runs 发的是纯文本段，**不需要共同格式**，
  // 所以这时格式护栏必须整个让开，否则每个候选都会被空交集挡掉、首选一挂就没得降级（Codex 在 #107 指出）
  const runsOnly = primary.wireFormats.length === 0
  let common = [...primary.wireFormats]
  if (config.fallback.enabled) {
    for (const create of freeEngines) {
      const candidate = create(config)
      if (candidate.id === primary.id) continue
      const next = runsOnly ? [] : common.filter(f => candidate.wireFormats.includes(f))
      if (!runsOnly && next.length === 0) {
        console.warn(`[axt] ${candidate.displayName} 与当前链没有共同的线上格式，不加入降级链`)
        continue
      }
      if (!(await candidate.isAvailable())) continue
      chain.push(candidate)
      if (!runsOnly) common = next
    }
  }
  if (runsOnly) return { chain, renderPath: 'runs' }
  const format = primary.wireFormats.find(f => common.includes(f))!
  return { chain, renderPath: format === 'markers' ? 'markers' : 'markup' }
}

export { PROMPT_VERSION } from './prompt'
export * from './prompt-library'
export * from './types'
