// The concurrency cap and the total time limit (issue #43). The ported queue has only the token bucket; this project added these two gates on top.
import { describe, expect, it, vi } from 'vitest'
import { ABORT_GRACE_MS, RequestQueue, SATURATED_DISPATCH_ETA_MS } from '@/providers/request/request-queue'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import { DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_TOTAL_MS } from '@/providers/translate-service'

const opts = (o: Partial<ConstructorParameters<typeof RequestQueue>[0]> = {}) => ({
  rate: 1, capacity: 1, timeoutMs: 60_000, maxRetries: 0, baseRetryDelayMs: 10, ...o,
})

describe('the concurrency cap', () => {
  it('the token bucket is no concurrency cap: without maxConcurrent three slow requests are in flight at once (the experiment of issue #43)', async () => {
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

  it('with maxConcurrent set, under slow responses the in-flight count stays within the cap', async () => {
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

  it('once the previous one completes the next goes on, without deadlock', async () => {
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

  it('the translation service\'s defaults: concurrency 8, total limit 180 seconds', () => {
    expect(DEFAULT_MAX_CONCURRENT).toBe(8)
    expect(DEFAULT_MAX_TOTAL_MS).toBe(180_000)
  })
})

describe('the total time limit of one task', () => {
  it('under persistent failure it stops retrying once the limit is reached and hands the error back to the caller', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 50, baseRetryDelayMs: 5, maxTotalMs: 60 }))
    let calls = 0
    const failing = async () => { calls++; throw Object.assign(new Error('boom'), { name: 'TypeError' }) }
    await expect(queue.enqueue(failing, Date.now(), 'x')).rejects.toThrow('boom')
    // Without a total limit maxRetries=50 would run the full 51 attempts; with it the cut is by time
    expect(calls).toBeLessThan(51)
    expect(calls).toBeGreaterThan(1)
  })

  it('without a total limit the behaviour is unchanged: the retries run to the count', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 3, baseRetryDelayMs: 1 }))
    let calls = 0
    const failing = async () => { calls++; throw Object.assign(new Error('boom'), { name: 'TypeError' }) }
    await expect(queue.enqueue(failing, Date.now(), 'y')).rejects.toThrow('boom')
    expect(calls).toBe(4)
  })
})

describe('no idle spinning at full concurrency (Codex on #56)', () => {
  it('with the slots occupied no 0 ms timer is armed: there must be no timer storm before an in-flight request returns', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    const hang = () => new Promise<string>(() => undefined)
    for (let i = 0; i < 5; i++) queue.enqueue(hang, Date.now(), `t${i}`).catch(() => undefined)

    // Timing starts once “already full”, counting only how many wake-ups the queue arranged for itself in that period
    const spy = vi.spyOn(globalThis, 'setTimeout')
    await vi.advanceTimersByTimeAsync(5_000)
    // Before the fix: every schedule() re-armed with delay=0, tens of thousands of times in 5 seconds
    expect(spy.mock.calls.length).toBeLessThan(5)
    spy.mockRestore()
    vi.useRealTimers()
  })

  it('nextDispatchEtaMs counts full concurrency in: the gate keeps accumulating by it rather than rushing small batches', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    expect(queue.nextDispatchEtaMs()).toBe(0)
    queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'a').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    // Tokens aplenty, no pause; the only block is full concurrency
    expect(queue.nextDispatchEtaMs()).toBe(SATURATED_DISPATCH_ETA_MS)
    vi.useRealTimers()
  })
})

describe('the total limit really bounds the duration (Codex on #56)', () => {
  const rateLimited = () => {
    const error = new Error('429 Too Many Requests')
    return attachRequestErrorMeta(error, { statusCode: 429, retryAfterMs: 300_000 })
  }

  it('a Retry-After longer than the remaining budget gives up at once rather than queueing to wait for nothing', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 5, maxTotalMs: 1_000 }))
    let calls = 0
    const failing = async () => { calls++; throw rateLimited() }
    const task = queue.enqueue(failing, Date.now(), 'x')
    const settled = expect(task).rejects.toThrow('429')
    await vi.advanceTimersByTimeAsync(50)
    await settled
    // Before the fix: it only checked “timed out right now”, a few milliseconds short, and queued a retry 300 seconds out
    expect(calls).toBe(1)
    vi.useRealTimers()
  })

  it('a single attempt\'s timeout is cut by the remaining budget: no full-length attempt starts with little budget left', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, timeoutMs: 120_000, maxRetries: 0, maxTotalMs: 2_000 }))
    const task = queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'x')
    const settled = expect(task).rejects.toThrow(/timed out after 2000ms/)
    await vi.advanceTimersByTimeAsync(2_100)
    await settled
    vi.useRealTimers()
  })

  it('a task that timed out waiting behind the concurrency cap sends no request and ends as a timeout outright', async () => {
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

describe('the boundary of deadline and concurrency (Codex on #56, second round)', () => {
  it('deadlineAt overrides “enqueue time + budget”: a batch-level retry re-enqueued gets no fresh budget', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 0, timeoutMs: 60_000, maxTotalMs: 60_000 }))
    // This batch started 500 milliseconds ago and has 500 milliseconds of deadline left — not 60 seconds recomputed on enqueue
    const task = queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'x', undefined, { deadlineAt: Date.now() + 500 })
    const settled = expect(task).rejects.toThrow(/timed out after 500ms/)
    await vi.advanceTimersByTimeAsync(600)
    await settled
    vi.useRealTimers()
  })

  it('the batch\'s meta carries the first dispatch time, and a batch-level retry gets the same value', async () => {
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    const seen: number[] = []
    let attempt = 0
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 1, maxRetries: 1,
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async (items, meta) => {
        seen.push(meta.startedAt)
        // Returns one short the first time, forcing a batch-level retry
        return attempt++ === 0 ? [] : items.map(i => `译:${i.text}`)
      },
    })
    expect(await batch.enqueue({ text: 'A' })).toBe('译:A')
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })

  it('a 429 over budget still records the cooldown on the queue: the backlog must not hit it again at once', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 5, maxTotalMs: 1_000 }))
    const limited = async () => { throw attachRequestErrorMeta(new Error('429 Too Many Requests'), { statusCode: 429, retryAfterMs: 300_000 }) }
    const expired = queue.enqueue(limited, Date.now(), 'a')
    const settled = expect(expired).rejects.toThrow('429')
    await vi.advanceTimersByTimeAsync(50)
    await settled
    // The cooldown is booked: the next batch's dispatch estimate is not zero
    expect(queue.nextDispatchEtaMs()).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('an attempt not yet finished after cancellation still holds its concurrency slot: cancelling must not break the cap', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    let started = 0
    // A thunk ignoring the signal: cancelling only takes it off the table, the connection stays occupied
    const stubborn = () => { started++; return new Promise<string>(() => undefined) }
    queue.enqueue(stubborn, Date.now(), 'a', ['s1']).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    expect(started).toBe(1)
    queue.cancelByScope('s1')
    queue.enqueue(stubborn, Date.now(), 'b', ['s2']).catch(() => undefined)
    await vi.advanceTimersByTimeAsync(50)
    expect(started).toBe(1)
    vi.useRealTimers()
  })

  it('the concurrency cap must be a positive integer: 0 / negative / NaN would leave the queue never dispatching', () => {
    expect(() => new RequestQueue(opts({ maxConcurrent: 0 }))).toThrow()
    expect(() => new RequestQueue(opts({ maxConcurrent: -1 }))).toThrow()
    expect(() => new RequestQueue(opts({ maxConcurrent: Number.NaN }))).toThrow()
    expect(() => new RequestQueue(opts({ maxTotalMs: 0 }))).toThrow()
    expect(() => new RequestQueue(opts({ maxConcurrent: 8, maxTotalMs: 1000 }))).not.toThrow()
  })
})

describe('the deadline is a time event that neither a pause nor full load can stop (Codex on #56, third round)', () => {
  it('a rate-limit pause longer than the budget: queued tasks are reclaimed at the deadline rather than hanging through the pause', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, maxRetries: 5, maxTotalMs: 1_000 }))
    const limited = async () => { throw attachRequestErrorMeta(new Error('429 Too Many Requests'), { statusCode: 429, retryAfterMs: 300_000 }) }
    queue.enqueue(limited, Date.now(), 'head').catch(() => undefined)
    const queued = queue.enqueue(async () => 'never', Date.now(), 'tail')
    const settled = expect(queued).rejects.toThrow(/total budget/)
    // Before the fix: schedule() woke only at pausedUntil (300 seconds out), and the queued task hung the full 5 minutes of the pause
    await vi.advanceTimersByTimeAsync(2_000)
    await settled
    vi.useRealTimers()
  })

  it('after a timeout the concurrency slot is returned only once the thunk really ends', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, timeoutMs: 50, maxRetries: 0 }))
    let started = 0
    let release!: () => void
    // A thunk ignoring the signal: the timeout won the race, and it is still running
    const stubborn = () => { started++; return new Promise<string>((_, rej) => { release = () => rej(new Error('late')) }) }
    queue.enqueue(stubborn, Date.now(), 'a').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    expect(started).toBe(1)
    queue.enqueue(stubborn, Date.now(), 'b').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(200) // the first timed out long ago
    expect(started).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(started).toBe(2)
    vi.useRealTimers()
  })

  it('when the thunk never ends the slot is returned at the end of the grace period: the queue must not lock up', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, timeoutMs: 50, maxRetries: 0 }))
    let started = 0
    const hang = () => { started++; return new Promise<string>(() => undefined) }
    queue.enqueue(hang, Date.now(), 'a').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    queue.enqueue(hang, Date.now(), 'b').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(ABORT_GRACE_MS - 100)
    expect(started).toBe(1)
    await vi.advanceTimersByTimeAsync(200)
    expect(started).toBe(2)
    vi.useRealTimers()
  })

  it('the per-item fallback and the batch-level retry use the same batch deadline', async () => {
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    const seen: number[] = []
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 1, maxRetries: 0,
      enableFallbackToIndividual: true,
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async (_items, meta) => { seen.push(meta.startedAt); return [] },
      executeIndividual: async (item, meta) => { seen.push(meta.startedAt); return `译:${item.text}` },
    })
    expect(await batch.enqueue({ text: 'A' })).toBe('译:A')
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })
})

describe('a thunk that throws synchronously (Codex on #56, fourth round)', () => {
  it('when the thunk throws synchronously the slot is returned at once and later tasks dispatch as usual', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, maxRetries: 0 }))
    // Throws outright without returning a Promise: in executeTask's catch, thunkPromise is still null
    const boom = (() => { throw Object.assign(new Error('sync boom'), { name: 'TypeError' }) }) as unknown as () => Promise<string>
    await expect(queue.enqueue(boom, Date.now(), 'a')).rejects.toThrow('sync boom')
    // Before the fix a ReferenceError here booked the slot for good, and the second task never got its turn
    expect(await queue.enqueue(async () => 'b', Date.now(), 'b')).toBe('b')
  })
})

describe('the deadline counts from batch creation, and the backoff is bound by the budget (Codex on #56, fifth round)', () => {
  it('the time the dispatch gate holds a batch counts into the total limit: meta.startedAt is the batch\'s creation time, not its dispatch time', async () => {
    vi.useFakeTimers()
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    let eta = 5_000 // say “no slot” first, so the underfull batch is held
    const seen: number[] = []
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 10, maxRetries: 0,
      dispatchGate: { nextDispatchEtaMs: () => eta },
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async (items, meta) => { seen.push(meta.startedAt); return items.map(i => `译:${i.text}`) },
    })
    const created = Date.now()
    const result = batch.enqueue({ text: 'A' })
    await vi.advanceTimersByTimeAsync(3_000) // held for 3 seconds
    eta = 0
    await vi.advanceTimersByTimeAsync(1_500)
    expect(await result).toBe('译:A')
    // Before the fix startedAt was the dispatch time (≈ created + 3000), and the deadline missed the 3 seconds held
    expect(seen[0]! - created).toBeLessThan(100)
    vi.useRealTimers()
  })

  it('near the deadline it no longer sleeps the backoff before re-enqueueing: straight to the per-item fallback', async () => {
    vi.useFakeTimers()
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    let individual = 0
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 1, maxRetries: 3, maxTotalMs: 200,
      enableFallbackToIndividual: true,
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async () => [], // count mismatch
      executeIndividual: async item => { individual++; return `译:${item.text}` },
    })
    const result = batch.enqueue({ text: 'A' })
    // The backoff is at least 1 second, over the 200 ms budget; before the fix it slept it out first
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toBe('译:A')
    expect(individual).toBe(1)
    vi.useRealTimers()
  })

  it('setQueueOptions shortening the total budget reclaims already expired queued tasks at once; in-flight ones run out on the original budget', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, timeoutMs: 10_000, maxRetries: 0, maxTotalMs: 60_000 }))
    let released!: () => void
    const head = queue.enqueue(() => new Promise<string>(r => { released = () => r('head') }), Date.now(), 'head')
    const tail = queue.enqueue(async () => 'tail', Date.now(), 'tail')
    const tailSettled = expect(tail).rejects.toThrow(/total budget/)
    await vi.advanceTimersByTimeAsync(2_000)
    queue.setQueueOptions({ maxTotalMs: 1_000 }) // the tail queued for 2 seconds is over budget at once
    await vi.advanceTimersByTimeAsync(10)
    await tailSettled
    released()
    expect(await head).toBe('head') // the in-flight one is unaffected
    vi.useRealTimers()
  })
})

describe('a batch held by the gate is released at its deadline (Codex on #56, sixth round)', () => {
  it('with maxTotalMs shorter than the batch-holding cap it dispatches at the deadline, no longer waiting 60 seconds', async () => {
    vi.useFakeTimers()
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    let executed = 0
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 10, maxRetries: 0, maxTotalMs: 200,
      dispatchGate: { nextDispatchEtaMs: () => 5_000 }, // always says no slot
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async items => { executed++; return items.map(i => `译:${i.text}`) },
    })
    const result = batch.enqueue({ text: 'A' })
    await vi.advanceTimersByTimeAsync(150)
    expect(executed).toBe(0) // still within budget, keeps accumulating
    await vi.advanceTimersByTimeAsync(100)
    expect(executed).toBe(1) // released at the deadline (downstream handles it by deadlineAt)
    expect(await result).toBe('译:A')
    vi.useRealTimers()
  })
})
