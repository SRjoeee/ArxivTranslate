import { describe, expect, it } from 'vitest'
import { thinkingBodyFields } from '@/providers/thinking'

describe('thinkingBodyFields (ported KISS thinking-switch registry)', () => {
  it('OpenRouter: disabled uses reasoning.effort none; enabled uses reasoning.enabled', () => {
    expect(thinkingBodyFields('https://openrouter.ai/api/v1', 'disabled')).toEqual({ reasoning: { effort: 'none' } })
    expect(thinkingBodyFields('https://openrouter.ai/api/v1', 'enabled')).toEqual({ reasoning: { enabled: true } })
  })

  it('official DeepSeek endpoint: thinking.type', () => {
    expect(thinkingBodyFields('https://api.deepseek.com/v1', 'disabled')).toEqual({ thinking: { type: 'disabled' } })
    expect(thinkingBodyFields('https://api.deepseek.com', 'enabled')).toEqual({ thinking: { type: 'enabled' } })
  })

  it('boolean switches such as Alibaba Cloud Model Studio and SiliconFlow: enable_thinking', () => {
    expect(thinkingBodyFields('https://dashscope.aliyuncs.com/compatible-mode/v1', 'disabled')).toEqual({ enable_thinking: false })
    expect(thinkingBodyFields('https://api.siliconflow.cn/v1', 'disabled')).toEqual({ enable_thinking: false })
  })

  it('unknown endpoints (OpenAI, Ollama, local) receive no fields to avoid rejection', () => {
    expect(thinkingBodyFields('https://api.openai.com/v1', 'disabled')).toEqual({})
    expect(thinkingBodyFields('http://localhost:11434/v1', 'disabled')).toEqual({})
    expect(thinkingBodyFields('not a url', 'disabled')).toEqual({})
  })
})
