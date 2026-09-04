// 进度事件合并（DESIGN §10）：去抖之外加最长等待，连续事件不能把整理饿死。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescer } from '@/core/scheduler'

describe('createCoalescer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('安静 delay 之后跑一次', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(149)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('连续事件不会饿死：从第一个未处理事件起最多等 maxWait', () => {
    // 实测 2312.17141：翻译中每秒几十次进度回调，纯去抖直到整篇翻完才跑一次
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    for (let t = 0; t < 3000; t += 50) {
      c.schedule()
      vi.advanceTimersByTime(50)
    }
    // 3 秒里事件每 50ms 一次，纯去抖是 0 次；带最长等待应约每秒一次
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(run.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('最后一次事件之后仍会补跑一次（尾随）', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    for (let t = 0; t < 1200; t += 50) { c.schedule(); vi.advanceTimersByTime(50) }
    const before = run.mock.calls.length
    vi.advanceTimersByTime(150)
    expect(run.mock.calls.length).toBe(before + 1)
  })

  it('cancel 之后不再跑', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    c.cancel()
    vi.advanceTimersByTime(2000)
    expect(run).not.toHaveBeenCalled()
  })
})
