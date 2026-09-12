// Ported from reference/read-frog/src/utils/host/translate/ui/spinner.ts@9b44f82 (GPL-3.0), 2026-09-05, modified;
// changed again 2026-09-11: the spinning ring became a skeleton (DESIGN §7.6). **What is kept is its performance
// discipline** — a cap on simultaneous animations, handles in a WeakMap, cancel before removing a node (its #1881 /
// #1831); only what is drawn changed: a few bars sized by the paper's type, tinted arXiv red, breathing as a whole
// (shadcn/ui's pulse). The styles live in styles/modes.css; this file only writes each block's own widths.
// Its request glue getTranslatedTextAndRemoveSpinner is gone; ours is in pipeline/run.ts.
import { INLINE_ATTR } from './attrs'

export const SKELETON_CLASS = 'axt-skel'
export const SKELETON_LINE_CLASS = 'axt-skel-line'

/**
 * 同时呼吸的骨架屏上限。几千个 WAAPI 动画每帧都触发整页样式重算，长页面会把主线程吃满
 *（Read Frog 的 #1881：实测 2400 多个并发圆环）。超出上限的段落是静止的骨架屏，一样看得出在等。
 */
export const MAX_ANIMATED_SKELETONS = 60

/**
 * 每块骨架屏的动画句柄。文档里有几千个动画时 Element.getAnimations() 很贵
 *（#1881 的采样里占 10% CPU），存下来取消就是 O(1)。
 */
const animations = new WeakMap<HTMLElement, Animation>()
let animated = 0

/** 一行、两行、三行各自的条宽。最后一条短，读起来像一段话的末行而不是一个方块 */
const WIDTHS: readonly (readonly string[])[] = [['62%'], ['100%', '48%'], ['100%', '100%', '55%']]
/** 同行的短标题（§7.3）只放一条，宽度按字号走，不占满整行 */
const INLINE_WIDTH = '4.5em'

/**
 * 几条条。**估的，不量**：这里读布局会在渲染中途逼出一次回流（§10）。
 * 原文长度与译文长度同量级，够把版式撑到接近译文到达后的高度
 */
export function skeletonLines(chars: number): number {
  if (chars < 120) return 1
  if (chars < 320) return 2
  return 3
}

/**
 * 取消呼吸动画。跑着的动画会把已脱离文档的目标钉在渲染器里，每个翻译过的段落漏一个节点（#1831），
 * 所以每条删节点的路径都要先调这个。
 */
export function cancelSkeletonAnimation(skeleton: HTMLElement): void {
  const animation = animations.get(skeleton)
  if (animation) {
    animations.delete(skeleton)
    animated = Math.max(0, animated - 1)
    animation.cancel()
    return
  }
  // 兜底：注册表里没有的（happy-dom / jsdom 没有 getAnimations，所以 ?.）
  for (const live of skeleton.getAnimations?.() ?? []) live.cancel()
}

/**
 * 一块骨架屏：外面一个 span，里面按行数放几条。不用 React / Shadow DOM，不往页面注入样式
 *（样式随 modes.css 一起进来，`enable()` 时就在）。
 */
export function createSkeleton(ownerDoc: Document, options: { chars?: number; inline?: boolean } = {}): HTMLElement {
  const skeleton = ownerDoc.createElement('span')
  skeleton.className = SKELETON_CLASS
  // 纯装饰：等待状态由 popup 的进度显示承担，逐块的骨架屏不该被逐个念出来
  skeleton.setAttribute('aria-hidden', 'true')
  const widths = options.inline ? [INLINE_WIDTH] : WIDTHS[skeletonLines(options.chars ?? 0) - 1]!
  if (options.inline) skeleton.setAttribute(INLINE_ATTR, '')
  for (const width of widths) {
    const line = ownerDoc.createElement('span')
    line.className = SKELETON_LINE_CLASS
    line.style.width = width
    skeleton.appendChild(line)
  }

  // 尊重用户的减少动效设置
  const prefersReducedMotion = ownerDoc.defaultView?.matchMedia
    ? ownerDoc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
  if (!prefersReducedMotion && typeof skeleton.animate === 'function' && animated < MAX_ANIMATED_SKELETONS) {
    // 只动 opacity：合成器就能跑完，不重排也不重绘。渐变扫光好看，但那是每帧对每一块重绘
    const animation = skeleton.animate(
      [{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }],
      { duration: 1400, iterations: Infinity, easing: 'ease-in-out' },
    )
    // 取消时 finished 会以 AbortError 拒绝：规范把它标成已处理，happy-dom 没有，会当未处理的拒绝报出来
    animation.finished?.catch(() => undefined)
    animations.set(skeleton, animation)
    animated++
  }

  return skeleton
}

/** 在宿主节点末尾放一块骨架屏 */
export function createSkeletonInside(host: HTMLElement, options: { chars?: number; inline?: boolean } = {}): HTMLElement {
  const skeleton = createSkeleton(host.ownerDocument, options)
  host.appendChild(skeleton)
  return skeleton
}

/** 删掉一棵子树之前调用：把里面（含根自己）所有骨架屏的动画取消 */
export function cancelSkeletonsIn(root: Element): void {
  if (root.classList.contains(SKELETON_CLASS)) cancelSkeletonAnimation(root as HTMLElement)
  for (const skeleton of Array.from(root.querySelectorAll<HTMLElement>(`.${SKELETON_CLASS}`))) cancelSkeletonAnimation(skeleton)
}

/** 当前在呼吸的骨架屏数（测试用） */
export function activeSkeletonAnimations(): number {
  return animated
}
