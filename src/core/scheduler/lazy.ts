// 一次性视口调度（DESIGN §10）：Read Frog PageTranslationManager 的观察器骨架，改绑我们的 Block[]。
//
// 块第一次进入视口加预翻译距离时才交出去翻，同时 unobserve——一次性；视口外的块永远不会被请求。
// 同一次 IO 回调里进入的块作一批交给 onEnter（它的 #1881：一次密集进入几百条也只处理一次）。
// IO 的首次回调是异步的，创建时先按 getBoundingClientRect 同步播种一次首屏（我们原 viewport.ts 的做法）。
//
// 锚点（FluentRead resolveFullPageVisibilityAnchor 的思路）：没有布局盒的块永远进不了视口——
// 脚注正文在 ar5iv 里 height: 0 或折叠成 display: none——改观察它最近的祖先块，祖先进入时一起进入。
import { ID_ATTR, type Block } from '@/core/extractor'

export interface PreloadOptions {
  /** 视口下方多少像素算"临近"（Read Frog 默认 1000） */
  margin: number
  /** 块露出多少比例算进入（Read Frog 默认 0） */
  threshold: number
}

export const DEFAULT_PRELOAD: PreloadOptions = { margin: 1000, threshold: 0 }

export interface LazyScheduler {
  /** 手动把块交出去（无 IntersectionObserver 的环境、重试）；已交过的不再交 */
  trigger(blocks: Block[]): void
  /** 还没进入视口的块数 */
  waiting(): number
  disconnect(): void
}

function hasLayoutBox(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

export function createLazyScheduler(blocks: Block[], options: PreloadOptions & { onEnter: (blocks: Block[]) => void }): LazyScheduler {
  const waiting = new Set<Block>(blocks)
  // 锚点 → 它带着的块。有布局盒的块观察自己；没有的挂到最近的祖先块上
  const byAnchor = new Map<Element, Block[]>()
  for (const block of blocks) {
    const anchor = hasLayoutBox(block.el) ? block.el : block.el.parentElement?.closest(`[${ID_ATTR}]`) ?? block.el
    const carried = byAnchor.get(anchor)
    if (carried) carried.push(block)
    else byAnchor.set(anchor, [block])
  }

  const fire = (entered: Block[]) => {
    const fresh = entered.filter(block => waiting.delete(block))
    if (fresh.length > 0) options.onEnter(fresh)
  }
  const enterAnchors = (anchors: Element[]) => fire(anchors.flatMap(anchor => byAnchor.get(anchor) ?? []))

  const Observer = globalThis.IntersectionObserver
  const observer = typeof Observer === 'function'
    ? new Observer((entries, io) => {
        const anchors: Element[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          io.unobserve(entry.target)
          anchors.push(entry.target)
        }
        enterAnchors(anchors)
      }, { rootMargin: `${options.margin}px 0px`, threshold: options.threshold })
    : null

  // 播种：首屏及边距内的锚点先同步触发一次，其余交给观察器
  const height = globalThis.innerHeight ?? 0
  const seeded: Element[] = []
  for (const anchor of byAnchor.keys()) {
    const rect = anchor.getBoundingClientRect()
    if (!(rect.width || rect.height)) continue
    if (rect.bottom > -options.margin && rect.top < height + options.margin) seeded.push(anchor)
    else observer?.observe(anchor)
  }
  enterAnchors(seeded)

  return {
    trigger(picked) {
      for (const block of picked) {
        for (const [anchor, carried] of byAnchor) if (carried.includes(block)) observer?.unobserve(anchor)
      }
      fire(picked)
    },
    waiting: () => waiting.size,
    disconnect() {
      observer?.disconnect()
      waiting.clear()
    },
  }
}
