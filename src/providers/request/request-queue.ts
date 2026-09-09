// Ported from reference/read-frog/src/utils/request/request-queue.ts@9b44f82 (GPL-3.0), 2026-09-05; modified:
// Replaced deepmerge-ts with object spread (QueueOptions is flat), schema with local config.ts, and UUID with src/shared/uuid.ts.
// Timer types use ReturnType<typeof setTimeout> (@types/node is transitive); timeout errors have a name for service-layer classification.
// Token bucket, timeout races, retries, 429 pauses/single recovery probe, 401 queue drain and scope cancellation; wired by translate-service (DESIGN §8.2, §10).
import type { RequestRetryPolicy } from "./retry-policy"
import { getRandomUUID } from "@/shared/uuid"
import { requestQueueConfigSchema } from "./config"
import { TranslationCancelledError } from "./cancellation"
import { BinaryHeapPQ } from "./priority-queue"
import { defaultRequestRetryPolicy } from "./retry-policy"

/** Timeout errors are identified by name (as in cancellation.ts), allowing service-layer timeout classification. */
export const REQUEST_TIMEOUT_ERROR_NAME = "RequestTimeoutError"

/**
 * Project addition (issue #43): wait reported by nextDispatchEtaMs() when concurrency is full.
 * Slot availability depends on in-flight completion, so no lower bound is known. Report "not now; ask later"
 * so the batch gate keeps accumulating instead of flushing small batches at batchDelay. This value only affects bounded recheck cadence.
 */
export const SATURATED_DISPATCH_ETA_MS = 1000

/**
 * Project addition (issue #43): how long to retain a concurrency slot for an unfinished thunk after timeout/cancellation.
 * Our providers honor signals and finish within milliseconds of abort; this grace period prevents non-cooperative implementations from deadlocking the queue.
 */
export const ABORT_GRACE_MS = 5_000

/** Object spread replacing deepmerge: explicit undefined fields must not overwrite existing values. */
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
  /** Project addition: enqueue time for the maxTotalMs deadline (issue #43). */
  enqueuedAt: number
  /**
   * Project addition (issue #43): caller-supplied absolute deadline, overriding enqueuedAt + maxTotalMs.
   * Batch retries re-enqueue the same texts; carry their shared deadline so each attempt cannot claim a full new budget.
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
   * Project addition (issue #43): concurrency cap. Token buckets limit rate, not concurrent execution.
   * Slow responses still replenish tokens and dispatch work, so in-flight count is limited only by queued task count (three never-finishing tasks
   * ran concurrently with rate=1/capacity=1). Dozens of batches from one paper can invite 429s and exhaust browser connections.
   * Defaults to Infinity, preserving upstream behavior; callers set an explicit limit.
   */
  maxConcurrent?: number
  /**
   * Project addition (issue #43): total time from enqueue to final failure, across retries and rate-limit pauses.
   * timeoutMs limits only one attempt; persistent 429 pauses can extend total time into minutes (observed unfinished after 60s).
   * Callers need a bound on when to consider the batch failed. Defaults to Infinity, preserving upstream behavior.
   */
  maxTotalMs?: number
}

export class RequestQueue {
  private waitingQueue: BinaryHeapPQ<QueuedRequestTask>
  private waitingTasks = new Map<string, QueuedRequestTask>()
  private executingTasks = new Map<string, QueuedRequestTask>()
  /**
   * Project addition (issue #43): actual running thunk count. executingTasks is insufficient because cancelWhere
   * removes tasks immediately, while cooperative abort may leave the thunk holding a connection. Counting the map would exceed concurrency
   * (Codex #56).
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
    // Validate construction too: setQueueOptions uses the same schema; both entry points need protection.
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
    // Project addition (issue #43): maxConcurrent/maxTotalMs changes affect future dispatch and checks only.
    // In-flight attempts keep their original budgets. Reschedule immediately after shorter limits to reject expired queued tasks (Codex #56).
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
    // Full concurrency also means no request can start now; omitting this makes the batch gate flush small batches at batchDelay.
    // Project addition (issue #43).
    const concurrencyDelayMs = this.isSaturated() ? SATURATED_DISPATCH_ETA_MS : 0
    return Math.max(pauseDelayMs, tokenDelayMs, concurrencyDelayMs)
  }

  /** Concurrency is at maxConcurrent: no request can start now, with no computable wait (project addition, issue #43). */
  private isSaturated(): boolean {
    return this.activeExecutions >= (this.options.maxConcurrent ?? Number.POSITIVE_INFINITY)
  }

  /**
   * Remaining total task budget in milliseconds; Infinity if maxTotalMs is unset (project addition, issue #43).
   * Used before dispatch, for attempt timeout and when scheduling retries to bound the actual total time.
   */
  private remainingBudgetMs(task: QueuedRequestTask, now: number): number {
    const budget = this.options.maxTotalMs
    if (task.deadlineAt !== undefined) return task.deadlineAt - now
    if (budget === undefined) return Number.POSITIVE_INFINITY
    return task.enqueuedAt + budget - now
  }

  /** Reject expired queued tasks now rather than leaving them pending during a rate-limit pause (project addition, issue #43). */
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

  /** Time until the earliest queued deadline; Infinity if none (project addition, issue #43). */
  private nextDeadlineDelayMs(now: number): number {
    let earliest = Number.POSITIVE_INFINITY
    for (const task of this.waitingTasks.values()) {
      earliest = Math.min(earliest, this.remainingBudgetMs(task, now))
    }
    return Math.max(0, earliest)
  }

  private budgetExceededError(task: QueuedRequestTask): Error {
    const error = new Error(`Task ${task.id} exceeded its ${this.options.maxTotalMs}ms total budget`)
    // Classify as timeout: callers need to know the batch cannot complete, just as for an attempt timeout.
    error.name = REQUEST_TIMEOUT_ERROR_NAME
    return error
  }

  private schedule() {
    this.refillTokens()
    this.clearScheduleTimer()

    const startedAt = Date.now()
    // Reject expired queued tasks first: rate-limit pauses can last five minutes while their budget is only 180s.
    // Leaving them pending would violate the caller's deadline (project addition, issue #43; Codex #56).
    this.reapExpired(startedAt)

    const pauseRemainingMs = this.pausedUntil - startedAt
    if (pauseRemainingMs > 0) {
      if (this.waitingQueue.size() > 0) {
        // Wake for whichever comes first: pause end or the earliest deadline.
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
        // Tasks waiting behind the concurrency cap may expire before starting; do not send a wasted request.
        // Project addition (issue #43).
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

    // Do not schedule an immediate dispatch timer at full concurrency: occupied slots yield delay 0,
    // causing a busy loop until a request completes; completion will call schedule() again.
    // Deadlines are time events, however: wake at the earliest even when full to reject expired tasks (project addition, issue #43).
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
   * Account for a rate-limit pause window: its end, consecutive-window count and single recovery probe.
   * Extracted because tasks that exceed their budget must record the pause too (project addition, issue #43).
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
    // Retain the thunk's own Promise: a timeout may win the race while the thunk is still running.
    // Return its concurrency slot only after it actually finishes (project addition, issue #43; Codex #56).
    let thunkPromise: Promise<unknown> | null = null
    const abortController = new AbortController()
    task.abortController = abortController
    // An attempt must fit the remaining total budget; a 120s attempt cannot start with 1s left out of 180s.
    // Project addition (issue #43).
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
      // If timeout wins, nobody else observes thunk rejection; attach an empty catch to prevent an unhandled rejection.
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

      // The deadline bounds when callers can consider a batch failed, so check whether the next attempt fits the budget,
      // not just whether time has already expired. A 300s Retry-After accepted with milliseconds left
      // would wake minutes past the deadline (project addition, issue #43; Codex #56).
      const remainingMs = this.remainingBudgetMs(task, now)
      const nextDelayMs = decision.action === "retry"
        ? decision.delayMs
        : decision.action === "pause-and-retry"
          ? Math.max(decision.pauseMs, this.pausedUntil - now)
          : 0
      if (decision.action !== "fail" && remainingMs - nextDelayMs <= 0) {
        // This task expired, but still record queue-wide rate-limit cooldown; otherwise finally's schedule()
        // would immediately flood the endpoint that just returned 429 with the remaining backlog (Codex #56).
        if (decision.action === "pause-and-retry") this.applyRateLimitPause(decision.pauseMs, now)
        // Report the last actual rate-limit/network error instead of budget expiry so fallback can decide whether to switch engines.
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
   * Return one concurrency slot after the thunk finishes. Timeout/cancellation only abort cooperatively;
   * immediate release would overlap the replacement with the still-running request. Grace-period fallback permits a brief overrun
   * for implementations that ignore signals rather than let a few hung requests deadlock the queue (project addition, issue #43).
   */
  private releaseWhenSettled(thunk: Promise<unknown> | null) {
    // A synchronous thunk throw leaves no Promise to await; release immediately. Declare the timer first:
    // calling release() before const initialization hits the temporal dead zone and leaks the slot forever (Codex #56).
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
