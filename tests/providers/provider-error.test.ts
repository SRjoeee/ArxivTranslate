import { describe, expect, it } from 'vitest'
import { attachRequestErrorMeta, defaultRequestRetryPolicy, getRequestErrorMeta } from '@/providers/request/retry-policy'
import { ProviderError, type ProviderErrorKind } from '@/providers/types'

const decide = (error: unknown) =>
  defaultRequestRetryPolicy.decide(error, { retryCount: 0, maxRetries: 2, baseRetryDelayMs: 1000, now: 0, rateLimitRetryCount: 0, consecutiveRateLimits: 0 })

// 移植的 retry-policy 只认它自己的 kind；ProviderError 构造时按 kind 挂元数据，策略才能做对决定
describe('ProviderError 的重试元数据', () => {
  it('no-key / auth：不重试，且整条队列排空（与 401 / 403 同）', () => {
    for (const kind of ['no-key', 'auth'] as const) {
      const decision = decide(new ProviderError(kind, kind))
      expect(decision).toEqual({ action: 'fail', failQueue: true })
    }
  })

  it('aborted / invalid-response：不重试，但不排空队列', () => {
    for (const kind of ['aborted', 'invalid-response'] as const) {
      expect(getRequestErrorMeta(new ProviderError(kind, kind)).isRetryable).toBe(false)
      expect(decide(new ProviderError(kind, kind))).toEqual({ action: 'fail' })
    }
  })

  it('timeout / network：退避重试；rate-limit：暂停', () => {
    expect(decide(new ProviderError('timeout', 't')).action).toBe('retry')
    expect(decide(new ProviderError('network', 'n')).action).toBe('retry')
    expect(decide(new ProviderError('rate-limit', '429')).action).toBe('pause-and-retry')
  })

  it('provider 随后按状态码补的元数据叠在默认之上：429 的 Retry-After 生效，SDK 说不可重试就不重试', () => {
    const limited = attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '30' }, isRetryable: true })
    const decision = decide(limited)
    expect(decision.action).toBe('pause-and-retry')
    if (decision.action === 'pause-and-retry') expect(decision.pauseMs).toBeGreaterThanOrEqual(30_000)
    const flaky = attachRequestErrorMeta(new ProviderError('network', '500'), { statusCode: 500, isRetryable: false })
    expect(decide(flaky)).toEqual({ action: 'fail' })
  })

  it('每种 kind 都有一份元数据，没有漏网的', () => {
    const kinds: ProviderErrorKind[] = ['no-key', 'network', 'rate-limit', 'auth', 'invalid-response', 'timeout', 'aborted', 'unknown']
    for (const kind of kinds) expect(() => new ProviderError(kind, kind)).not.toThrow()
    // unknown 交给策略按状态码 / 消息判断：没有线索时默认可重试（与 Read Frog 一致）
    expect(decide(new ProviderError('unknown', 'boom')).action).toBe('retry')
  })
})
