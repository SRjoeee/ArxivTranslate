// Post-render cleanup (DESIGN §7.2 / §10, issue #46): localize notes, split figures, mirror, fit tables, align margins.
//
// Previously all five steps rescanned document on every pass. 2312.17141 took 31 passes / 1.9 s per session,
// although one pass was only 34 ms. Repetition dominated, especially:
//   - createMirrors scanned 50,000 nodes with bare :has() every time, though translations never change mirror eligibility
//     (all blocks are marked at startup, §7.3), making every later scan redundant;
//   - fitTables' measureColumn forced layout to resolve gridTemplateColumns. As the first geometry read after three DOM-writing steps,
//     it absorbed the entire page's forced-layout cost (130–158 ms when preceding steps wrote).
//
// Now onRendered reports changed blocks per batch; the coalescer accumulates a dirty set, limiting cleanup to their containers.
// Mirror once per session. Read column width at the start, before any writes, and only when stale:
// prep runs in a setTimeout task just after browser rendering, when layout is clean.
//
// All five steps already accept Document | Element; this simply supplies narrower roots.
import { ID_ATTR } from '@/core/extractor'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { createCoalescer, type Coalescer } from '@/core/scheduler/coalesce'
import { createMirrors } from './mirror'
import { localizeNotes } from './notes'
import { readPairMargins, writePairMargins, type PairMarginPlan } from './pair-margins'
import { dropStaleSplits, outermostFigure, splitFigures } from './split-figures'
import { fitTables, measureColumn, resetFitCache, watchFontLoads } from './table-fit'

export interface Prep {
  /** Schedule cleanup only for containers of blocks / image targets whose DOM just changed (§15). */
  touch(items: ReadonlyArray<{ el: Element }>): void
  /** Schedule a full pass (enter side, column-width change, session start). */
  touchAll(): void
  /** Cancel the scheduled pass on leaving side mode. */
  cancel(): void
  /** New session: allow mirroring again, clear measurements, reread column width. */
  reset(): void
  /** Column width may have changed after resize; reread at the next pass's start. */
  refreshColumn(): void
}

export interface PrepOptions {
  isSide: () => boolean
  /** Report each changed pass for e2e and manual checks. */
  trace?: (line: string) => void
  /** Test injection: column width. */
  columnWidth?: (root: Element) => number
  delay?: number
  maxWait?: number
}

/**
 * Cleanup roots for a dirty block: its parent (including adjacent pairs whose margins may change),
 * each ancestor block's parent (refresh outer copies when inner footnotes arrive first),
 * and its outermost figure's parent (splitFigures searches descendants, so the root must be above the figure).
 * Remove roots contained by others; cleanup is idempotent, so repeated work is wasteful.
 */
export function rootsOf(blocks: Iterable<Element>): Element[] {
  const roots = new Set<Element>()
  for (const el of blocks) {
    if (el.parentElement) roots.add(el.parentElement)
    for (let outer = el.parentElement?.closest(`[${ID_ATTR}]`); outer; outer = outer.parentElement?.closest(`[${ID_ATTR}]`)) {
      if (outer.parentElement) roots.add(outer.parentElement)
    }
    const fig = outermostFigure(el)
    if (fig?.parentElement) roots.add(fig.parentElement)
  }
  const list = Array.from(roots)
  return list.filter(r => !list.some(other => other !== r && other.contains(r)))
}

export function createPrep(doc: Document, options: PrepOptions): Prep {
  const columnWidth = options.columnWidth ?? measureColumn
  let mirrorsDone = false
  let columnStale = true
  let column = 0

  const run = (scope: Element[] | null) => {
    const t0 = performance.now()
    // Read column width before writing anything, while layout is clean after the previous frame; avoid forced page layout.
    // Measure from the translation root, not <html>. measureColumn uses closest(DOCUMENT_ROOT) to find grid tracks;
    // <html> cannot find it and has no fallback parent, yielding zero width and fitting no tables
    // (e2e caught zero fitted tables and three overflowing columns at 1440 px).
    if (options.isSide() && columnStale) {
      const root = doc.querySelector(DOCUMENT_ROOT) ?? doc.documentElement
      column = columnWidth(root)
      columnStale = false
    }
    const roots: Array<Document | Element> = scope === null ? [doc] : rootsOf(scope)
    // Read margins before any writes, while styles are clean; the previous frame already accounted for inserted translations.
    // Reading after insertion would charge this getComputedStyle for the full :has() invalidation recalculation.
    let margins: PairMarginPlan[] = options.isSide() ? roots.map(r => readPairMargins(r)) : []
    let notes = 0
    for (const r of roots) notes += localizeNotes(r)
    const t1 = performance.now()
    // Discard stale split copies first: overlays may enter hidden originals outside side mode (§15.2); rebuild on returning to side.
    // Also in side mode: removing a figure's only translation (overlay) makes needsSplit false, so splitFigures would leave its stale clone (Codex #89).
    for (const r of roots) dropStaleSplits(r)
    if (!options.isSide()) return

    // Split whole figures before adding mirrors; split figures are excluded from mirroring to avoid duplication.
    let split = 0
    for (const r of roots) split += splitFigures(r)
    const t2 = performance.now()
    // Mirror once per session, after all block markers are written (otherwise wholesale cloning, issue #67).
    // Eligibility uses only data-axt-id and .axt-t siblings; translation arrivals change neither.
    let made = 0
    if (scope === null && !mirrorsDone && doc.querySelector(`[${ID_ATTR}]`)) {
      made = createMirrors(doc)
      mirrorsDone = true
      // Mirrors also inherit adjacent-sibling site rules; read margins once more after insertion, only on this one session pass.
      if (made) margins = [readPairMargins(doc)]
    }
    const t3 = performance.now()
    let fitted = 0
    let scrolled = 0
    for (const r of roots) {
      const fit = fitTables(r, { columnWidth: () => column })
      fitted += fit.fitted
      scrolled += fit.scrolled
    }
    const t4 = performance.now()
    // Write margins last; readings were taken at the start.
    let aligned = 0
    for (const plan of margins) aligned += writePairMargins(plan)
    const t5 = performance.now()

    // Report every pass, including no-ops: e2e's cleanup-cost assertions need total time, including wasted passes.
    options.trace?.(
      `side prep${scope === null ? ' (full)' : ` (${scope.length} blocks, ${roots.length} roots)`}: `
      + `+${split} figures split, +${made} mirrors, ${fitted} tables scaled, ${scrolled} scrollable, ${aligned} margins aligned, ${notes} notes localized; `
      + `notes=${(t1 - t0).toFixed(1)} split=${(t2 - t1).toFixed(1)} mirrors=${(t3 - t2).toFixed(1)} tables=${(t4 - t3).toFixed(1)} margins=${(t5 - t4).toFixed(1)} total=${(t5 - t0).toFixed(1)}ms`,
    )
  }

  const coalescer: Coalescer<Element> = createCoalescer(run, { delay: options.delay ?? 150, maxWait: options.maxWait ?? 1000 })
  // Loaded fonts change natural width (watchFontLoads clears its cache); reread column width and schedule a full pass too.
  watchFontLoads(doc, () => {
    columnStale = true
    coalescer.schedule()
  })

  return {
    touch(items) {
      for (const item of items) coalescer.schedule(item.el)
    },
    touchAll() {
      coalescer.schedule()
    },
    cancel() {
      coalescer.cancel()
    },
    reset() {
      coalescer.cancel()
      mirrorsDone = false
      columnStale = true
      resetFitCache()
    },
    refreshColumn() {
      columnStale = true
    },
  }
}
