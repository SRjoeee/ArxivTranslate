// Ported from reference/read-frog/src/utils/scheduler.ts@9b44f82 (GPL-3.0), 2026-09-05, modified: header only.
// Main-thread slicing: an MV3 content script shares the main thread with the page, and long synchronous DOM work
// freezes it (its #1881).

/** The time budget of one slice of synchronous DOM work */
export const DEFAULT_WALK_BUDGET_MS = 12

interface SchedulerLike {
  yield?: () => Promise<void>
  postTask?: (callback: () => void, options?: { priority?: string }) => Promise<void>
}

/**
 * Yield to the event loop so input and rendering run between two slices of work. In order of preference:
 * scheduler.yield (Chrome 129+) → scheduler.postTask (Chrome 94+ / Firefox 101+) → MessageChannel (everywhere; unlike
 * setTimeout it has no nested 4ms floor) → setTimeout(0).
 */
export function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler
  if (typeof scheduler?.yield === 'function') {
    return scheduler.yield()
  }
  if (typeof scheduler?.postTask === 'function') {
    return scheduler.postTask(() => {}, { priority: 'user-visible' })
  }
  if (typeof MessageChannel !== 'undefined') {
    return new Promise(resolve => {
      const { port1, port2 } = new MessageChannel()
      port1.onmessage = () => {
        port1.close()
        resolve()
      }
      port2.postMessage(null)
    })
  }
  return new Promise(resolve => setTimeout(resolve, 0))
}

export interface WorkPacer {
  deadline: number
  budgetMs: number
}

export function createWorkPacer(budgetMs: number = DEFAULT_WALK_BUDGET_MS): WorkPacer {
  return { deadline: performance.now() + budgetMs, budgetMs }
}

/** Yield the main thread once the slice's budget is spent */
export async function pauseIfBudgetSpent(pacer: WorkPacer): Promise<void> {
  if (performance.now() < pacer.deadline) return
  await yieldToMain()
  pacer.deadline = performance.now() + pacer.budgetMs
}
