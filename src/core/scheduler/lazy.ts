// One-shot viewport scheduling (DESIGN §10): Read Frog PageTranslationManager observer structure adapted to our Block[].
//
// Dispatch a block once it enters the viewport plus prefetch margin, then unobserve. Offscreen blocks are never requested.
// Pass entries from one IO callback as one onEnter batch (Read Frog #1881: process hundreds of simultaneous entries once).
// IO's initial callback is asynchronous; synchronously seed the first viewport with getBoundingClientRect (from our former viewport.ts).
//
// Anchors (inspired by FluentRead resolveFullPageVisibilityAnchor): blocks without layout boxes cannot enter the viewport.
// Footnotes in ar5iv have height: 0 or display: none. Observe their nearest ancestor block and dispatch both when it enters.
import { ID_ATTR, type Block } from '@/core/extractor'

export interface PreloadOptions {
  /** Pixels below the viewport considered near (Read Frog default: 1000). */
  margin: number
  /** Visible fraction required for entry (Read Frog default: 0). */
  threshold: number
}

/**
 * Ratios registered with IntersectionObserver. These do not decide entry (the callback uses each element's effective threshold);
 * they decide when we get callbacks. The observer only notifies when a registered ratio is crossed.
 *
 * Registering only `[0, threshold]` can leave oversized blocks with clamped thresholds waiting forever (Codex #76).
 * Chromium measurement: 3000 px element, 900 px root, maximum ratio 0.3, threshold 1.
 * `[0, 1]` yielded only one callback at ratio 0.267, even after scrolling to the bottom; the clamped 0.3 check never passed.
 * A grid in 5% increments produced the required callback at ratio 0.3.
 *
 * A 5% step is sufficiently fine: any attainable maximum is within 5% of a registered ratio. At most 21 callbacks per element,
 * unobserved immediately on entry, each doing only a few comparisons; negligible cost. For threshold 0, register only 0:
 * this default accepts any intersection, so the other 20 ratios are unnecessary.
 */
export const THRESHOLD_STEP = 0.05

export function observerThresholds(threshold: number): number | number[] {
  if (threshold <= 0) return 0
  const grid = Array.from({ length: Math.round(1 / THRESHOLD_STEP) + 1 }, (_, i) => i * THRESHOLD_STEP)
  // A user value may fall between grid points (schema accepts 0–1; the options UI accepts 0.33).
  // Register it too: an element capped between that value and the next grid point otherwise gets no qualifying callback.
  // Crossing 0.30 reports 0.30 < 0.33 and is rejected, while 0.35 is unreachable (Codex #81).
  if (!grid.some(g => Math.abs(g - threshold) < 1e-9)) grid.push(threshold)
  return grid.sort((a, b) => a - b)
}

/**
 * Round the threshold down to the registered grid. Entry and registration must use the same scale (Codex #81):
 * callbacks occur only at registered crossings and report the actual ratio at that moment. An element capped
 * between grid points never receives a callback at its exact maximum.
 *
 * Chromium measurement: 2700 px element, 900 px root, maximum 0.3333, grid 0.30 / 0.35, scrolling in 10 px steps.
 * Crossing 0.30 reported 0.30000001, then no further callbacks (0.35 was unreachable).
 * Comparing against exact 0.3333 would leave the block untranslated forever; rounding to 0.30 accepts this callback.
 */
export function quantizeThreshold(value: number): number {
  return Math.floor(value / THRESHOLD_STEP + 1e-9) * THRESHOLD_STEP
}

export const DEFAULT_PRELOAD: PreloadOptions = { margin: 1000, threshold: 0 }

export interface LazyScheduler<T extends { el: Element } = Block> {
  /** Manually dispatch blocks (no IntersectionObserver, or retry); do not redispatch claimed blocks. */
  trigger(blocks: T[]): void
  /** Claim without a callback: the caller translates these blocks; the observer no longer manages them. */
  claim(blocks: T[]): void
  /** Number of blocks that have not entered the viewport. */
  waiting(): number
  disconnect(): void
}

function hasLayoutBox(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

/** Scheduled targets need only `el`: text blocks and image targets (§15) share the observer. */
export function createLazyScheduler<T extends { el: Element } = Block>(blocks: T[], options: PreloadOptions & { onEnter: (blocks: T[]) => void }): LazyScheduler<T> {
  const waiting = new Set<T>(blocks)
  // Anchor → associated blocks. Observe blocks with layout boxes directly; attach others to their nearest ancestor block.
  const byAnchor = new Map<Element, T[]>()
  for (const block of blocks) {
    const anchor = hasLayoutBox(block.el) ? block.el : block.el.parentElement?.closest(`[${ID_ATTR}]`) ?? block.el
    const carried = byAnchor.get(anchor)
    if (carried) carried.push(block)
    else byAnchor.set(anchor, [block])
  }

  const fire = (entered: T[]) => {
    const fresh = entered.filter(block => waiting.delete(block))
    if (fresh.length > 0) options.onEnter(fresh)
  }
  const enterAnchors = (anchors: Element[]) => fire(anchors.flatMap(anchor => byAnchor.get(anchor) ?? []))

  /**
   * Effective threshold attainable by this anchor, with two adjustments (Codex #32 / #36):
   *
   * 1. `isIntersecting` means an intersection ratio > 0, not ≥ threshold. The browser sends an initial notification
   *    immediately after observe; a 10%-visible block still reports isIntersecting at threshold=0.5.
   *    Without our own intersectionRatio comparison, the setting has no effect.
   * 2. Very tall blocks can never reach high thresholds: the root (viewport plus vertical margins) cannot contain them.
   *    Their ratio is capped at root height / element height. Oversized tables must not be split, so threshold=1 would never translate them.
   *    Clamp to this maximum, requiring only the attainable ratio.
   */
  const effectiveThreshold = (elHeight: number, rootHeight: number) => {
    if (elHeight <= 0) return options.threshold
    const reachable = Math.min(1, rootHeight / elHeight)
    // Use the configured value if attainable; it is registered too (observerThresholds), so a callback can reach it.
    // Otherwise lower to the maximum and round down to the grid; without rounding, no callback may ever qualify.
    return options.threshold <= reachable ? options.threshold : quantizeThreshold(reachable)
  }

  const Observer = globalThis.IntersectionObserver
  const observer = typeof Observer === 'function'
    ? new Observer((entries, io) => {
        const anchors: Element[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          // rootBounds can be null across documents. Fall back to isIntersecting: early translation is better than none.
          const rootHeight = entry.rootBounds?.height
          const elHeight = entry.boundingClientRect.height
          // Tolerance: floating-point ratios may report 0.2999999 when crossing 0.30.
          if (rootHeight !== undefined && entry.intersectionRatio < effectiveThreshold(elHeight, rootHeight) - 1e-6) continue
          io.unobserve(entry.target)
          anchors.push(entry.target)
        }
        enterAnchors(anchors)
      }, { rootMargin: `${options.margin}px 0px`, threshold: observerThresholds(options.threshold) })
    : null

  // Seed anchors in the first viewport plus margins synchronously; leave the rest to the observer.
  // Use the same threshold as the observer (Codex #35). Rectangle intersection alone would translate a one-pixel sliver immediately,
  // while the same block entering later would wait for the configured ratio, making the two paths inconsistent.
  const height = globalThis.innerHeight ?? 0
  const seeded: Element[] = []
  for (const anchor of byAnchor.keys()) {
    const rect = anchor.getBoundingClientRect()
    if (!(rect.width || rect.height)) continue
    const top = Math.max(rect.top, -options.margin)
    const bottom = Math.min(rect.bottom, height + options.margin)
    const visible = Math.max(0, bottom - top)
    // Same meaning as IntersectionObserver's intersectionRatio: intersecting height / element height.
    if (visible > 0 && visible / rect.height >= effectiveThreshold(rect.height, height + 2 * options.margin) - 1e-6) seeded.push(anchor)
    else observer?.observe(anchor)
  }
  enterAnchors(seeded)

  const release = (picked: T[]) => {
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
