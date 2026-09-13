// Progress event coalescing (DESIGN §10): a maximum wait on top of the debounce, so continuous events cannot starve the tidy pass.
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

  it('continuous events do not starve it: at most maxWait from the first unprocessed event', () => {
    // Measured on 2312.17141: dozens of progress callbacks per second while translating; a pure debounce ran once only when the whole paper was done
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    for (let t = 0; t < 3000; t += 50) {
      c.schedule()
      vi.advanceTimersByTime(50)
    }
    // Events every 50 ms for 3 seconds: a pure debounce gives 0 runs; with the maximum wait about one per second
    expect(run.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(run.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('a trailing run still follows the last event', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    for (let t = 0; t < 1200; t += 50) { c.schedule(); vi.advanceTimersByTime(50) }
    const before = run.mock.calls.length
    vi.advanceTimersByTime(150)
    expect(run.mock.calls.length).toBe(before + 1)
  })

  it('no more runs after cancel', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    c.cancel()
    vi.advanceTimersByTime(2000)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('createCoalescer gathers a dirty set (issue #46)', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('items from several schedule calls are gathered, deduplicated and handed to run in insertion order', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.schedule('b')
    c.schedule('a')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(['a', 'b'])
  })

  it('no argument = full: run gets null, even when items were gathered this round too', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.schedule()
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(null)
  })

  it('after one run the set is cleared, and the next round gathers from scratch', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    vi.advanceTimersByTime(150)
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run.mock.calls).toEqual([[['a']], [['b']]])
  })

  it('the full mark lasts one round too', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(150)
    c.schedule('c')
    vi.advanceTimersByTime(150)
    expect(run.mock.calls).toEqual([[null], [['c']]])
  })

  it('cancel drops the gathered items with it', () => {
    const run = vi.fn()
    const c = createCoalescer<string>(run, { delay: 150, maxWait: 1000 })
    c.schedule('a')
    c.cancel()
    c.schedule('b')
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledWith(['b'])
  })

  it('the old usage with no type parameter and argument-less schedule still works', () => {
    const run = vi.fn()
    const c = createCoalescer(run, { delay: 150, maxWait: 1000 })
    c.schedule()
    vi.advanceTimersByTime(150)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

