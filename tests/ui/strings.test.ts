import { describe, expect, it } from 'vitest'
import { S, parseFatal, reasonText, serviceName } from '@/ui/strings'

describe('reasonText', () => {
  it('has a reader-facing sentence for every kind, free of implementation words', () => {
    const kinds = ['no-key', 'network', 'rate-limit', 'auth', 'bad-request', 'invalid-response', 'timeout', 'aborted', 'unknown'] as const
    for (const kind of kinds) {
      const text = reasonText(kind)
      expect(text, kind).not.toMatch(/引擎|降级|块|会话|provider|fallback|helper/)
    }
    expect(reasonText('auth')).toBe('API Key 无效或已过期')
    expect(reasonText('aborted')).toBe('')
  })
})

describe('parseFatal', () => {
  it('splits the "kind: message" run.ts writes', () => {
    expect(parseFatal('auth: User not found.')).toEqual({ kind: 'auth', message: 'User not found.' })
  })
  it('treats an unrecognised prefix as unknown', () => {
    expect(parseFatal('something odd')).toEqual({ kind: 'unknown', message: 'something odd' })
  })
})

describe('serviceName', () => {
  it('shows the model for the AI service and the service name for the rest', () => {
    expect(serviceName('openai-compat', 'deepseek/deepseek-v4-flash')).toBe('deepseek-v4-flash')
    expect(serviceName('openai-compat')).toBe(S.service.ai)
    expect(serviceName('google-web')).toBe('Google 翻译')
    expect(serviceName('chrome-builtin')).toBe('Chrome 离线翻译')
    expect(serviceName('microsoft')).toBe('Microsoft 翻译')
    expect(serviceName('mystery')).toBe('mystery')
  })
})

describe('the strings themselves', () => {
  it('carry the product name and no implementation words', () => {
    expect(S.brand).toBe('Readarxiv')
    const all = JSON.stringify(S, (_k, v) => (typeof v === 'function' ? v('x', 'y', 'z') : v))
    expect(all).not.toMatch(/引擎|降级|块|会话|provider|fallback|helper/)
  })
})
