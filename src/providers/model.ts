// AI SDK 模型工厂。v1 只有 openai-compatible 一条线（OpenRouter / DeepSeek / Ollama 共用）；
// Read Frog 的 providers/model.ts 覆盖 20 家，拆改比自写 20 行费事，未移植。
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'

export interface OpenAICompatConfig {
  baseURL: string
  apiKey: string
  model: string
}

export function createModel(config: OpenAICompatConfig): LanguageModel {
  const provider = createOpenAICompatible({ name: 'openai-compat', baseURL: config.baseURL, apiKey: config.apiKey })
  return provider(config.model)
}
