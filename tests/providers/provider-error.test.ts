import { describe, expect, it } from 'vitest'
import { attachRequestErrorMeta, defaultRequestRetryPolicy, getRequestErrorMeta } from '@/providers/request/retry-policy'
import { ProviderError, type ProviderErrorKind } from '@/providers/types'

const decide = (error: unknown) =>
  defaultRequestRetryPolicy.decide(error, { retryCount: 0, maxRetries: 2, baseRetryDelayMs: 1000, now: 0, rateLimitRetryCount: 0, consecutiveRateLimits: 0 })

// The ported retry policy recognizes only its own kinds; ProviderError adds kind-based metadata so policy decisions remain correct.
describe('ProviderError retry metadata', () => {
  it('no-key and auth do not retry and drain the queue, matching 401 and 403', () => {
    for (const kind of ['no-key', 'auth'] as const) {
      const decision = decide(new ProviderError(kind, kind))
      expect(decision).toEqual({ action: 'fail', failQueue: true })
    }
  })

  it('aborted and invalid-response neither retry nor drain the queue', () => {
    for (const kind of ['aborted', 'invalid-response'] as const) {
      expect(getRequestErrorMeta(new ProviderError(kind, kind)).isRetryable).toBe(false)
      expect(decide(new ProviderError(kind, kind))).toEqual({ action: 'fail' })
    }
  })

  it('timeout and network use backoff; rate-limit pauses', () => {
    expect(decide(new ProviderError('timeout', 't')).action).toBe('retry')
    expect(decide(new ProviderError('network', 'n')).action).toBe('retry')
    expect(decide(new ProviderError('rate-limit', '429')).action).toBe('pause-and-retry')
  })

  it('status-specific metadata overrides defaults: 429 Retry-After applies and SDK nonretryable errors remain nonretryable', () => {
    const limited = attachRequestErrorMeta(new ProviderError('rate-limit', '429'), { statusCode: 429, responseHeaders: { 'retry-after': '30' }, isRetryable: true })
    const decision = decide(limited)
    expect(decision.action).toBe('pause-and-retry')
    if (decision.action === 'pause-and-retry') expect(decision.pauseMs).toBeGreaterThanOrEqual(30_000)
    const flaky = attachRequestErrorMeta(new ProviderError('network', '500'), { statusCode: 500, isRetryable: false })
    expect(decide(flaky)).toEqual({ action: 'fail' })
  })

  it('every error kind has metadata', () => {
    const kinds: ProviderErrorKind[] = ['no-key', 'network', 'rate-limit', 'auth', 'invalid-response', 'timeout', 'aborted', 'unknown']
    for (const kind of kinds) expect(() => new ProviderError(kind, kind)).not.toThrow()
    // unknown delegates to status/message policy and defaults to retryable without clues, matching Read Frog
    expect(decide(new ProviderError('unknown', 'boom')).action).toBe('retry')
  })
})
