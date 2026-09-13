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
 * The cap on skeletons breathing at once. Thousands of WAAPI animations trigger a whole-page style recalculation
 * every frame and a long page saturates the main thread (Read Frog's #1881: over 2400 concurrent rings measured).
 * Paragraphs beyond the cap get a still skeleton, which reads as waiting all the same.
 */
export const MAX_ANIMATED_SKELETONS = 60

/**
 * Each skeleton's animation handle. With thousands of animations in the document Element.getAnimations() is
 * expensive (10% CPU in the sampling of #1881); stored, cancelling is O(1).
 */
const animations = new WeakMap<HTMLElement, Animation>()
let animated = 0

/** The bar widths for one, two and three rows. The last bar is short, so it reads like a paragraph's last line rather than a block */
const WIDTHS: readonly (readonly string[])[] = [['62%'], ['100%', '48%'], ['100%', '100%', '55%']]
/** A short heading on the same line (§7.3) gets one bar, sized by the font size, not the full line */
const INLINE_WIDTH = '4.5em'

/**
 * How many bars. **Estimated, not measured**: reading layout here would force a reflow in the middle of rendering
 * (§10). The original's length is of the translation's order, enough to hold the layout near the height the
 * translation will take
 */
export function skeletonLines(chars: number): number {
  if (chars < 120) return 1
  if (chars < 320) return 2
  return 3
}

/**
 * Cancel the breathing animation. A running animation pins its detached target in the renderer, one leaked node
 * per translated paragraph (#1831), so every path that removes nodes calls this first.
 */
export function cancelSkeletonAnimation(skeleton: HTMLElement): void {
  const animation = animations.get(skeleton)
  if (animation) {
    animations.delete(skeleton)
    animated = Math.max(0, animated - 1)
    animation.cancel()
    return
  }
  // The fallback for what the registry does not have (happy-dom / jsdom have no getAnimations, hence the ?.)
  for (const live of skeleton.getAnimations?.() ?? []) live.cancel()
}

/**
 * One skeleton: an outer span with a few bars by row count. No React, no Shadow DOM, no styles injected into the
 * page (the styles come with modes.css and are there by `enable()`).
 */
export function createSkeleton(ownerDoc: Document, options: { chars?: number; inline?: boolean } = {}): HTMLElement {
  const skeleton = ownerDoc.createElement('span')
  skeleton.className = SKELETON_CLASS
  // Pure decoration: the popup's progress carries the waiting state, and the skeletons must not be read out one by one
  skeleton.setAttribute('aria-hidden', 'true')
  const widths = options.inline ? [INLINE_WIDTH] : WIDTHS[skeletonLines(options.chars ?? 0) - 1]!
  if (options.inline) skeleton.setAttribute(INLINE_ATTR, '')
  for (const width of widths) {
    const line = ownerDoc.createElement('span')
    line.className = SKELETON_LINE_CLASS
    line.style.width = width
    skeleton.appendChild(line)
  }

  // The reader's reduced-motion setting is respected
  const prefersReducedMotion = ownerDoc.defaultView?.matchMedia
    ? ownerDoc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
  if (!prefersReducedMotion && typeof skeleton.animate === 'function' && animated < MAX_ANIMATED_SKELETONS) {
    // Opacity only: the compositor can run it alone, with no layout and no paint. A gradient sweep looks better, but that is a repaint of every block every frame
    const animation = skeleton.animate(
      [{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }],
      { duration: 1400, iterations: Infinity, easing: 'ease-in-out' },
    )
    // On cancel, finished rejects with an AbortError: the specification marks it handled, happy-dom does not and reports it as unhandled
    animation.finished?.catch(() => undefined)
    animations.set(skeleton, animation)
    animated++
  }

  return skeleton
}

/** Place a skeleton at the end of the host node */
export function createSkeletonInside(host: HTMLElement, options: { chars?: number; inline?: boolean } = {}): HTMLElement {
  const skeleton = createSkeleton(host.ownerDocument, options)
  host.appendChild(skeleton)
  return skeleton
}

/** Called before a subtree is removed: cancels the animations of every skeleton inside (the root included) */
export function cancelSkeletonsIn(root: Element): void {
  if (root.classList.contains(SKELETON_CLASS)) cancelSkeletonAnimation(root as HTMLElement)
  for (const skeleton of Array.from(root.querySelectorAll<HTMLElement>(`.${SKELETON_CLASS}`))) cancelSkeletonAnimation(skeleton)
}

/** How many skeletons are breathing right now (for tests) */
export function activeSkeletonAnimations(): number {
  return animated
}
