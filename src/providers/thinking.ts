// Ported from reference/kiss-translator/src/apis/trans.js@c95bd46 (GPL-3.0), 2026-09-03, modified: the
// THINKING_API_REGISTRY shape and its per-endpoint adapters, reduced to the endpoints we support. Default off —
// translation needs no reasoning trace, and leaving it on makes every batch an order of magnitude slower. The fields
// go into the request body through the AI SDK's providerOptions.
export type ThinkingMode = 'enabled' | 'disabled'

type Adapter = (mode: ThinkingMode) => Record<string, unknown>

// OpenRouter：关闭发 reasoning.effort = "none"，开启发 reasoning.enabled（与 KISS applyOpenRouterThinking 一致）
const openRouter: Adapter = mode => (mode === 'enabled' ? { reasoning: { enabled: true } } : { reasoning: { effort: 'none' } })
// DeepSeek 官方：thinking.type
const deepSeek: Adapter = mode => ({ thinking: { type: mode } })
// 阿里云百炼、硅基流动等：enable_thinking 布尔
const booleanFlag: Adapter = mode => ({ enable_thinking: mode === 'enabled' })

const ADAPTERS: Record<string, Adapter> = {
  'openrouter.ai': openRouter,
  'api.deepseek.com': deepSeek,
  'dashscope.aliyuncs.com': booleanFlag,
  'api.siliconflow.cn': booleanFlag,
}

/** 登记过的端点域名，设置页提示用 */
export const THINKING_HOSTS: readonly string[] = Object.keys(ADAPTERS)

/** 未登记的端点（OpenAI、Ollama、本地）不发任何字段，避免未知参数被拒绝 */
export function thinkingBodyFields(baseURL: string, mode: ThinkingMode): Record<string, unknown> {
  let host: string
  try {
    host = new URL(baseURL).hostname
  } catch {
    return {}
  }
  return ADAPTERS[host]?.(mode) ?? {}
}
