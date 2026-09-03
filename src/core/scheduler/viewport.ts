// 视口优先（DESIGN §10）：观察每个块，临近视口（前后各约一屏）的块先翻。
// IntersectionObserver 参数照 FluentRead（rootMargin 600px、极低阈值）；Read Frog 也是 600px。
import type { Block } from '@/core/extractor'

export interface ViewportTracker {
  isNear(block: Block): boolean
  disconnect(): void
}

export const VIEWPORT_OBSERVER_OPTIONS: IntersectionObserverInit = { rootMargin: '600px 0px', threshold: 0.01 }

/** 环境没有 IntersectionObserver（测试、旧内核）时退化为文档序 */
export function createViewportTracker(blocks: Block[], options: IntersectionObserverInit = VIEWPORT_OBSERVER_OPTIONS): ViewportTracker {
  const Observer = globalThis.IntersectionObserver
  if (typeof Observer !== 'function') return { isNear: () => false, disconnect() {} }

  const near = new Set<Element>()
  const observer = new Observer(entries => {
    for (const entry of entries) {
      if (entry.isIntersecting) near.add(entry.target)
      else near.delete(entry.target)
    }
  }, options)
  for (const block of blocks) observer.observe(block.el)

  return {
    isNear: block => near.has(block.el),
    disconnect() {
      observer.disconnect()
      near.clear()
    },
  }
}
