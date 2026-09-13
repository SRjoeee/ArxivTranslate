// The AI SDK model factory. v1 has the one openai-compatible line (OpenRouter / DeepSeek / Ollama shared); Read Frog's
// providers/model.ts covers 20 vendors, and adapting it was more work than writing 20 lines, so it was not ported.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ThinkingMode } from './thinking'

export interface OpenAICompatConfig {
  /** The reader's service id (svc-…); absent in tests and for the legacy single endpoint */
  id?: string
  /** What the reader named the service; the engine's display name */
  name?: string
  baseURL: string
  apiKey: string
  model: string
  /** disabled by default, see thinking.ts */
  thinking?: ThinkingMode
}

export function createModel(config: OpenAICompatConfig): LanguageModel {
  // supportsStructuredOutputs: the zod schema goes to the endpoint as response_format: json_schema (DeepSeek / Gemini /
  // GPT models on OpenRouter all support it); a model that does not falls back to the output shape spelled out in the prompt
  const provider = createOpenAICompatible({ name: 'openai-compat', baseURL: config.baseURL, apiKey: config.apiKey, supportsStructuredOutputs: true })
  return provider(config.model)
}
