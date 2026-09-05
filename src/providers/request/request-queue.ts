// 移植自 reference/read-frog/src/utils/request/request-queue.ts@9b44f82（GPL-3.0），2026-09-05 移植、有修改：
// deepmerge-ts 换成对象展开（QueueOptions 是平的）、配置 schema 换成本目录 config.ts、UUID 换成 src/shared/uuid.ts、
// 计时器类型改 ReturnType<typeof setTimeout>（@types/node 只是传递依赖）、超时错误加 name 便于服务层归到 timeout。
// 令牌桶限速 + 超时竞速 + 重试 / 429 暂停与暂停后单探针 / 401 排空整队 / 按 scope 取消；由 translate-service 组装（DESIGN §8.2、§10）。
import type { RequestRetryPolicy } from "./retry-policy"
import { getRandomUUID } from "@/shared/uuid"
import { requestQueueConfigSchema } from "./config"
import { TranslationCancelledError } from "./cancellation"
import { BinaryHeapPQ } from "./priority-queue"
import { defaultRequestRetryPolicy } from "./retry-policy"

/** 超时错误按 name 识别（与 cancellation.ts 同一模式），服务层据此归到 timeout */
export const REQUEST_TIMEOUT_ERROR_NAME = "RequestTimeoutError"

/**
 * 本项目新增（issue #43）：并发满载时 `nextDispatchEtaMs()` 报的等待时长。
 * 槽位什么时候空出来取决于在飞请求何时返回，没有下界可算；这里报一个「不是现在、稍后再问」的值，
 * 让攒批门闸继续攒而不是按 batchDelay 冲小批。具体数值只影响门闸的重问节奏（它自己有上限）
 */
export const SATURATED_DISPATCH_ETA_MS = 1000

/**
 * 本项目新增（issue #43）：超时 / 取消之后，还愿意为一个尚未结束的 thunk 保留并发额度多久。
 * 我们自己的 provider 都认 signal，abort 后毫秒级就结束；这道宽限只防「实现不认 signal」把队列锁死
 */
export const ABORT_GRACE_MS = 5_000

/** 对象展开代替 deepmerge：显式传 undefined 的字段不能把已有值冲掉 */
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
  /** 本项目新增：入队时刻，用于 maxTotalMs 的总时限判断（issue #43） */
  enqueuedAt: number
  /**
   * 本项目新增（issue #43）：调用方给定的绝对截止时刻，优先于 `enqueuedAt + maxTotalMs`。
   * 批级重试会为同一批文本反复入队，用它把整批的期限带过去，重试才不会各拿一份完整预算
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
   * 本项目新增（issue #43）：同时在飞的上限。令牌桶只管**速率**，不管并发——
   * 响应一慢，令牌照常按 rate 补充并派发，在飞数只受排队任务数限制（实测 rate=1/capacity=1 时
   * 三个不完成的任务全部同时在飞）。一篇论文几十个批次同时打向同一个端点会招致 429、
   * 撞浏览器的连接上限。默认 Infinity（不改移植原行为），由调用方显式设定
   */
  maxConcurrent?: number
  /**
   * 本项目新增（issue #43）：单个任务从入队到最终失败的总时限，跨所有重试与限流暂停。
   * `timeoutMs` 只管单次尝试；持续 429 时暂停窗口会把总时长拖到分钟级（实测 60 秒还没结束），
   * 而调用方需要的是「多久之后我可以认为这批翻不出来了」。默认 Infinity（不改移植原行为）
   */
  maxTotalMs?: number
}

export class RequestQueue {
  private waitingQueue: BinaryHeapPQ<QueuedRequestTask>
  private waitingTasks = new Map<string, QueuedRequestTask>()
  private executingTasks = new Map<string, QueuedRequestTask>()
  /**
   * 本项目新增（issue #43）：真正在跑的 thunk 数。不能直接数 executingTasks——`cancelWhere` 取消时
   * 立刻把任务摘出去，而 abort 是协作式的，thunk 可能还在占着连接；照 map 的大小放行会让并发超上限
   * （Codex 在 #56 指出）
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
    // 构造时也校验：setQueueOptions 走的是同一张 schema，两条入口不能只守一边
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
    // 本项目新增（issue #43）：maxConcurrent / maxTotalMs 只约束**此后**的派发与判定；
    // 在飞的尝试按当时的预算跑完。缩短预算时立刻重排一次，排队中已过期的马上回收（Codex 在 #56 指出）
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
    // 并发满载也是「现在起不了新请求」的一种，漏掉它门闸会以为槽位就绪、按 batchDelay 冲小批
    // （本项目新增，issue #43）
    const concurrencyDelayMs = this.isSaturated() ? SATURATED_DISPATCH_ETA_MS : 0
    return Math.max(pauseDelayMs, tokenDelayMs, concurrencyDelayMs)
  }

  /** 在飞数已达 maxConcurrent：此刻不能再起新请求，且没有可算的等待时长（本项目新增，issue #43） */
  private isSaturated(): boolean {
    return this.activeExecutions >= (this.options.maxConcurrent ?? Number.POSITIVE_INFINITY)
  }

  /**
   * 距任务总时限还剩多少毫秒；没设 maxTotalMs 就是 Infinity（本项目新增，issue #43）。
   * 派发前、单次尝试的超时、安排重试三处都用它，总时长才真的被兜住
   */
  private remainingBudgetMs(task: QueuedRequestTask, now: number): number {
    const budget = this.options.maxTotalMs
    if (task.deadlineAt !== undefined) return task.deadlineAt - now
    if (budget === undefined) return Number.POSITIVE_INFINITY
    return task.enqueuedAt + budget - now
  }

  /** 排队中已经超出总预算的任务：现在拒掉，不让它在限流暂停里继续挂着（本项目新增，issue #43） */
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

  /** 排队任务里最早的期限还有多久到；没有期限就是 Infinity（本项目新增，issue #43） */
  private nextDeadlineDelayMs(now: number): number {
    let earliest = Number.POSITIVE_INFINITY
    for (const task of this.waitingTasks.values()) {
      earliest = Math.min(earliest, this.remainingBudgetMs(task, now))
    }
    return Math.max(0, earliest)
  }

  private budgetExceededError(task: QueuedRequestTask): Error {
    const error = new Error(`Task ${task.id} exceeded its ${this.options.maxTotalMs}ms total budget`)
    // 归到 timeout：调用方要的答案是「这批翻不出来了」，与单次超时同一类
    error.name = REQUEST_TIMEOUT_ERROR_NAME
    return error
  }

  private schedule() {
    this.refillTokens()
    this.clearScheduleTimer()

    const startedAt = Date.now()
    // 先回收已经过期的排队任务：限流暂停可能长达 5 分钟，而它们的预算只有 180 秒，
    // 不回收就会在暂停里一直挂着，远超对调用方承诺的时限（本项目新增，issue #43；Codex 在 #56 指出）
    this.reapExpired(startedAt)

    const pauseRemainingMs = this.pausedUntil - startedAt
    if (pauseRemainingMs > 0) {
      if (this.waitingQueue.size() > 0) {
        // 暂停结束与最早的期限，哪个先到就先醒
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
        // 排在并发上限后面等太久的任务，起跑前就已经超了总时限：不要白发一次请求
        // （本项目新增，issue #43）
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

    // 并发满载时不按「可以发了」武装定时器：槽位是被在飞请求占着的，算出来的 delay 是 0，
    // 会一直以 0 毫秒空转直到有请求返回；执行结束时会再调一次 schedule()。
    // 但**期限是时间事件**，满载时也要按最早的期限醒来把过期的回收掉（本项目新增，issue #43）
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
   * 一个限流暂停窗口的记账：暂停到点、连续窗口计数、恢复后的单探针。
   * 抽出来是因为超预算的任务也要记（本项目新增，issue #43）
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
    // 拿住 thunk 自己的 Promise：超时是竞速赢来的，thunk 那边可能还在跑，
    // 并发额度要等它真的结束再还（本项目新增，issue #43；Codex 在 #56 指出）
    let thunkPromise: Promise<unknown> | null = null
    const abortController = new AbortController()
    task.abortController = abortController
    // 单次尝试也不许超出剩余总预算：否则 120 秒的一次尝试可以在 180 秒预算只剩 1 秒时开跑
    // （本项目新增，issue #43）
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
      // 超时先赢的话没人再监听 thunk 的拒绝，挂个空 catch 免得算作未处理拒绝
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

      // 总时限管的是「多久之后可以认为这批翻不出来」，所以判的是**下一次尝试能否在预算内跑完**，
      // 而不是「此刻是否已经超了」——300 秒的 Retry-After 在预算只剩几毫秒时照样会被排进去，
      // 等它醒来早已超时几分钟（本项目新增，issue #43；Codex 在 #56 指出）
      const remainingMs = this.remainingBudgetMs(task, now)
      const nextDelayMs = decision.action === "retry"
        ? decision.delayMs
        : decision.action === "pause-and-retry"
          ? Math.max(decision.pauseMs, this.pausedUntil - now)
          : 0
      if (decision.action !== "fail" && remainingMs - nextDelayMs <= 0) {
        // 这一条到点了，但队列层面的限流冷却照记：否则 finally 里的 schedule() 会立刻把余下的
        // 积压全推向一个刚刚喊过 429 的端点（Codex 在 #56 指出）
        if (decision.action === "pause-and-retry") this.applyRateLimitPause(decision.pauseMs, now)
        // 上报最后一次的真实错误（限流 / 网络）而不是「超预算」：降级链据此判断要不要换引擎
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
   * 还回一个并发额度。等 thunk 自己结束再还——超时与取消都是 abort，而 abort 是协作式的，
   * 立刻还额度会让替补请求与还在跑的那个叠在一起。宽限期兜底：真有不认 signal 的实现时，
   * 宁可短暂超一点上限，也不能让队列被几个挂死的请求锁死（本项目新增，issue #43）
   */
  private releaseWhenSettled(thunk: Promise<unknown> | null) {
    // thunk 同步抛出时没有 Promise 可等，立刻还额度。定时器要先声明：
    // 在 const 初始化之前调用 release() 会撞暂时性死区，额度就永远还不回来（Codex 在 #56 指出）
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
