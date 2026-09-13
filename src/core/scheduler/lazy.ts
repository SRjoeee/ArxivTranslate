// Ported from reference/read-frog/src/entrypoints/host.content/translation-control/page-translation.ts@9b44f82 (GPL-3.0),
// 2026-09-05, modified: the PageTranslationManager observer skeleton, rebound to our Block[] (DESIGN §10).
//
// A block is handed over for translation the first time it enters the viewport plus the preload distance, and
// unobserved at once — one-shot; a block never in view is never requested. Blocks entering in one IO callback go to
// onEnter as one batch (its #1881: hundreds entering at once are handled once). The first IO callback is
// asynchronous, so the first screen is seeded synchronously at creation with getBoundingClientRect (our original
// viewport.ts's way).
//
// Anchors (the idea of FluentRead's resolveFullPageVisibilityAnchor): a block with no layout box never enters the
// viewport — a footnote body is height: 0 in ar5iv, or collapsed to display: none — so its nearest ancestor block is
// observed instead, and it enters when the ancestor does.
import { ID_ATTR, type Block } from '@/core/extractor'

export interface PreloadOptions {
  /** How many pixels below the viewport count as “near” (Read Frog's default 1000) */
  margin: number
  /** How much of a block has to show to count as entered (Read Frog's default 0) */
  threshold: number
}

/**
 * The ratio points registered with the IntersectionObserver. **The decision is not made here** (the callback judges
 * by each element's effective threshold); these numbers only decide “at which ratios the callback reaches us” — and
 * that is a hard constraint: the observer calls back **only when a registered value is crossed**.
 *
 * Registering `[0, threshold]` alone means a huge block whose threshold was clamped never gets the notification it
 * needs (Codex on #76). Chromium measured (a 3000 px element, a 900 px root, ratio cap 0.3, threshold 1): with
 * `[0, 1]` registered there was one callback in all, ratio 0.267, and none more scrolling to the bottom — the
 * decision clamped to 0.3 never passed; with a fine grid in 5% steps the callback at ratio 0.3 arrived.
 *
 * A 5% step: any element's reachable cap is within 5% of some registered point, fine enough; an element gets at most
 * 21 callbacks, `unobserve` on the first hit, and the callback does a few comparisons — negligible. A threshold of 0
 * falls back to a single 0 — the default, any intersection counts as entered, and 20 more points would be pointless
 */
export const THRESHOLD_STEP = 0.05

export function observerThresholds(threshold: number): number | number[] {
  if (threshold <= 0) return 0
  const grid = Array.from({ length: Math.round(1 / THRESHOLD_STEP) + 1 }, (_, i) => i * THRESHOLD_STEP)
  // The configured value itself may be off the grid (the schema asks only 0–1, and the settings page accepts 0.33).
  // Unregistered, an element whose cap falls “between the configured value and the next grid point” likewise never
  // gets a passing callback: the one crossing 0.30 reports 0.30 < 0.33 and is refused, and 0.35 is out of reach (Codex on #81)
  if (!grid.some(g => Math.abs(g - threshold) < 1e-9)) grid.push(threshold)
  return grid.sort((a, b) => a - b)
}

/**
 * Align the threshold down to the registered grid. **The decision must use the same scale as the registration**
 * (Codex on #81): the observer notifies only when a registered point is crossed, and the notification carries the
 * **real ratio at that moment**, so an element whose reachable cap lies **between** two grid points never gets the
 * one where “the ratio equals the cap”.
 *
 * Chromium measured (a 2700 px element, a 900 px root, cap 0.3333, grid 0.30 / 0.35, scrolled slowly 10 px at a
 * time): the one crossing 0.30 reported 0.30000001, and no callback after (0.35 out of reach). Compared against the
 * exact 0.3333 it never passes and the block is never translated; aligned to 0.30, that one is accepted.
 */
export function quantizeThreshold(value: number): number {
  return Math.floor(value / THRESHOLD_STEP + 1e-9) * THRESHOLD_STEP
}

export const DEFAULT_PRELOAD: PreloadOptions = { margin: 1000, threshold: 0 }

export interface LazyScheduler<T extends { el: Element } = Block> {
  /** Hand blocks over by hand (an environment without IntersectionObserver, retries); already handed over ones are not repeated */
  trigger(blocks: T[]): void
  /** Claim only, no callback: the caller translates these blocks itself and the observer forgets them */
  claim(blocks: T[]): void
  /** How many blocks have not entered the viewport yet */
  waiting(): number
  disconnect(): void
}

function hasLayoutBox(el: Element): boolean {
  const rect = el.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

/** Anything scheduled only needs an `el`: text blocks (Block) and image targets (§15) share one observer */
export function createLazyScheduler<T extends { el: Element } = Block>(blocks: T[], options: PreloadOptions & { onEnter: (blocks: T[]) => void }): LazyScheduler<T> {
  const waiting = new Set<T>(blocks)
  // Anchor → the blocks it carries. A block with a layout box observes itself; one without hangs on its nearest ancestor block
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
   * The **effective threshold** this anchor can really reach. Two corrections stacked (Codex on #32 / #36):
   *
   * 1. `isIntersecting` is defined as “intersection ratio > 0”, **not** “≥ threshold”. Right after observe the
   *    browser sends an initial notification, and a block a tenth exposed reports isIntersecting at threshold=0.5 all
   *    the same, so the setting has no effect at all. The callback has to compare `intersectionRatio` itself.
   * 2. A block taller than the root **never reaches** a high threshold: the root (viewport + vertical margins)
   *    cannot hold it, and the ratio caps at `root height ÷ element height`. The design expressly does not split
   *    huge tables, so at threshold=1 such a table is never translated. The threshold is clamped to that cap: as
   *    much as is reachable is demanded.
   */
  const effectiveThreshold = (elHeight: number, rootHeight: number) => {
    if (elHeight <= 0) return options.threshold
    const reachable = Math.min(1, rootHeight / elHeight)
    // Reachable, the configured value decides — it is itself registered (see observerThresholds), so the callback
    // arrives; unreachable, it drops to the cap, and that number has to be **aligned to the grid**, or the passing callback never comes either
    return options.threshold <= reachable ? options.threshold : quantizeThreshold(reachable)
  }

  const Observer = globalThis.IntersectionObserver
  const observer = typeof Observer === 'function'
    ? new Observer((entries, io) => {
        const anchors: Element[] = []
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          // rootBounds may be null across documents; without it, isIntersecting alone decides — better early than never
          const rootHeight = entry.rootBounds?.height
          const elHeight = entry.boundingClientRect.height
          // Tolerance: the browser's ratio is floating point and may report 0.2999999 when crossing 0.30
          if (rootHeight !== undefined && entry.intersectionRatio < effectiveThreshold(elHeight, rootHeight) - 1e-6) continue
          io.unobserve(entry.target)
          anchors.push(entry.target)
        }
        enterAnchors(anchors)
      }, { rootMargin: `${options.margin}px 0px`, threshold: observerThresholds(options.threshold) })
    : null

  // Seeding: the anchors on the first screen and within the margin fire once synchronously, the rest go to the
  // observer. **The same threshold as the observer's** (Codex on #35): judging by rectangle intersection alone, a
  // reader with a threshold configured would see “a block one pixel exposed translated at once”, while the same block
  // entering a little later would have to wait for its ratio — two inconsistent paths
  const height = globalThis.innerHeight ?? 0
  const seeded: Element[] = []
  for (const anchor of byAnchor.keys()) {
    const rect = anchor.getBoundingClientRect()
    if (!(rect.width || rect.height)) continue
    const top = Math.max(rect.top, -options.margin)
    const bottom = Math.min(rect.bottom, height + options.margin)
    const visible = Math.max(0, bottom - top)
    // The same meaning as IntersectionObserver's intersectionRatio: intersecting height ÷ the element's own height
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
