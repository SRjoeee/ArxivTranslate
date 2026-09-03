// AI SDK 模型工厂。v1 只有 openai-compatible 一条线（OpenRouter / DeepSeek / Ollama 共用）；
// Read Frog 的 providers/model.ts 覆盖 20 家，拆改比自写 20 行费事，未移植。
import { createOpenAICompatible } from '@ai-sdk/openai-compatible'
import type { LanguageModel } from 'ai'
import type { ThinkingMode } from './thinking'

export interface OpenAICompatConfig {
  baseURL: string
  apiKey: string
  model: string
  /** 默认 disabled，见 thinking.ts */
  thinking?: ThinkingMode
}

export function createModel(config: OpenAICompatConfig): LanguageModel {
  // supportsStructuredOutputs：把 zod schema 以 response_format: json_schema 发给端点（OpenRouter 上 DeepSeek / Gemini / GPT 系列均支持）；
  // 不支持的模型靠 prompt 里写死的输出形状兜底
  const provider = createOpenAICompatible({ name: 'openai-compat', baseURL: config.baseURL, apiKey: config.apiKey, supportsStructuredOutputs: true })
  return provider(config.model)
}
