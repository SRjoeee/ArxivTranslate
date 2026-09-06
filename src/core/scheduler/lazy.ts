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
  /** 只认领不回调：调用方自己去翻这些块，观察器不再管它们 */
  claim(blocks: Block[]): void
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

  /**
   * 这个锚点实际能达到的**有效阈值**。两条修正叠在一起（Codex 在 #32 / #36 指出）：
   *
   * 1. `isIntersecting` 的定义是「相交比例 > 0」，**不是**「≥ threshold」。observe 之后浏览器
   *    立刻发一次初始通知，一个刚露出一成的块在 threshold=0.5 下照样报 isIntersecting，
   *    于是这个设置根本不生效。所以回调里要自己比 `intersectionRatio`。
   * 2. 比高不下的块**永远达不到**高阈值：root（视口 + 上下 margin）装不下它，比例封顶在
   *    `root 高 ÷ 元素高`。设计上又明确不拆超大表格，于是 threshold=1 时那张表一辈子不翻。
   *    把阈值按这个上限钳一下，够得着多少就要求多少。
   */
  const effectiveThreshold = (elHeight: number, rootHeight: number) =>
    elHeight > 0 ? Math.min(options.threshold, Math.min(1, rootHeight / elHeight)) : options.threshold

  const Observer = globalThis.IntersectionObserver
  const observer = typeof Observer === 'function'
    ? new Observer((entries, io) => {
        const anchors: Element[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          // rootBounds 在跨文档场景下可能为 null；拿不到就退回只看 isIntersecting，宁可早翻不可不翻
          const rootHeight = entry.rootBounds?.height
          const elHeight = entry.boundingClientRect.height
          if (rootHeight !== undefined && entry.intersectionRatio < effectiveThreshold(elHeight, rootHeight)) continue
          io.unobserve(entry.target)
          anchors.push(entry.target)
        }
        enterAnchors(anchors)
      // threshold 只是"在哪些比例上回调"，判定在上面自己做：加上 0 才收得到刚进场那一次，
      // 否则超大块（够不着 options.threshold）连回调都不会有
      }, { rootMargin: `${options.margin}px 0px`, threshold: options.threshold > 0 ? [0, options.threshold] : 0 })
    : null

  // 播种：首屏及边距内的锚点先同步触发一次，其余交给观察器。
  // **要和观察器用同一个 threshold**（Codex 在 #35 指出）：只判矩形相交的话，配了 threshold 的用户
  // 会看到「刚露出一像素的块立刻就翻」，而同一个块要是晚一点才进视口反而得等够比例，两条路径不一致
  const height = globalThis.innerHeight ?? 0
  const seeded: Element[] = []
  for (const anchor of byAnchor.keys()) {
    const rect = anchor.getBoundingClientRect()
    if (!(rect.width || rect.height)) continue
    const top = Math.max(rect.top, -options.margin)
    const bottom = Math.min(rect.bottom, height + options.margin)
    const visible = Math.max(0, bottom - top)
    // 与 IntersectionObserver 的 intersectionRatio 同义：相交高度 ÷ 元素自身高度
    if (visible > 0 && visible / rect.height >= effectiveThreshold(rect.height, height + 2 * options.margin)) seeded.push(anchor)
    else observer?.observe(anchor)
  }
  enterAnchors(seeded)

  const release = (picked: Block[]) => {
    for (const block of picked) {
      for (const [anchor, carried] of byAnchor) if (carried.includes(block)) observer?.unobserve(anchor)
    }
  }

  return {
    trigger(picked) {
      release(picked)
      fire(picked)
    },
    claim(picked) {
      release(picked)
      for (const block of picked) waiting.delete(block)
    },
    waiting: () => waiting.size,
    disconnect() {
      observer?.disconnect()
      waiting.clear()
    },
  }
}
