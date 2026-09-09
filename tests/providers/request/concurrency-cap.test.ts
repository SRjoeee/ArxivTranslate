// Concurrency and total-time limits (issue #43). The ported queue had only a token bucket; this project adds both gates.
import { describe, expect, it, vi } from 'vitest'
import { ABORT_GRACE_MS, RequestQueue, SATURATED_DISPATCH_ETA_MS } from '@/providers/request/request-queue'
import { attachRequestErrorMeta } from '@/providers/request/retry-policy'
import { DEFAULT_MAX_CONCURRENT, DEFAULT_MAX_TOTAL_MS } from '@/providers/translate-service'

const opts = (o: Partial<ConstructorParameters<typeof RequestQueue>[0]> = {}) => ({
  rate: 1, capacity: 1, timeoutMs: 60_000, maxRetries: 0, baseRetryDelayMs: 10, ...o,
})

describe('concurrency limit', () => {
  it('a token bucket does not cap concurrency: three slow requests run together without maxConcurrent (issue #43 experiment)', async () => {
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

  it('maxConcurrent bounds in-flight requests despite slow responses', async () => {
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

  it('queued work continues after earlier requests complete without deadlocking', async () => {
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

  it('translation service defaults: concurrency 8 and total timeout 180 seconds', () => {
    expect(DEFAULT_MAX_CONCURRENT).toBe(8)
    expect(DEFAULT_MAX_TOTAL_MS).toBe(180_000)
  })
})

describe('total timeout per task', () => {
  it('persistent failures stop retrying at the deadline and return the error', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 50, baseRetryDelayMs: 5, maxTotalMs: 60 }))
    let calls = 0
    const failing = async () => { calls++; throw Object.assign(new Error('boom'), { name: 'TypeError' }) }
    await expect(queue.enqueue(failing, Date.now(), 'x')).rejects.toThrow('boom')
    // Without a total timeout, maxRetries=50 allows 51 attempts; the deadline cuts them short.
    expect(calls).toBeLessThan(51)
    expect(calls).toBeGreaterThan(1)
  })

  it('omitting the total timeout preserves the full retry count', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 3, baseRetryDelayMs: 1 }))
    let calls = 0
    const failing = async () => { calls++; throw Object.assign(new Error('boom'), { name: 'TypeError' }) }
    await expect(queue.enqueue(failing, Date.now(), 'y')).rejects.toThrow('boom')
    expect(calls).toBe(4)
  })
})

describe('does not spin at full concurrency (Codex #56)', () => {
  it('occupied slots do not arm zero-delay timers or cause a timer storm before requests finish', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    const hang = () => new Promise<string>(() => undefined)
    for (let i = 0; i < 5; i++) queue.enqueue(hang, Date.now(), `t${i}`).catch(() => undefined)

    // Start counting queue-scheduled wakeups only after all slots are occupied.
    const spy = vi.spyOn(globalThis, 'setTimeout')
    await vi.advanceTimersByTimeAsync(5_000)
    // Before the fix, each schedule() rearmed delay=0, causing tens of thousands of wakeups in five seconds.
    expect(spy.mock.calls.length).toBeLessThan(5)
    spy.mockRestore()
    vi.useRealTimers()
  })

  it('nextDispatchEtaMs accounts for full concurrency so the batching gate keeps collecting instead of flushing small batches', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    expect(queue.nextDispatchEtaMs()).toBe(0)
    queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'a').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    // Tokens are plentiful and there is no pause; full concurrency is the only blocker.
    expect(queue.nextDispatchEtaMs()).toBe(SATURATED_DISPATCH_ETA_MS)
    vi.useRealTimers()
  })
})

describe('the total timeout really bounds duration (Codex #56)', () => {
  const rateLimited = () => {
    const error = new Error('429 Too Many Requests')
    return attachRequestErrorMeta(error, { statusCode: 429, retryAfterMs: 300_000 })
  }

  it('gives up immediately when Retry-After exceeds the remaining budget instead of queueing a wait', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 5, maxTotalMs: 1_000 }))
    let calls = 0
    const failing = async () => { calls++; throw rateLimited() }
    const task = queue.enqueue(failing, Date.now(), 'x')
    const settled = expect(task).rejects.toThrow('429')
    await vi.advanceTimersByTimeAsync(50)
    await settled
    // Before the fix, only current elapsed time was checked, allowing a retry 300 seconds later when merely milliseconds had passed.
    expect(calls).toBe(1)
    vi.useRealTimers()
  })

  it('caps attempt timeout at the remaining budget instead of starting a full-length attempt near the deadline', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, timeoutMs: 120_000, maxRetries: 0, maxTotalMs: 2_000 }))
    const task = queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'x')
    const settled = expect(task).rejects.toThrow(/timed out after 2000ms/)
    await vi.advanceTimersByTimeAsync(2_100)
    await settled
    vi.useRealTimers()
  })

  it('tasks that expire behind the concurrency limit fail with timeout without sending a request', async () => {
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

describe('deadline and concurrency boundaries (Codex #56, round 2)', () => {
  it('deadlineAt overrides enqueue time plus budget so batch retries cannot obtain a fresh budget', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 0, timeoutMs: 60_000, maxTotalMs: 60_000 }))
    // The batch started 500 ms ago and has 500 ms left, rather than resetting to 60 seconds on enqueue.
    const task = queue.enqueue(() => new Promise<string>(() => undefined), Date.now(), 'x', undefined, { deadlineAt: Date.now() + 500 })
    const settled = expect(task).rejects.toThrow(/timed out after 500ms/)
    await vi.advanceTimersByTimeAsync(600)
    await settled
    vi.useRealTimers()
  })

  it('batch metadata retains the same initial dispatch time across retries', async () => {
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    const seen: number[] = []
    let attempt = 0
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 1, maxRetries: 1,
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async (items, meta) => {
        seen.push(meta.startedAt)
        // Return one fewer result on the first attempt to force a batch retry.
        return attempt++ === 0 ? [] : items.map(i => `译:${i.text}`)
      },
    })
    expect(await batch.enqueue({ text: 'A' })).toBe('译:A')
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(seen[1])
  })

  it('an over-budget 429 still records cooldown so queued work cannot immediately hit the endpoint again', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxRetries: 5, maxTotalMs: 1_000 }))
    const limited = async () => { throw attachRequestErrorMeta(new Error('429 Too Many Requests'), { statusCode: 429, retryAfterMs: 300_000 }) }
    const expired = queue.enqueue(limited, Date.now(), 'a')
    const settled = expect(expired).rejects.toThrow('429')
    await vi.advanceTimersByTimeAsync(50)
    await settled
    // Cooldown is recorded: estimated dispatch time for the next batch is nonzero.
    expect(queue.nextDispatchEtaMs()).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('cancelled attempts retain their concurrency permits until they finish so cancellation cannot exceed the cap', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1 }))
    let started = 0
    // This thunk ignores the signal: cancellation removes bookkeeping but the connection remains occupied.
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

  it('maxConcurrent must be a positive integer; zero, negatives, and NaN would prevent dispatch forever', () => {
    expect(() => new RequestQueue(opts({ maxConcurrent: 0 }))).toThrow()
    expect(() => new RequestQueue(opts({ maxConcurrent: -1 }))).toThrow()
    expect(() => new RequestQueue(opts({ maxConcurrent: Number.NaN }))).toThrow()
    expect(() => new RequestQueue(opts({ maxTotalMs: 0 }))).toThrow()
    expect(() => new RequestQueue(opts({ maxConcurrent: 8, maxTotalMs: 1000 }))).not.toThrow()
  })
})

describe('deadlines are time events unaffected by pauses or full concurrency (Codex #56, round 3)', () => {
  it('queued tasks expire on time even when a rate-limit pause exceeds their budget', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, maxRetries: 5, maxTotalMs: 1_000 }))
    const limited = async () => { throw attachRequestErrorMeta(new Error('429 Too Many Requests'), { statusCode: 429, retryAfterMs: 300_000 }) }
    queue.enqueue(limited, Date.now(), 'head').catch(() => undefined)
    const queued = queue.enqueue(async () => 'never', Date.now(), 'tail')
    const settled = expect(queued).rejects.toThrow(/total budget/)
    // Before the fix, schedule() woke only at pausedUntil, leaving queued tasks hanging for the full five-minute pause.
    await vi.advanceTimersByTimeAsync(2_000)
    await settled
    vi.useRealTimers()
  })

  it('timeout releases a concurrency permit only after the thunk actually finishes', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, timeoutMs: 50, maxRetries: 0 }))
    let started = 0
    let release!: () => void
    // This thunk ignores the signal and keeps running after losing the timeout race.
    const stubborn = () => { started++; return new Promise<string>((_, rej) => { release = () => rej(new Error('late')) }) }
    queue.enqueue(stubborn, Date.now(), 'a').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(10)
    expect(started).toBe(1)
    queue.enqueue(stubborn, Date.now(), 'b').catch(() => undefined)
    await vi.advanceTimersByTimeAsync(200) // The first task timed out earlier.
    expect(started).toBe(1)
    release()
    await vi.advanceTimersByTimeAsync(10)
    expect(started).toBe(2)
    vi.useRealTimers()
  })

  it('a never-settling thunk releases its permit after the grace period so the queue cannot lock up', async () => {
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

  it('individual fallback and batch retries share the same batch deadline', async () => {
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

describe('synchronously throwing thunks (Codex #56, round 4)', () => {
  it('a synchronous thunk error releases its permit immediately so later tasks can dispatch', async () => {
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, maxRetries: 0 }))
    // Throws directly without returning a promise; thunkPromise is still null in the executeTask catch.
    const boom = (() => { throw Object.assign(new Error('sync boom'), { name: 'TypeError' }) }) as unknown as () => Promise<string>
    await expect(queue.enqueue(boom, Date.now(), 'a')).rejects.toThrow('sync boom')
    // Before the fix, ReferenceError leaked the permit and prevented the second task from ever dispatching.
    expect(await queue.enqueue(async () => 'b', Date.now(), 'b')).toBe('b')
  })
})

describe('deadlines begin at batch creation and backoff respects the budget (Codex #56, round 5)', () => {
  it('time held by the dispatch gate counts toward the budget: meta.startedAt is creation time, not dispatch time', async () => {
    vi.useFakeTimers()
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    let eta = 5_000 // Initially report no free slot to hold the partial batch.
    const seen: number[] = []
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 10, maxRetries: 0,
      dispatchGate: { nextDispatchEtaMs: () => eta },
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async (items, meta) => { seen.push(meta.startedAt); return items.map(i => `译:${i.text}`) },
    })
    const created = Date.now()
    const result = batch.enqueue({ text: 'A' })
    await vi.advanceTimersByTimeAsync(3_000) // Held for three seconds
    eta = 0
    await vi.advanceTimersByTimeAsync(1_500)
    expect(await result).toBe('译:A')
    // Before the fix, startedAt was approximately created + 3000, omitting the three seconds held by the gate.
    expect(seen[0]! - created).toBeLessThan(100)
    vi.useRealTimers()
  })

  it('near the deadline, skips backoff and requeueing and proceeds directly to individual fallback', async () => {
    vi.useFakeTimers()
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    let individual = 0
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 1, maxRetries: 3, maxTotalMs: 200,
      enableFallbackToIndividual: true,
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async () => [], // Mismatched result count
      executeIndividual: async item => { individual++; return `译:${item.text}` },
    })
    const result = batch.enqueue({ text: 'A' })
    // Minimum backoff is one second, exceeding the 200 ms budget; previously it slept first anyway.
    await vi.advanceTimersByTimeAsync(50)
    expect(await result).toBe('译:A')
    expect(individual).toBe(1)
    vi.useRealTimers()
  })

  it('shortening the total budget with setQueueOptions immediately expires overdue queued tasks while in-flight work retains its original budget', async () => {
    vi.useFakeTimers()
    const queue = new RequestQueue(opts({ rate: 1000, capacity: 100, maxConcurrent: 1, timeoutMs: 10_000, maxRetries: 0, maxTotalMs: 60_000 }))
    let released!: () => void
    const head = queue.enqueue(() => new Promise<string>(r => { released = () => r('head') }), Date.now(), 'head')
    const tail = queue.enqueue(async () => 'tail', Date.now(), 'tail')
    const tailSettled = expect(tail).rejects.toThrow(/total budget/)
    await vi.advanceTimersByTimeAsync(2_000)
    queue.setQueueOptions({ maxTotalMs: 1_000 }) // tail has waited two seconds and immediately exceeds the new budget.
    await vi.advanceTimersByTimeAsync(10)
    await tailSettled
    released()
    expect(await head).toBe('head') // In-flight work is unaffected.
    vi.useRealTimers()
  })
})

describe('held batches are released at their deadline (Codex #56, round 6)', () => {
  it('when maxTotalMs is shorter than the hold limit, dispatches at expiry instead of waiting 60 seconds', async () => {
    vi.useFakeTimers()
    const { BatchQueue } = await import('@/providers/request/batch-queue')
    let executed = 0
    const batch = new BatchQueue<{ text: string }, string>({
      maxCharactersPerBatch: 1000, maxItemsPerBatch: 10, batchDelay: 10, maxRetries: 0, maxTotalMs: 200,
      dispatchGate: { nextDispatchEtaMs: () => 5_000 }, // Always reports no free slot
      getBatchKey: () => 'k', getCharacters: i => i.text.length,
      executeBatch: async items => { executed++; return items.map(i => `译:${i.text}`) },
    })
    const result = batch.enqueue({ text: 'A' })
    await vi.advanceTimersByTimeAsync(150)
    expect(executed).toBe(0) // Still within budget; keep collecting.
    await vi.advanceTimersByTimeAsync(100)
    expect(executed).toBe(1) // Release at expiry; downstream handles deadlineAt.
    expect(await result).toBe('译:A')
    vi.useRealTimers()
  })
})
