// 用移植的 retry policy 驱动重试。p-retry 无法按错误自定义延迟（Retry-After），所以这里是十几行循环。
import { defaultRequestRetryPolicy, type RequestRetryPolicy } from './retry-policy'
import { ProviderError } from './types'

export interface RetryOptions {
  policy?: RequestRetryPolicy
  maxRetries?: number
  baseRetryDelayMs?: number
  signal?: AbortSignal
  /** 限流暂停时通知调用方（translate-service 用它暂停整条队列） */
  onPause?: (ms: number) => void
  /** 测试注入 */
  sleep?: (ms: number) => Promise<void>
}

/** 配置缺失、鉴权失败、主动中止：重试只会原样重复。移植的策略不认识这些 kind，曾把 no-key 当未知错误重试 4 次、白等 7 s（Codex 在 #6 指出） */
const NEVER_RETRY = new Set<ProviderError['kind']>(['no-key', 'auth', 'aborted'])

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
      if (error instanceof ProviderError && NEVER_RETRY.has(error.kind)) throw error
      const decision = policy.decide(error, { retryCount, maxRetries, baseRetryDelayMs, now: Date.now(), rateLimitRetryCount, consecutiveRateLimits })
      if (decision.action === 'fail') throw error
      if (decision.action === 'pause-and-retry') {
        rateLimitRetryCount++
        consecutiveRateLimits++
        options.onPause?.(decision.pauseMs)
        await sleep(decision.pauseMs)
        continue
      }
      if (retryCount >= maxRetries) throw error
      retryCount++
      await sleep(decision.delayMs)
    }
  }
}
