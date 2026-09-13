import { describe, expect, it } from 'vitest'
import { attachRequestErrorMeta, defaultRequestRetryPolicy, getRequestErrorMeta } from '@/providers/request/retry-policy'
import { ProviderError, type ProviderErrorKind } from '@/providers/types'

const decide = (error: unknown) =>
  defaultRequestRetryPolicy.decide(error, { retryCount: 0, maxRetries: 2, baseRetryDelayMs: 1000, now: 0, rateLimitRetryCount: 0, consecutiveRateLimits: 0 })

// The ported retry-policy knows only its own kinds; ProviderError attaches metadata by kind at construction so the policy decides right
describe('ProviderError\'s retry metadata', () => {
  it('no-key / auth: no retry, and the whole queue drains (as with 401 / 403)', () => {
    for (const kind of ['no-key', 'auth'] as const) {
      const decision = decide(new ProviderError(kind, kind))
      expect(decision).toEqual({ action: 'fail', failQueue: true })
    }
  })

  it('aborted / invalid-response: no retry, but the queue is not drained', () => {
    for (const kind of ['aborted', 'invalid-response'] as const) {
      expect(getRequestErrorMeta(new ProviderError(kind, kind)).isRetryable).toBe(false)
      expect(decide(new ProviderError(kind, kind))).toEqual({ action: 'fail' })
    }
  })

  it('timeout / network: retry with backoff; rate-limit: pause', () => {
    expect(decide(new ProviderError('timeout', 't')).action).toBe('retry')
    expect(decide(new ProviderError('network', 'n')).action).toBe('retry')
    expect(decide(new ProviderError('rate-limit', '429')).action).toBe('pause-and-retry')
  })

  it('the metadata the provider adds afterwards by status code layers over the defaults: a 429\'s Retry-After applies, and when the SDK says not retryable there is no retry', () => {
    const limited = attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '30' }, isRetryable: true })
    const decision = decide(limited)
    expect(decision.action).toBe('pause-and-retry')
    if (decision.action === 'pause-and-retry') expect(decision.pauseMs).toBeGreaterThanOrEqual(30_000)
    const flaky = attachRequestErrorMeta(new ProviderError('network', '500'), { statusCode: 500, isRetryable: false })
    expect(decide(flaky)).toEqual({ action: 'fail' })
  })

  it('every kind has its metadata, none slips through', () => {
    const kinds: ProviderErrorKind[] = ['no-key', 'network', 'rate-limit', 'auth', 'invalid-response', 'timeout', 'aborted', 'unknown']
    for (const kind of kinds) expect(() => new ProviderError(kind, kind)).not.toThrow()
    // unknown is left to the policy to judge by status code / message: with no clue the default is retryable (as in Read Frog)
    expect(decide(new ProviderError('unknown', 'boom')).action).toBe('retry')
  })
})
