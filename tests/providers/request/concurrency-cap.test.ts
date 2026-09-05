// 并发上限与总时限（issue #43）。移植来的队列只有令牌桶，本项目在其上加了这两道闸。
import { describe, expect, it, vi } from 'vitest'
import { RequestQueue, SATURATED_DISPATCH_ETA_MS } from '@/providers/request/request-queue'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
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

describe('并发满载时不空转（Codex 在 #56 指出）', () => {
  it('槽位被占着时不武装 0 毫秒定时器：在飞请求返回前不该有定时器风暴', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    const hang = () => new Promise<string>(() => undefined)
    for (let i = 0; i < 5; i++) queue.enqueue(hang, Date.now(), `t${i}`).catch(() => undefined)

    // 计时从「已经满载」之后开始，只数这段时间里队列自己安排了多少次唤醒
    const spy = vi.spyOn(globalThis, 'setTimeout')
    await vi.advanceTimersByTimeAsync(5_000)
    // 修复前：每次 schedule() 都以 delay=0 再武装一次，5 秒内上万次
    expect(spy.mock.calls.length).toBeLessThan(5)
    spy.mockRestore()
    vi.useRealTimers()
  })

  it('nextDispatchEtaMs 把并发满载算进去：门闸据此继续攒批而不是冲小批', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    expect(queue.nextDispatchEtaMs()).toBe(0)
    queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'a').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    // 令牌管够、没有暂停，唯一的阻塞是并发满载
    expect(queue.nextDispatchEtaMs()).toBe(SATURATED_DISPATCH_ETA_MS)
    vi.useRealTimers()
  })
})

describe('总时限真的兜住了时长（Codex 在 #56 指出）', () => {
  const rateLimited = () => {
    const error = new Error('429 Too Many Requests')
    return attachRequestErrorMeta(error, { statusCode: 429, retryAfterMs: 300_000 })
  }

  it('Retry-After 比剩余预算还长时立刻放弃，不排进队列干等', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 5, maxTotalMs: 1_000 }))
    let calls = 0
    const failing = async () => { calls++; throw rateLimited() }
    const task = queue.enqueue(failing, Date.now(), 'x')
    const settled = expect(task).rejects.toThrow('429')
    await vi.advanceTimersByTimeAsync(50)
    await settled
    // 修复前：只看「此刻是否已超时」，几毫秒没超，于是排进 300 秒后的重试
    expect(calls).toBe(1)
    vi.useRealTimers()
  })

  it('单次尝试的超时被剩余预算截断：不会在预算只剩一点时开跑满程尝试', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, timeoutMs: 120_000, maxRetries: 0, maxTotalMs: 2_000 }))
    const task = queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'x')
    const settled = expect(task).rejects.toThrow(/timed out after 2000ms/)
    await vi.advanceTimersByTimeAsync(2_100)
    await settled
    vi.useRealTimers()
  })

  it('排在并发上限后面等超了的任务不再发请求，直接以超时告终', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, timeoutMs: 10_000, maxRetries: 0, maxTotalMs: 1_000 }))
    let calls = 0
    queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'head').catch(() => undefined)
    const queued = queue.enqueue(async () => { calls++; return 'never' }, Date.now(), 'tail')
    const settled = expect(queued).rejects.toThrow(/total budget/)
    await vi.advanceTimersByTimeAsync(11_000)
    await settled
    expect(calls).toBe(0)
    vi.useRealTimers()
  })
})
