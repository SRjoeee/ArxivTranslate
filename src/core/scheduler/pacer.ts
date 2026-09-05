// 移植自 reference/read-frog/src/utils/scheduler.ts@9b44f82（GPL-3.0），2026-09-05 移植、有修改：仅加文件头。
// 主线程切片：MV3 的 content script 与页面共用主线程，长的同步 DOM 工作会把页面冻住（它的 #1881）。

/** 一片同步 DOM 工作的时间预算 */
export const DEFAULT_WALK_BUDGET_MS = 12

interface SchedulerLike {
  yield?: () => Promise<void>
  postTask?: (callback: () => void, options?: { priority?: string }) => Promise<void>
}

/**
 * 让出事件循环，让输入与渲染在两片工作之间跑。优先级：scheduler.yield（Chrome 129+）→
 * scheduler.postTask（Chrome 94+ / Firefox 101+）→ MessageChannel（到处都有；不像 setTimeout 有嵌套 4ms 的下限）→ setTimeout(0)。
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

/** 这一片的预算用完就让出主线程 */
export async function pauseIfBudgetSpent(pacer: WorkPacer): Promise<void> {
  if (performance.now() < pacer.deadline) return
  await yieldToMain()
  pacer.deadline = performance.now() + pacer.budgetMs
}
