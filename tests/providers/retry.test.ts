import { describe, expect, it } from 'vitest'
import { withRetry } from '@/providers/retry'
import { attachRequestErrorMeta } from '@/providers/retry-policy'

const failing = (errors: unknown[], result = 'done') => {
  let calls = 0
  const fn = async () => {
    const e = errors[calls++]
    if (e) throw e
    return result
  }
  return { fn, calls: () => calls }
}
const recorder = () => {
  const sleeps: number[] = []
  return { sleeps, sleep: async (ms: number) => { sleeps.push(ms) } }
}

describe('withRetry + 移植的 retry policy', () => {
  it('429：暂停后重试；暂停至少基础 5 s（带抖动），Retry-After 更长时按它来', async () => {
    const short = attachRequestErrorMeta(new Error('429'), { statusCode: 429, responseHeaders: { 'retry-after': '2' }, isRetryable: true })
    const a = failing([short])
    const ra = recorder()
    expect(await withRetry(a.fn, { sleep: ra.sleep })).toBe('done')
    expect(a.calls()).toBe(2)
    expect(ra.sleeps).toHaveLength(1)
    expect(ra.sleeps[0]).toBeGreaterThanOrEqual(2000)
    expect(ra.sleeps[0]).toBeLessThanOrEqual(10_000)

    const long = attachRequestErrorMeta(new Error('429'), { statusCode: 429, responseHeaders: { 'retry-after': '30' }, isRetryable: true })
    const b = failing([long])
    const rb = recorder()
    expect(await withRetry(b.fn, { sleep: rb.sleep })).toBe('done')
    expect(rb.sleeps[0]).toBeGreaterThanOrEqual(30_000)
  })

  it('401 不重试，原错误抛出', async () => {
    const err = attachRequestErrorMeta(new Error('401'), { statusCode: 401, isRetryable: false })
    const { fn, calls } = failing([err, err])
    const r = recorder()
    await expect(withRetry(fn, { sleep: r.sleep })).rejects.toBe(err)
    expect(calls()).toBe(1)
    expect(r.sleeps).toEqual([])
  })

  it('网络错误退避重试，超过上限抛最后一个错误', async () => {
    const mk = (n: number) => attachRequestErrorMeta(new Error(`net ${n}`), { kind: 'network', isRetryable: true })
    const errors = [mk(1), mk(2), mk(3), mk(4)]
    const { fn, calls } = failing(errors)
    const r = recorder()
    await expect(withRetry(fn, { sleep: r.sleep, maxRetries: 2 })).rejects.toBe(errors[2])
    expect(calls()).toBe(3)
    expect(r.sleeps.length).toBe(2)
    expect(r.sleeps.every(ms => ms > 0)).toBe(true)
  })

  it('已中止的 signal：不调用函数直接拒绝', async () => {
    const { fn, calls } = failing([])
    await expect(withRetry(fn, { signal: AbortSignal.abort() })).rejects.toThrow(/abort/i)
    expect(calls()).toBe(0)
  })
})
