// 用移植的 retry policy 驱动重试。p-retry 无法按错误自定义延迟（Retry-After），所以这里是十几行循环。
import { defaultRequestRetryPolicy, type RequestRetryPolicy } from './retry-policy'

export interface RetryOptions {
  policy?: RequestRetryPolicy
  maxRetries?: number
  baseRetryDelayMs?: number
  signal?: AbortSignal
  /** 测试注入 */
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { policy = defaultRequestRetryPolicy, maxRetries = 3, baseRetryDelayMs = 1000, signal, sleep = defaultSleep } = options
  let retryCount = 0
  let rateLimitRetryCount = 0
  let consecutiveRateLimits = 0
  for (;;) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      return await fn()
    } catch (error) {
      const decision = policy.decide(error, { retryCount, maxRetries, baseRetryDelayMs, now: Date.now(), rateLimitRetryCount, consecutiveRateLimits })
      if (decision.action === 'fail') throw error
      if (decision.action === 'pause-and-retry') {
        rateLimitRetryCount++
        consecutiveRateLimits++
        await sleep(decision.pauseMs)
        continue
      }
      if (retryCount >= maxRetries) throw error
      retryCount++
      await sleep(decision.delayMs)
    }
  }
}
