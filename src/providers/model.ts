// AI SDK model factory. v1 uses only openai-compatible (shared by OpenRouter / DeepSeek / Ollama).
// Read Frog providers/model.ts covers 20 providers; adapting it would be more work than these 20 lines, so it was not ported.
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ThinkingMode } from './thinking'

export interface OpenAICompatConfig {
  baseURL: string
  apiKey: string
  model: string
  /** Disabled by default; see thinking.ts. */
  thinking?: ThinkingMode
}

export function createModel(config: OpenAICompatConfig): LanguageModel {
  // supportsStructuredOutputs sends the zod schema as response_format: json_schema (supported by DeepSeek / Gemini / GPT on OpenRouter).
  // The explicit output shape in the prompt provides a fallback for unsupported models.
  const provider = createOpenAICompatible({ name: 'openai-compat', baseURL: config.baseURL, apiKey: config.apiKey, supportsStructuredOutputs: true })
  return provider(config.model)
}
