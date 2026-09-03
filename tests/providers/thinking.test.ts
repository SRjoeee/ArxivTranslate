import { describe, expect, it } from 'vitest'
import { thinkingBodyFields } from '@/providers/thinking'

describe('thinkingBodyFields（照搬 KISS 的思考开关注册表）', () => {
  it('OpenRouter：关闭 → reasoning.effort none；开启 → reasoning.enabled', () => {
    expect(thinkingBodyFields('https://openrouter.ai/api/v1', 'disabled')).toEqual({ reasoning: { effort: 'none' } })
    expect(thinkingBodyFields('https://openrouter.ai/api/v1', 'enabled')).toEqual({ reasoning: { enabled: true } })
  })

  it('DeepSeek 官方：thinking.type', () => {
    expect(thinkingBodyFields('https://api.deepseek.com/v1', 'disabled')).toEqual({ thinking: { type: 'disabled' } })
    expect(thinkingBodyFields('https://api.deepseek.com', 'enabled')).toEqual({ thinking: { type: 'enabled' } })
  })

  it('阿里云百炼 / 硅基流动 等布尔开关：enable_thinking', () => {
    expect(thinkingBodyFields('https://dashscope.aliyuncs.com/compatible-mode/v1', 'disabled')).toEqual({ enable_thinking: false })
    expect(thinkingBodyFields('https://api.siliconflow.cn/v1', 'disabled')).toEqual({ enable_thinking: false })
  })

  it('未知端点（OpenAI、Ollama、本地）不发任何字段，避免被拒绝', () => {
    expect(thinkingBodyFields('https://api.openai.com/v1', 'disabled')).toEqual({})
    expect(thinkingBodyFields('http://localhost:11434/v1', 'disabled')).toEqual({})
    expect(thinkingBodyFields('not a url', 'disabled')).toEqual({})
  })
})
