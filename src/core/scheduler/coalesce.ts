// Coalesce consecutive events (DESIGN §10): debounce with a maximum wait.
//
// Continuous events starve a plain debounce: dozens of progress callbacks per second keep resetting the 150 ms timer.
// Side-mode mirroring / figure splitting / table fitting would run only after all translations finished. In 2312.17141,
// all 413 mirrors appeared at the end; until then formulas stayed centered across both columns (user report).
// A maximum wait guarantees a run at least every maxWait, even with continuous events.

export interface CoalesceOptions {
  /** Wait after the last event. */
  delay: number
  /** Maximum wait since the first unprocessed event. */
  maxWait: number
}

export interface Coalescer<T = never> {
  /**
   * Schedule cleanup. With an item: add it to this cycle's dirty set. Without one: request a full pass.
   * Any argument-free call makes the cycle receive null, discarding the dirty set.
   */
  schedule(item?: T): void
  cancel(): void
}

/**
 * `run` receives collected items (unique, insertion order), or null for a full pass (issue #46).
 * Collect items, not just a run flag: coalescing dozens of callbacks into one pass still requires knowing which blocks changed.
 * Otherwise each pass rescans the paper: 31 passes totaled 1.9 s in a 2312.17141 session, though one pass took only 34 ms.
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
      // Once further delay is disallowed, run at the maximum-wait deadline.
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
