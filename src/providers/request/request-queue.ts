// Ported from reference/read-frog/src/utils/request/request-queue.ts@9b44f82 (GPL-3.0), 2026-09-05, modified:
// deepmerge-ts replaced by object spread (QueueOptions is flat), the config schema by this directory's config.ts, the
// UUID by src/shared/uuid.ts, the timer type by ReturnType<typeof setTimeout> (@types/node is only transitive), and the
// timeout error given a name so the service layer can file it under timeout.
// Token-bucket rate limiting, timeout racing, retry / a 429 pause with a single probe after it / draining the queue on
// 401 / cancellation by scope; assembled by translate-service (DESIGN §8.2, §10).
import type { RequestRetryPolicy } from "./retry-policy"
import { getRandomUUID } from "@/shared/uuid"
import { requestQueueConfigSchema } from "./config"
import { TranslationCancelledError } from "./cancellation"
import { BinaryHeapPQ } from "./priority-queue"
import { defaultRequestRetryPolicy } from "./retry-policy"

/** Timeout errors are recognised by name (the same pattern as cancellation.ts); the service classifies them as timeout by it */
export const REQUEST_TIMEOUT_ERROR_NAME = "RequestTimeoutError"

/**
 * Added in this project (issue #43): the wait `nextDispatchEtaMs()` reports when the concurrency is saturated.
 * When a slot frees depends on when an in-flight request returns, with no lower bound to compute; a “not now, ask
 * again later” value is reported, so the batching gate keeps collecting instead of flushing small batches by
 * batchDelay. The exact number only affects the gate's re-asking rhythm (which has its own cap)
 */
export const SATURATED_DISPATCH_ETA_MS = 1000

/**
 * Added in this project (issue #43): after a timeout / cancellation, how long a concurrency slot is still held for a
 * thunk that has not ended. Our own providers all honour the signal and end within milliseconds of an abort; this
 * grace only guards against an implementation ignoring the signal locking the queue
 */
export const ABORT_GRACE_MS = 5_000

/** Object spread instead of deepmerge: a field explicitly passed as undefined must not wipe the existing value */
function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>
}

export interface RequestTask {
  id: string
  thunk: (signal?: AbortSignal) => Promise<any>
  promise: Promise<any>
  resolve: (value: any) => void
  reject: (error: any) => void
  scheduleAt: number
  createdAt: number
  retryCount: number
  // 429 retries spent on this task; a separate budget from retryCount (see
  // RequestRetryContext.rateLimitRetryCount).
  rateLimitRetryCount: number
  drained: boolean
  // Per-task timeout override; falls back to QueueOptions.timeoutMs. Large
  // LLM batches need proportionally more time than single requests.
  timeoutMs?: number
}

type QueuedRequestTask = RequestTask & {
  /** Added in this project: the enqueue time, for the maxTotalMs total-limit check (issue #43) */
  enqueuedAt: number
  /**
   * Added in this project (issue #43): an absolute deadline the caller gives, taking precedence over
   * `enqueuedAt + maxTotalMs`. A batch-level retry enqueues the same batch of text again and again, and this carries the
   * whole batch's deadline across, so the retries do not each take a full budget
   */
  deadlineAt?: number
  hash: string
  abortController?: AbortController
  // Cancellation scopes subscribed to this task. Dedup can attach several
  // (same hash from multiple tabs/sessions); the task is only cancelled when
  // its LAST scope is cancelled. `null` means an unscoped subscriber exists,
  // which pins the task as uncancellable.
  cancelScopes: Set<string> | null
}

export interface QueueOptions {
  rate: number // tokens/sec
  capacity: number // token bucket size
  timeoutMs: number
  maxRetries: number
  baseRetryDelayMs: number
  retryPolicy?: RequestRetryPolicy
  /**
   * Added in this project (issue #43): the cap on requests in flight at once. The token bucket governs **rate** only,
   * not concurrency — with slow responses the tokens refill and dispatch at rate as usual, and the number in flight is
   * bounded by the queue length alone (measured: at rate=1/capacity=1 three non-completing tasks were all in flight
   * together). A paper's dozens of batches hitting one endpoint at once invite 429 and hit the browser's connection
   * limit. Infinity by default (the ported behaviour unchanged), set explicitly by the caller
   */
  maxConcurrent?: number
  /**
   * Added in this project (issue #43): the total limit of one task from enqueue to final failure, across every retry
   * and rate-limit pause. `timeoutMs` governs one attempt only; under a lasting 429 the pause windows drag the total
   * to minutes (measured: not finished after 60 seconds), and what the caller needs is “after how long may I take this
   * batch as untranslatable”. Infinity by default (the ported behaviour unchanged)
   */
  maxTotalMs?: number
}

export class RequestQueue {
  private waitingQueue: BinaryHeapPQ<QueuedRequestTask>
  private waitingTasks = new Map<string, QueuedRequestTask>()
  private executingTasks = new Map<string, QueuedRequestTask>()
  /**
   * Added in this project (issue #43): the number of thunks really running. executingTasks cannot be counted directly —
   * `cancelWhere` takes a task out at once on cancellation, while an abort is cooperative and the thunk may still hold
   * its connection; dispatching by the map's size would let the concurrency exceed the cap (Codex on #56)
   */
  private activeExecutions = 0
  private nextScheduleTimer: ReturnType<typeof setTimeout> | null = null
  private retryPolicy: RequestRetryPolicy

  // token bucket
  private bucketTokens: number
  private lastRefill: number

  // rate-limit pause: no dispatching while Date.now() < pausedUntil. Set on a
  // 429 (pause-and-retry decision); the backlog stays intact instead of being
  // mass-rejected.
  private pausedUntil = 0
  // Pause windows since the last successful request; feeds the retry policy's
  // give-up cap (MAX_CONSECUTIVE_RATE_LIMIT_PAUSES).
  private consecutiveRateLimits = 0

  constructor(private options: QueueOptions) {
    // Validated at construction too: setQueueOptions goes through the same schema, and two entrances cannot guard one side only
    const { retryPolicy: _policy, ...validated } = options
    const parsed = requestQueueConfigSchema.safeParse(validated)
    if (parsed.error) {
      throw new Error(parsed.error.issues[0]!.message)
    }
    this.retryPolicy = options.retryPolicy ?? defaultRequestRetryPolicy
    this.bucketTokens = options.capacity
    this.lastRefill = Date.now()
    this.waitingQueue = new BinaryHeapPQ<QueuedRequestTask>()
  }

  enqueue<T>(
    thunk: (signal?: AbortSignal) => Promise<T>,
    scheduleAt: number,
    hash: string,
    scopes?: readonly string[],
    taskOptions?: { timeoutMs?: number; deadlineAt?: number },
  ): Promise<T> {
    const duplicateTask = this.duplicateTask(hash)
    if (duplicateTask) {
      // console.info(`🔄 Found duplicate task for hash: ${hash}, returning existing promise`)
      if (!scopes?.length) {
        duplicateTask.cancelScopes = null
      } else if (duplicateTask.cancelScopes !== null) {
        scopes.forEach((scope) => duplicateTask.cancelScopes!.add(scope))
      }
      return duplicateTask.promise
    }

    let resolve!: (value: T) => void
    let reject!: (error: Error) => void
    const promise = new Promise<T>((res, rej) => {
      resolve = res
      reject = rej
    })

    const task: QueuedRequestTask = {
      id: getRandomUUID(),
      hash,
      thunk,
      promise,
      resolve,
      reject,
      scheduleAt,
      enqueuedAt: Date.now(),
      createdAt: Date.now(),
      retryCount: 0,
      rateLimitRetryCount: 0,
      drained: false,
      timeoutMs: taskOptions?.timeoutMs,
      deadlineAt: taskOptions?.deadlineAt,
      cancelScopes: scopes?.length ? new Set(scopes) : null,
    }

    this.waitingTasks.set(hash, task)
    this.waitingQueue.push(task, scheduleAt)

    // console.info(`✅ Task ${task.id} added to queue. Queue size: ${this.waitingQueue.size()}, waiting: ${this.waitingTasks.size}, executing: ${this.executingTasks.size}`)

    this.schedule()
    return promise
  }

  setQueueOptions(options: Partial<QueueOptions>) {
    const { retryPolicy, ...queueOptions } = options
    const parseConfigStatus = requestQueueConfigSchema.partial().safeParse(queueOptions)
    if (parseConfigStatus.error) {
      throw new Error(parseConfigStatus.error.issues[0]!.message)
    }
    // Settle token accrual under the OLD rate before switching.
    this.refillTokens()
    this.options = { ...this.options, ...withoutUndefined(queueOptions) }
    if (retryPolicy) {
      this.retryPolicy = retryPolicy
    }
    // Added in this project (issue #43): maxConcurrent / maxTotalMs bind only dispatches and decisions **from here on**;
    // an attempt in flight finishes on the budget it had. A shortened budget reschedules at once, and a queued task already expired is reclaimed right away (Codex on #56)
    this.schedule()
    // Clamp, never refill-to-full: a capacity edit must not grant a free
    // burst, and repeated identical calls (config sync) must be no-ops.
    this.bucketTokens = Math.min(this.bucketTokens, this.options.capacity)
    // The pending timer's delay was computed under the old rate — recompute.
    this.schedule()
  }

  /**
   * Cancel every task subscribed to the given scope. Refcounted: a task shared
   * with another scope (dedup) or with an unscoped subscriber survives; only
   * tasks whose LAST scope this is are rejected/aborted (#1881).
   */
  cancelByScope(scopeKey: string): number {
    return this.cancelWhere((scope) => scope === scopeKey)
  }

  /**
   * Cancel every task all of whose scopes match the predicate. Unscoped tasks
   * (`cancelScopes === null`) never match.
   */
  cancelWhere(scopeMatches: (scopeKey: string) => boolean): number {
    let cancelled = 0

    const cancelMatchingScopes = (task: QueuedRequestTask): boolean => {
      if (task.cancelScopes === null) return false
      let matchedScope: string | undefined
      for (const scope of task.cancelScopes) {
        if (scopeMatches(scope)) {
          matchedScope = scope
          task.cancelScopes.delete(scope)
        }
      }
      if (matchedScope === undefined || task.cancelScopes.size > 0) return false
      this.rejectDrainedTask(task, new TranslationCancelledError(matchedScope))
      return true
    }

    for (const [hash, task] of [...this.waitingTasks]) {
      if (!cancelMatchingScopes(task)) continue
      this.waitingTasks.delete(hash)
      cancelled++
    }
    this.waitingQueue.removeWhere((task) => task.drained)

    for (const [hash, task] of [...this.executingTasks]) {
      if (!cancelMatchingScopes(task)) continue
      this.executingTasks.delete(hash)
      cancelled++
    }

    if (cancelled > 0) {
      this.schedule()
    }
    return cancelled
  }

  /**
   * Milliseconds until this queue could START one more (newly enqueued)
   * request: accounts for the rate-limit pause, available tokens, and the
   * requests already waiting ahead of it. 0 = a slot is available now.
   * Consumed by the BatchQueue's dispatch gate so batches keep filling while
   * dispatch is blocked instead of flushing tiny.
   */
  nextDispatchEtaMs(): number {
    this.refillTokens()
    const now = Date.now()
    const pauseDelayMs = Math.max(0, this.pausedUntil - now)
    const tokensNeeded = this.waitingQueue.size() + 1
    const tokenDelayMs =
      this.bucketTokens >= tokensNeeded
        ? 0
        : Math.ceil(((tokensNeeded - this.bucketTokens) / this.options.rate) * 1000)
    // Saturated concurrency is one more kind of “no new request can start now”; missed, the gate would take the slot for
    // ready and flush small batches by batchDelay (added in this project, issue #43)
    const concurrencyDelayMs = this.isSaturated() ? SATURATED_DISPATCH_ETA_MS : 0
    return Math.max(pauseDelayMs, tokenDelayMs, concurrencyDelayMs)
  }

  /** In flight at maxConcurrent: no new request can start now, and there is no wait to compute (added in this project, issue #43) */
  private isSaturated(): boolean {
    return this.activeExecutions >= (this.options.maxConcurrent ?? Number.POSITIVE_INFINITY)
  }

  /**
   * How many milliseconds remain of the task's total limit; Infinity without maxTotalMs (added in this project, issue
   * #43). Used before dispatch, for one attempt's timeout and when scheduling a retry, so the total really is held
   */
  private remainingBudgetMs(task: QueuedRequestTask, now: number): number {
    const budget = this.options.maxTotalMs
    if (task.deadlineAt !== undefined) return task.deadlineAt - now
    if (budget === undefined) return Number.POSITIVE_INFINITY
    return task.enqueuedAt + budget - now
  }

  /** Queued tasks already over their total budget: refused now, rather than left hanging through a rate-limit pause (added in this project, issue #43) */
  private reapExpired(now: number) {
    let reaped = false
    for (const [hash, task] of [...this.waitingTasks]) {
      if (this.remainingBudgetMs(task, now) > 0) continue
      this.waitingTasks.delete(hash)
      this.rejectDrainedTask(task, this.budgetExceededError(task))
      reaped = true
    }
    if (reaped) this.waitingQueue.removeWhere(task => task.drained)
  }

  /** How long until the earliest deadline among the queued tasks; Infinity with none (added in this project, issue #43) */
  private nextDeadlineDelayMs(now: number): number {
    let earliest = Number.POSITIVE_INFINITY
    for (const task of this.waitingTasks.values()) {
      earliest = Math.min(earliest, this.remainingBudgetMs(task, now))
    }
    return Math.max(0, earliest)
  }

  private budgetExceededError(task: QueuedRequestTask): Error {
    const error = new Error(`Task ${task.id} exceeded its ${this.options.maxTotalMs}ms total budget`)
    // Classified as timeout: the answer the caller wants is “this batch cannot be translated”, the same class as one attempt timing out
    error.name = REQUEST_TIMEOUT_ERROR_NAME
    return error
  }

  private schedule() {
    this.refillTokens()
    this.clearScheduleTimer()

    const startedAt = Date.now()
    // Expired queued tasks are reclaimed first: a rate-limit pause can last 5 minutes while their budget is 180 seconds,
    // and unreclaimed they would hang through the pause, far past the limit promised to the caller (added in this project, issue #43; Codex on #56)
    this.reapExpired(startedAt)

    const pauseRemainingMs = this.pausedUntil - startedAt
    if (pauseRemainingMs > 0) {
      if (this.waitingQueue.size() > 0) {
        // Woken by whichever comes first, the end of the pause or the earliest deadline
        this.armScheduleTimer(Math.min(pauseRemainingMs, this.nextDeadlineDelayMs(startedAt)))
      }
      return
    }

    while (this.bucketTokens >= 1 && this.waitingQueue.size() > 0 && !this.isSaturated()) {
      const now = Date.now()

      const task = this.waitingQueue.peek()
      if (task?.drained) {
        // Safety net: a drained task should have been removed from the heap,
        // but never dispatch or let one stall the timer computation below.
        this.waitingQueue.pop()
        this.waitingTasks.delete(task.hash)
        continue
      }
      if (task && task.scheduleAt <= now) {
        this.waitingQueue.pop()
        this.waitingTasks.delete(task.hash)
        // A task that waited too long behind the concurrency cap is over its total limit before it starts: no request
        // sent for nothing (added in this project, issue #43)
        if (this.remainingBudgetMs(task, now) <= 0) {
          task.reject(this.budgetExceededError(task))
          continue
        }
        this.executingTasks.set(task.hash, task)
        this.bucketTokens--
        this.activeExecutions++
        void this.executeTask(task)
      } else {
        break
      }
    }

    // With the concurrency saturated the timer is not armed on “may send”: the slots are held by in-flight requests,
    // the computed delay is 0, and it would spin at 0 ms until a request returned; schedule() is called again when one
    // ends. But **a deadline is a time event**, so even saturated it wakes at the earliest deadline to reclaim the expired (added in this project, issue #43)
    if (this.waitingQueue.size() > 0 && this.isSaturated()) {
      const deadlineDelayMs = this.nextDeadlineDelayMs(Date.now())
      if (Number.isFinite(deadlineDelayMs)) this.armScheduleTimer(deadlineDelayMs)
      return
    }

    if (this.waitingQueue.size() > 0) {
      const nextTask = this.waitingQueue.peek()
      if (nextTask) {
        const now = Date.now()
        const delayUntilScheduled = Math.max(0, nextTask.scheduleAt - now)
        const msUntilNextToken =
          this.bucketTokens >= 1
            ? 0
            : Math.ceil(((1 - this.bucketTokens) / this.options.rate) * 1000)
        const delay = Math.min(
          Math.max(delayUntilScheduled, msUntilNextToken),
          this.nextDeadlineDelayMs(now),
        )

        this.armScheduleTimer(delay)
      }
    }
  }

  /**
   * The bookkeeping of one rate-limit pause window: the pause deadline, the count of consecutive windows, the single
   * probe after recovery. Factored out because over-budget tasks have to record it too (added in this project, issue #43)
   */
  private applyRateLimitPause(pauseMs: number, now: number) {
    // Count one pause per pause WINDOW, not per failing sibling — with
    // capacity>1 several in-flight attempts can all 429 within milliseconds;
    // only the first (arriving un-paused) increments the consecutive counter,
    // the rest just extend the pause.
    if (now >= this.pausedUntil) {
      this.consecutiveRateLimits++
    }
    this.pausedUntil = Math.max(this.pausedUntil, now + pauseMs)
    // Post-pause probe: resume with at most one token so recovery sends a
    // single request first instead of bursting `capacity` requests at a
    // provider that may still be limited.
    this.bucketTokens = Math.min(this.bucketTokens, 1)
    this.lastRefill = now
  }

  private clearScheduleTimer() {
    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer)
      this.nextScheduleTimer = null
    }
  }

  private armScheduleTimer(delayMs: number) {
    this.nextScheduleTimer = setTimeout(() => {
      this.nextScheduleTimer = null
      this.schedule()
    }, delayMs)
  }

  private async executeTask(task: QueuedRequestTask) {
    // console.info(`🏃 Starting execution of task ${task.id} (attempt ${task.retryCount + 1}) at ${Date.now()}`)

    let timeoutId: ReturnType<typeof setTimeout> | null = null
    // The thunk's own Promise is kept: the timeout won a race, the thunk may still be running, and the concurrency slot
    // is returned only once it really ends (added in this project, issue #43; Codex on #56)
    let thunkPromise: Promise<unknown> | null = null
    const abortController = new AbortController()
    task.abortController = abortController
    // One attempt may not exceed the remaining total budget either: otherwise a 120-second attempt could start with 1
    // second of a 180-second budget left (added in this project, issue #43)
    const timeoutMs = Math.min(
      task.timeoutMs ?? this.options.timeoutMs,
      Math.max(1, this.remainingBudgetMs(task, Date.now())),
    )

    try {
      // Create a timeout promise
      const timeoutPromise = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          // console.info(`⏰ Task ${task.id} timed out after ${timeoutMs}ms`)
          const timeoutError = new Error(`Task ${task.id} timed out after ${timeoutMs}ms`)
          timeoutError.name = REQUEST_TIMEOUT_ERROR_NAME
          // Reject before aborting: the race must settle with the timeout error
          // (which the retry policy treats as retryable), not with whatever abort
          // error the cancelled thunk rejects with.
          reject(timeoutError)
          abortController.abort(timeoutError)
        }, timeoutMs)
      })

      // Race between the actual task and timeout; the signal cancels the
      // in-flight attempt on timeout so a retry never runs concurrently with it
      thunkPromise = task.thunk(abortController.signal)
      // With the timeout winning nobody listens to the thunk's rejection any more; an empty catch keeps it from counting as unhandled
      thunkPromise.catch(() => undefined)
      const result = await Promise.race([thunkPromise, timeoutPromise])

      // Clear timeout if task completed successfully
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      // console.info(`✅ Task ${task.id} completed successfully at ${Date.now()}`)
      // Any completed request proves the provider recovered from rate limiting.
      this.consecutiveRateLimits = 0
      if (!task.drained) {
        task.resolve(result)
      }
    } catch (error) {
      // Clear timeout if it hasn't fired yet
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }

      // console.error(`❌ Task ${task.id} failed at ${Date.now()}:`, error)

      if (task.drained) {
        return
      }

      const now = Date.now()
      const decision = this.retryPolicy.decide(error, {
        retryCount: task.retryCount,
        maxRetries: this.options.maxRetries,
        baseRetryDelayMs: this.options.baseRetryDelayMs,
        now,
        rateLimitRetryCount: task.rateLimitRetryCount,
        consecutiveRateLimits: this.consecutiveRateLimits,
      })

      // The total limit governs “after how long may this batch be taken as untranslatable”, so the question is **whether the
      // next attempt can finish within the budget**, not “is it over now” — a 300-second Retry-After would otherwise be
      // scheduled with milliseconds of budget left, and wake minutes past the timeout (added in this project, issue #43; Codex on #56)
      const remainingMs = this.remainingBudgetMs(task, now)
      const nextDelayMs = decision.action === "retry"
        ? decision.delayMs
        : decision.action === "pause-and-retry"
          ? Math.max(decision.pauseMs, this.pausedUntil - now)
          : 0
      if (decision.action !== "fail" && remainingMs - nextDelayMs <= 0) {
        // This one is at its deadline, but the queue-level rate-limit cool-down is recorded all the same: otherwise the
        // schedule() in finally would push the remaining backlog at once at an endpoint that just answered 429 (Codex on #56)
        if (decision.action === "pause-and-retry") this.applyRateLimitPause(decision.pauseMs, now)
        // The last real error (rate limit / network) is reported rather than “over budget”: the fallback chain decides by it whether to change engine
        task.reject(error)
      } else if (decision.action === "retry") {
        task.retryCount++
        // Schedule retry
        const retryAt = now + decision.delayMs
        task.scheduleAt = retryAt

        // console.warn(`🔄 Retrying task ${task.id} (attempt ${task.retryCount}/${this.options.maxRetries}) after ${Math.round(decision.delayMs)}ms`)

        // Move task back to waiting queue for retry
        this.waitingTasks.set(task.hash, task)
        this.waitingQueue.push(task, retryAt)
        this.schedule()
      } else if (decision.action === "pause-and-retry") {
        // Rate limited: pause dispatching and re-enqueue the task instead of
        // draining the backlog. Count one pause per pause WINDOW, not per
        // failing sibling — with capacity>1 several in-flight attempts can all
        // 429 within milliseconds; only the first (arriving un-paused)
        // increments the consecutive counter, the rest just extend the pause.
        this.applyRateLimitPause(decision.pauseMs, now)
        task.rateLimitRetryCount++
        task.scheduleAt = this.pausedUntil
        this.waitingTasks.set(task.hash, task)
        this.waitingQueue.push(task, task.scheduleAt)
        this.schedule()
      } else {
        // Max retries exceeded, reject the promise
        // console.error(`💀 Task ${task.id} failed permanently after ${this.options.maxRetries} retries`)
        if (decision.failQueue) {
          this.failCurrentBacklog(error)
        } else {
          task.reject(error)
        }
      }
    } finally {
      // Ensure timeout is always cleared
      if (timeoutId) {
        clearTimeout(timeoutId)
      }

      if (task.abortController === abortController) {
        task.abortController = undefined
      }

      if (this.executingTasks.get(task.hash) === task) {
        this.executingTasks.delete(task.hash)
      }
      this.releaseWhenSettled(thunkPromise)
    }
  }

  /**
   * Return one concurrency slot. Waited for the thunk's own end — a timeout and a cancellation are both aborts, and
   * an abort is cooperative; returned at once, the replacement request would stack on the one still running. The grace
   * period is the safety net: with an implementation that ignores the signal, briefly exceeding the cap beats a queue locked by a few hung requests (added in this project, issue #43)
   */
  private releaseWhenSettled(thunk: Promise<unknown> | null) {
    // A thunk throwing synchronously leaves no Promise to wait for; the slot is returned at once. The timer is declared
    // first: a release() before the const is initialised would hit the temporal dead zone and the slot would never come back (Codex on #56)
    let graceTimer: ReturnType<typeof setTimeout> | undefined
    let released = false
    const release = () => {
      if (released) return
      released = true
      if (graceTimer !== undefined) clearTimeout(graceTimer)
      this.activeExecutions--
      this.schedule()
    }
    if (!thunk) {
      release()
      return
    }
    graceTimer = setTimeout(release, ABORT_GRACE_MS)
    thunk.then(release, release)
  }

  private duplicateTask(hash: string) {
    const duplicateTask = this.waitingTasks.get(hash) ?? this.executingTasks.get(hash)
    if (duplicateTask) {
      return duplicateTask
    }
    return undefined
  }

  private failCurrentBacklog(error: unknown) {
    // A fresh user retry after this mass-fail gets a fresh pause budget, but
    // pausedUntil is kept: new enqueues still respect the provider's cooldown.
    this.consecutiveRateLimits = 0
    if (this.nextScheduleTimer) {
      clearTimeout(this.nextScheduleTimer)
      this.nextScheduleTimer = null
    }

    for (const task of this.waitingTasks.values()) {
      this.rejectDrainedTask(task, error)
    }
    this.waitingTasks.clear()
    this.waitingQueue.clear()

    for (const task of this.executingTasks.values()) {
      this.rejectDrainedTask(task, error)
    }
    this.executingTasks.clear()
  }

  private rejectDrainedTask(task: QueuedRequestTask, error: unknown) {
    if (task.drained) {
      return
    }

    task.drained = true
    task.reject(error)
    task.abortController?.abort(error)
  }

  private refillTokens() {
    const now = Date.now()
    const timeSinceLastRefill = now - this.lastRefill
    const tokensToAdd = (timeSinceLastRefill / 1000) * this.options.rate
    this.bucketTokens = Math.min(this.bucketTokens + tokensToAdd, this.options.capacity)

    // if (tokensToAdd > 0.01) { // Only log if meaningful tokens were added
    //   console.log(`🪣 Token bucket refilled: ${oldTokens.toFixed(2)} -> ${this.bucketTokens.toFixed(2)} (+${tokensToAdd.toFixed(2)}) after ${timeSinceLastRefill}ms`)
    // }

    this.lastRefill = now
  }
}
