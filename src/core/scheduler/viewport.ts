// 视口优先（DESIGN §10）：观察每个块，临近视口（前后各约一屏）的块先翻。
// IntersectionObserver 参数照 FluentRead（rootMargin 600px、极低阈值）；Read Frog 也是 600px。
import type { Block } from '@/core/extractor'

export interface ViewportTracker {
  isNear(block: Block): boolean
  disconnect(): void
}

/** 视口前后各多少像素算"临近"（FluentRead / Read Frog 都是 600px） */
export const VIEWPORT_MARGIN_PX = 600

export const VIEWPORT_OBSERVER_OPTIONS: IntersectionObserverInit = { rootMargin: `${VIEWPORT_MARGIN_PX}px 0px`, threshold: 0.01 }

/**
 * 播种：IO 的首次回调是异步的，而 runTranslation 一开始就同步取走并发数个批次，
 * 不播种的话头几批永远是文档开头（实测 2609.00060：滚到 §3 再开始，先出来的是 b1/b5/S1.p1）。
 * 没有布局的元素（rect 全 0）不算，happy-dom / display:none 都落在这里。
 */
function seedNear(blocks: Block[], near: Set<Element>, margin: number): void {
  const height = globalThis.innerHeight ?? 0
  for (const block of blocks) {
    const rect = block.el.getBoundingClientRect()
    if (!(rect.width || rect.height)) continue
    if (rect.bottom > -margin && rect.top < height + margin) near.add(block.el)
  }
}

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
  seedNear(blocks, near, VIEWPORT_MARGIN_PX)
  for (const block of blocks) observer.observe(block.el)

  return {
    isNear: block => near.has(block.el),
    disconnect() {
      observer.disconnect()
      near.clear()
    },
  }
}
