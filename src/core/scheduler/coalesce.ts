// Coalescing consecutive events (DESIGN §10): debounce plus a “longest wait”.
//
// A plain debounce starves under a stream of events: a translation in progress delivers dozens of progress callbacks
// a second, the 150ms timer keeps being reset, and side mode's mirrors / split figures / table fitting run once,
// when the whole paper is done — measured on 2312.17141: all 413 mirrors appeared together at the very end, the
// formulas centred across both columns until then (the owner's feedback). With the longest wait, however dense the
// events, it runs at least once per maxWait.

export interface CoalesceOptions {
  /** How long to wait after the last event */
  delay: number
  /** How long at most from the first unhandled event */
  maxWait: number
}

export interface Coalescer<T = never> {
  /**
   * Schedule a tidy. With an argument = add this item to the round's dirty set; without = this round is **full**.
   * Once a round has seen a call without an argument, the run gets null and the dirty set is void
   */
  schedule(item?: T): void
  cancel(): void
}

/**
 * `run` receives the items collected in this round (deduplicated, in order of addition), or null for a full pass
 * (issue #46). Items are collected, not only “whether to run”: the coalescer squeezes dozens of progress callbacks
 * into one pass, and the tidy steps have to know which blocks that pass touches, or every pass re-scans the whole
 * paper — measured on 2312.17141: 31 passes in one session, 1.9 seconds in all, 34 ms for a single pass
 */
export function createCoalescer<T = never>(run: (scope: T[] | null) => void, { delay, maxWait }: CoalesceOptions): Coalescer<T> {
  let timer = 0
  let firstPending = 0
  let items = new Set<T>()
  let full = false

  const fire = () => {
    timer = 0
    firstPending = 0
    const scope = full ? null : Array.from(items)
    items = new Set()
    full = false
    run(scope)
  }

  return {
    schedule(item?: T) {
      if (item === undefined) full = true
      else items.add(item)
      const now = Date.now()
      if (!firstPending) firstPending = now
      clearTimeout(timer)
      // No further postponing: run at the moment the longest wait expires
      const wait = Math.max(0, Math.min(delay, firstPending + maxWait - now))
      timer = window.setTimeout(fire, wait)
    },
    cancel() {
      clearTimeout(timer)
      timer = 0
      firstPending = 0
      items = new Set()
      full = false
    },
  }
}
