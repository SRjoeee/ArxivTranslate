// Progress coalescing (DESIGN §10): a maximum wait supplements debounce so continuous events cannot starve preparation.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCoalescer } from '@/core/scheduler'

describe('createCoalescer', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('runs once after a quiet delay', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(149)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('continuous events cannot starve work: runs within maxWait of the first unprocessed event', () => {
    // 2312.17141 emitted dozens of progress callbacks per second; pure debounce ran only after the entire paper finished.
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    for (let t = 0; t < 3000; t += 50) {
      c.schedule()
      vi.advanceTimersByTime(50)
    }
    // Events every 50 ms for three seconds yield zero pure-debounce calls; maxWait should run about once per second.
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(run.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('also runs once after the final event as a trailing call', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    for (let t = 0; t < 1200; t += 50) { c.schedule(); vi.advanceTimersByTime(50) }
    const before = run.mock.calls.length
    vi.advanceTimersByTime(150)
    expect(run.mock.calls.length).toBe(before + 1)
  })

  it('does not run after cancel', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    c.cancel()
    vi.advanceTimersByTime(2000)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('createCoalescer accumulates dirty items (issue #46)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('combines scheduled items, deduplicates them, and passes them to run in insertion order', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.schedule('b')
    c.schedule('a')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(['a', 'b'])
  })

  it('argument-free scheduling means a full pass: run receives null even when the cycle already has items', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.schedule()
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(null)
  })

  it('clears accumulated items after each run so the next cycle starts fresh', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    vi.advanceTimersByTime(150)
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run.mock.calls).toEqual([[['a']], [['b']]])
  })

  it('the full-pass flag lasts only one cycle', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(150)
    c.schedule('c')
    vi.advanceTimersByTime(150)
    expect(run.mock.calls).toEqual([[null], [['c']]])
  })

  it('cancel discards accumulated items', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.cancel()
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(['b'])
  })

  it('preserves the old untyped API using only argument-free schedule', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

