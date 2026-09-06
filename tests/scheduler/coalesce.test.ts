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

describe('createCoalescer 攒脏集合（issue #46）', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('多次 schedule 的项攒在一起、去重、按加入顺序交给 run', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.schedule('b')
    c.schedule('a')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(['a', 'b'])
  })

  it('不带参数 = 全量：run 拿到 null，即使这一轮也攒过项', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.schedule()
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(null)
  })

  it('跑过一次之后集合清空，下一轮从头攒', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    vi.advanceTimersByTime(150)
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run.mock.calls).toEqual([[['a']], [['b']]])
  })

  it('全量标记也只管一轮', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(150)
    c.schedule('c')
    vi.advanceTimersByTime(150)
    expect(run.mock.calls).toEqual([[null], [['c']]])
  })

  it('cancel 把攒下的项一起丢掉', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.cancel()
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(['b'])
  })

  it('不传类型参数、只用无参 schedule 的老用法照旧能用', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

