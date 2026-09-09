// Thinking (reasoning) mode. Follows KISS THINKING_API_REGISTRY: choose an adapter by endpoint, disabled by default.
// Translation needs no reasoning trace; enabling it can make each batch an order of magnitude slower. AI SDK providerOptions writes these fields directly into the request body.
export type ThinkingMode = 'enabled' | 'disabled'

type Adapter = (mode: ThinkingMode) => Record<string, unknown>

// OpenRouter: reasoning.effort = "none" when disabled, reasoning.enabled when enabled (same as KISS applyOpenRouterThinking).
const openRouter: Adapter = mode => (mode === 'enabled' ? { reasoning: { enabled: true } } : { reasoning: { effort: 'none' } })
// Official DeepSeek endpoint: thinking.type.
const deepSeek: Adapter = mode => ({ thinking: { type: mode } })
// Alibaba Cloud Bailian, SiliconFlow, etc.: enable_thinking boolean.
const booleanFlag: Adapter = mode => ({ enable_thinking: mode === 'enabled' })

const ADAPTERS: Record<string, Adapter> = {
  'openrouter.ai': openRouter,
  'api.deepseek.com': deepSeek,
  'dashscope.aliyuncs.com': booleanFlag,
  'api.siliconflow.cn': booleanFlag,
}

/** Registered endpoint domains, shown in settings. */
export const THINKING_HOSTS: readonly string[] = Object.keys(ADAPTERS)

/** Send no extra fields to unregistered endpoints (OpenAI, Ollama, local) to avoid unknown-parameter rejection. */
export function thinkingBodyFields(baseURL: string, mode: ThinkingMode): Record<string, unknown> {
  let host: string
  try {
    host = new URL(baseURL).hostname
  } catch {
    return {}
  }
  return ADAPTERS[host]?.(mode) ?? {}
}
