// 并发上限与总时限（issue #43）。移植来的队列只有令牌桶，本项目在其上加了这两道闸。
import { describe, expect, it, vi } from 'vitest'
import { RequestQueue } from '@/providers/request/request-queue'
import { DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_TOTAL_MS } from '@/providers/translate-service'

const opts = (o: Partial<ConstructorParameters<typeof RequestQueue>[0]> = {}) => ({
  rate: 1, capacity: 1, timeoutMs: 60_000, maxRetries: 0, baseRetryDelayMs: 10, ...o,
})

describe('并发上限', () => {
  it('令牌桶不是并发上限：不设 maxConcurrent 时三个慢请求会同时在飞（issue #43 的实验）', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts())
    let inFlight = 0
    let peak = 0
    const hang = () => new Promise<string>(() => { inFlight++; peak = Math.max(peak, inFlight) })
    for (let i = 0; i < 3; i++) void queue.enqueue(hang, Date.now(), `t${i}`)
    await vi.advanceTimersByTimeAsync(2_200)
    expect(peak).toBe(3)
    vi.useRealTimers()
  })

  it('设了 maxConcurrent 之后，慢响应下在飞数不超过上限', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ maxConcurrent: 1 }))
    let inFlight = 0
    let peak = 0
    const hang = () => new Promise<string>(() => { inFlight++; peak = Math.max(peak, inFlight) })
    for (let i = 0; i < 3; i++) void queue.enqueue(hang, Date.now(), `t${i}`)
    await vi.advanceTimersByTimeAsync(2_200)
    expect(peak).toBe(1)
    vi.useRealTimers()
  })

  it('前一个完成后后面的接着走，不会卡死', async () => {
    let release!: (v: string) => void
    const queue = new RequestQueue(opts({ rate: 100, capacity: 10, maxConcurrent: 1 }))
    const order: string[] = []
    const first = queue.enqueue(() => new Promise<string>(r => { order.push('a'); release = r }), Date.now(), 'a')
    const second = queue.enqueue(async () => { order.push('b'); return 'b' }, Date.now(), 'b')
    await vi.waitFor(() => expect(order).toEqual(['a']))
    release('a')
    expect(await first).toBe('a')
    expect(await second).toBe('b')
    expect(order).toEqual(['a', 'b'])
  })

  it('翻译服务的默认值：并发 8、总时限 180 秒', () => {
    expect(DEFAULT_MAX_CONCURRENT).toBe(8)
    expect(DEFAULT_MAX_TOTAL_MS).toBe(180_000)
  })
})

describe('单个任务的总时限', () => {
  it('持续失败时到点就不再重试，把错误交回调用方', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 50, baseRetryDelayMs: 5, maxTotalMs: 60 }))
    let calls = 0
    const failing = async () => { calls++; throw Object.assign(new Error('boom'), { name: 'TypeError' }) }
    await expect(queue.enqueue(failing, Date.now(), 'x')).rejects.toThrow('boom')
    // 没有总时限的话 maxRetries=50 会跑满 51 次；有了之后按时间截断
    expect(calls).toBeLessThan(51)
    expect(calls).toBeGreaterThan(1)
  })

  it('不设总时限时行为不变：跑满重试次数', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 3, baseRetryDelayMs: 1 }))
    let calls = 0
    const failing = async () => { calls++; throw Object.assign(new Error('boom'), { name: 'TypeError' }) }
    await expect(queue.enqueue(failing, Date.now(), 'y')).rejects.toThrow('boom')
    expect(calls).toBe(4)
  })
})
