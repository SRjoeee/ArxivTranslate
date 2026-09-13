// Ported from reference/kiss-translator/src/apis/trans.js@c95bd46 (GPL-3.0), 2026-09-03, modified: the
// THINKING_API_REGISTRY shape and its per-endpoint adapters, reduced to the endpoints we support. Default off —
// translation needs no reasoning trace, and leaving it on makes every batch an order of magnitude slower. The fields
// go into the request body through the AI SDK's providerOptions.
export type ThinkingMode = 'enabled' | 'disabled'

type Adapter = (mode: ThinkingMode) => Record<string, unknown>

// OpenRouter: off sends reasoning.effort = "none", on sends reasoning.enabled (as KISS's applyOpenRouterThinking)
const openRouter: Adapter = mode => (mode === 'enabled' ? { reasoning: { enabled: true } } : { reasoning: { effort: 'none' } })
// DeepSeek's own API: thinking.type
const deepSeek: Adapter = mode => ({ thinking: { type: mode } })
// Alibaba Cloud Bailian, SiliconFlow and the like: the enable_thinking boolean
const booleanFlag: Adapter = mode => ({ enable_thinking: mode === 'enabled' })

const ADAPTERS: Record<string, Adapter> = {
  'openrouter.ai': openRouter,
  'api.deepseek.com': deepSeek,
  'dashscope.aliyuncs.com': booleanFlag,
  'api.siliconflow.cn': booleanFlag,
}

/** The registered endpoint domains, for the settings page's hint */
export const THINKING_HOSTS: readonly string[] = Object.keys(ADAPTERS)

/** An unregistered endpoint (OpenAI, Ollama, local) gets no field at all, so an unknown parameter cannot be refused */
export function thinkingBodyFields(baseURL: string, mode: ThinkingMode): Record<string, unknown> {
  let host: string
  try {
    host = new URL(baseURL).hostname
  } catch {
    return {}
  }
  return ADAPTERS[host]?.(mode) ?? {}
}
