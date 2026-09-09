// Ported from reference/read-frog/src/utils/scheduler.ts@9b44f82 (GPL-3.0), 2026-09-05; modified: file header only.
// Main-thread slicing: MV3 content scripts share the page's main thread; long synchronous DOM work freezes it (Read Frog #1881).

/** Time budget for one slice of synchronous DOM work. */
export const DEFAULT_WALK_BUDGET_MS = 12

interface SchedulerLike {
  yield?: () => Promise<void>
  postTask?: (callback: () => void, options?: { priority?: string }) => Promise<void>
}

/**
 * Yield to let input and rendering run between slices. Priority: scheduler.yield (Chrome 129+) →
 * scheduler.postTask (Chrome 94+ / Firefox 101+) → MessageChannel (widely supported, no nested 4 ms minimum like setTimeout) → setTimeout(0).
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

/** Yield the main thread when this slice exhausts its budget. */
export async function pauseIfBudgetSpent(pacer: WorkPacer): Promise<void> {
  if (performance.now() < pacer.deadline) return
  await yieldToMain()
  pacer.deadline = performance.now() + pacer.budgetMs
}
