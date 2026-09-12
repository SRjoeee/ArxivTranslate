import { createLazyScheduler, type LazyScheduler, type PreloadOptions } from '@/core/scheduler/lazy'

// The bookkeeping the text run and the image run share (ADR-0006): what each target is up to, whether the run may
// still work, the permanent-error record, the viewport scheduler, and the counts both progress shapes are built
// from. What a run does with a target — render, batch, fetch, park — stays in the run.

export type Outcome = 'waiting' | 'requested' | 'done' | 'failed'

/** The counts both runs report; the text run adds `state`, `inFlight` and `cached` on top */
export interface RunProgress {
  total: number
  /** Entered the viewport (or handed over by hand) and asked for */
  requested: number
  done: number
  failed: number
  /** A permanent error (no-key / auth): nothing new is requested after it */
  fatal?: string
}

export interface LedgerDeps<T extends { el: Element }> {
  preload: PreloadOptions
  /** What the scheduler hands over as targets enter the viewport — the run's own `translate` */
  onEnter: (targets: T[]) => void
  /** The session is still the current one; the image run asks the session, the text run is stopped by it instead */
  isCurrent?: () => boolean
  /** A permanent error was just recorded: the run's consequence beyond the scheduler stopping (the image run fails the rest) */
  onFatal?: () => void
  /** The run was stopped: its clean-up beyond the scheduler stopping (pending nodes, a parked set, a queue) */
  onStop?: () => void
}

export interface RunLedger<T extends { el: Element }> {
  /** Start observing the viewport. The text run does it after its sliced marking, the image run at once */
  observe(): void
  /**
   * The targets the run may take now: known, not yet requested and — when a gate is given — admitted. `taken`
   * are claimed from the scheduler (it will not hand them over again); `held` are the fresh ones the gate refused,
   * for the run to park. Nothing when the run is halted
   */
  intake(picked: T[], admit?: (target: T) => boolean): { taken: T[]; held: T[] }
  /** Mark targets requested: the text run does it per batch as it renders the pending nodes, the image run at intake */
  request(targets: T[]): void
  settle(target: T, outcome: 'done' | 'failed', reason?: string): void
  outcomeOf(target: T): Outcome | undefined
  reasonOf(target: T): string | undefined
  /** Record a permanent error once and stop the scheduler; true when this call recorded it */
  fatal(kind: string, message: string): boolean
  fatalReason(): string | undefined
  /** Stopped, a permanent error recorded, or the session gone: nothing further is requested, rendered or reported */
  halted(): boolean
  stopped(): boolean
  stop(): void
  progress(): RunProgress
  /** Targets in a state, in document order */
  inState(state: Outcome): T[]
  /** Targets that failed, in document order — the popup's "retry failed" hands them back to the run */
  failed(): T[]
}

export function createRunLedger<T extends { el: Element }>(targets: readonly T[], deps: LedgerDeps<T>): RunLedger<T> {
  const outcome = new Map<T, Outcome>(targets.map(target => [target, 'waiting']))
  const reasons = new Map<T, string>()
  let fatal: string | undefined
  let stopped = false
  let scheduler: LazyScheduler<T> | null = null

  const halted = () => stopped || fatal !== undefined || deps.isCurrent?.() === false

  return {
    observe() {
      if (halted() || scheduler) return
      scheduler = createLazyScheduler([...targets], { ...deps.preload, onEnter: deps.onEnter })
    },
    intake(picked, admit) {
      if (halted()) return { taken: [], held: [] }
      const fresh = picked.filter(target => outcome.has(target) && outcome.get(target) !== 'requested')
      const taken = admit ? fresh.filter(admit) : fresh
      const held = admit ? fresh.filter(target => !taken.includes(target)) : []
      if (taken.length > 0) scheduler?.claim(taken)
      return { taken, held }
    },
    request(picked) {
      for (const target of picked) outcome.set(target, 'requested')
    },
    settle(target, state, reason) {
      outcome.set(target, state)
      if (reason !== undefined) reasons.set(target, reason)
      else reasons.delete(target)
    },
    outcomeOf: target => outcome.get(target),
    reasonOf: target => reasons.get(target),
    fatal(kind, message) {
      if (fatal !== undefined) return false
      fatal = `${kind}: ${message}`
      // A configuration error stays one: disconnecting keeps the viewport from queueing what would fail the same way
      scheduler?.disconnect()
      deps.onFatal?.()
      return true
    },
    fatalReason: () => fatal,
    halted,
    stopped: () => stopped,
    stop() {
      if (stopped) return
      stopped = true
      scheduler?.disconnect()
      deps.onStop?.()
    },
    progress() {
      let requested = 0
      let done = 0
      let failed = 0
      for (const state of outcome.values()) {
        if (state === 'waiting') continue
        requested++
        if (state === 'done') done++
        else if (state === 'failed') failed++
      }
      return { total: outcome.size, requested, done, failed, ...(fatal !== undefined ? { fatal } : {}) }
    },
    inState: state => targets.filter(target => outcome.get(target) === state),
    failed: () => targets.filter(target => outcome.get(target) === 'failed'),
  }
}
