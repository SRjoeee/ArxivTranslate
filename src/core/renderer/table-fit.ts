// Fit side-mode tables and display equations to their own columns (DESIGN §7.2).
// Numeric tables often exceed half-column min-content width (three measured tables: 509 / 551 / 613 px; column: 484 px).
// Display equations cannot wrap either (2609.04056v1: column 436 px; (1.8) 800 px, (1.15) 900 px),
// spilling left equations into the right and their numbers over mirrors. Neither can shrink below min-content; scale proportionally.
// Measure the required ratio and choose a discrete zoom tier via data-axt-fit, styled in modes.css.
// Beyond MIN_FIT, use column-local horizontal scrolling (as ar5iv does for equation tables in .ltx_td / .ltx_inline-block).
//
// Measurement is read-only: no cloning or DOM writes. Previously each table was cloned into body to measure min-content,
// forcing full-page layout per write/read cycle. With equations included, 2312.17141 had 392 targets: a 45 s long task froze the page,
// translating only six blocks in 134 s (user report). Read-only measurement on that page took 1 ms.
//
// Batch reads and writes, and cache measured targets (issue #46). The 1 ms claim covered only a few tables; with 392 targets,
// alternating geometry reads and data-axt-fit writes still forced synchronous layout after each changed zoom,
// up to 392 times per pass. Every pass also remeasured everything. Over 30 side-prep passes per session,
// 2312.17141 totaled 991 ms, half of prep time. Now read all geometry first (one layout),
// then write only changes. Cache by column width + translation node: renderTable / renderPending / retry
// replace that sibling, while mirrors are created once per session. Node identity is therefore the content version; no hash needed.
import { DOCUMENT_ROOT, EQUATION_PAD_CELL, EQUATION_TABLE, FIT_TARGETS } from '@/core/rules/latexml'
import { FOR_ATTR, T_CLASS } from './index'

/** Original nodes permit only data-axt-* additions (§7.1), so express zoom as an attribute, not inline style. */
export const FIT_ATTR = 'data-axt-fit'
/** Discrete tiers need few CSS rules and avoid new attribute values on every resize. */
export const FIT_BUCKETS = [95, 90, 85, 80, 75, 70] as const
/** Below this scale, text is too small; use column-local scrolling instead. */
export const MIN_FIT = 0.7
export const FIT_SCROLL = 'scroll'
/**
 * Headroom required to loosen fit (remove the marker or choose a larger scale). When equation tables fit, natural width is estimated (measureNatural).
 * Estimates can be 1–2% low (up to 28 px across 145 tables); without slack, fitting oscillates between loosening, overflow, and tightening.
 */
export const LOOSEN_SLACK = 0.05

export interface NaturalWidth {
  width: number
  /** Exact measurements may tighten fit; estimates may only loosen it, with LOOSEN_SLACK headroom. */
  exact: boolean
}

export interface FitDeps {
  /** Natural unconstrained table width; numeric results are exact. Measure both original and translation, and use the wider one. */
  naturalWidth?: (table: Element) => number | NaturalWidth
  /** One column's width in the table's container. */
  columnWidth?: (table: Element) => number
}

function currentZoom(table: Element): number {
  const fit = table.getAttribute(FIT_ATTR)
  return fit && fit !== FIT_SCROLL ? Number(fit) / 100 : 1
}

/**
 * Read natural width without writes, in three states:
 * - Horizontal scrolling: max-width caps the box, so scrollWidth is exact content width.
 * - Box wider than column, including current zoom: tables cannot shrink below min-content; box width / zoom is exact natural width.
 * - Fits with slack: .ltx_tabular is content-sized, so box width is still exact.
 *   Equation tables use width: 100%, making box width uninformative. Sum nonfiller cells per row, using filler min-width
 *   (ar5iv supplies 2em), and take the widest row; this is an estimate.
 */
function measureNatural(table: Element, column: number): NaturalWidth {
  const zoom = currentZoom(table)
  if (table.getAttribute(FIT_ATTR) === FIT_SCROLL) return { width: table.scrollWidth, exact: true }
  const visible = table.getBoundingClientRect().width
  if (visible > column + 1 || !table.matches(EQUATION_TABLE)) return { width: visible / zoom, exact: true }
  const view = table.ownerDocument.defaultView
  let widest = 0
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    let width = 0
    for (const cell of Array.from(row.children)) {
      if (cell.matches(EQUATION_PAD_CELL)) {
        const style = view?.getComputedStyle(cell)
        width += (Number.parseFloat(style?.minWidth ?? '') || 0)
          + (Number.parseFloat(style?.paddingLeft ?? '') || 0)
          + (Number.parseFloat(style?.paddingRight ?? '') || 0)
      } else {
        width += cell.getBoundingClientRect().width
      }
    }
    widest = Math.max(widest, width)
  }
  return { width: widest / zoom, exact: false }
}

/**
 * Read column width from the translation root's first grid track; all containers subgrid those tracks (§7.2).
 * More reliable than halving parent width minus gap, since the table's parent need not be one of our grids.
 */
export function measureColumn(table: Element): number {
  const view = table.ownerDocument.defaultView
  const root = table.closest(DOCUMENT_ROOT)
  if (view && root) {
    const first = Number.parseFloat(view.getComputedStyle(root).gridTemplateColumns.split(' ')[0] ?? '')
    if (Number.isFinite(first) && first > 0) return first
  }
  // Fallback before side mode or when tracks cannot be read: estimate half the parent's width.
  const holder = table.parentElement
  if (!holder || !view) return 0
  const gap = Number.parseFloat(view.getComputedStyle(holder).columnGap) || 0
  return (holder.getBoundingClientRect().width - gap) / 2
}

const paired = (table: Element): boolean =>
  table.nextElementSibling?.classList.contains(T_CLASS) === true
  && table.nextElementSibling?.getAttribute(FOR_ATTR) !== null

/** Tightness order: no marker is loosest, scroll is tightest. */
function tightness(value: string | null): number {
  if (value === null) return 0
  if (value === FIT_SCROLL) return FIT_BUCKETS.length + 1
  return FIT_BUCKETS.indexOf(Number(value) as (typeof FIT_BUCKETS)[number]) + 1
}

function decide(natural: number, column: number): string | null {
  if (natural <= column) return null
  const needed = column / natural
  const bucket = FIT_BUCKETS.find(value => value / 100 <= needed)
  return bucket === undefined || needed < MIN_FIT ? FIT_SCROLL : String(bucket)
}

/** Cache measurements: natural width cannot change with the same column width and translation node; the original table is immutable. */
interface FitEntry {
  column: number
  translation: Element
  fit: string | null
}

let cache = new WeakMap<Element, FitEntry>()

/** Clear width cache on session restart or font loading completion. */
export function resetFitCache(): void {
  cache = new WeakMap()
}

/**
 * Web-font loading changes natural width without changing the translation node or column width, leaving cached tiers stale (Codex #84).
 * document.fonts loadingdone is the event source for these changes:
 * clear the cache and ask the caller to schedule cleanup. Return disposal; no-op without FontFaceSet.
 */
export function watchFontLoads(doc: Document, onDone: () => void): () => void {
  const fonts = (doc as Document & { fonts?: EventTarget }).fonts
  if (!fonts?.addEventListener) return () => {}
  const handler = () => { resetFitCache(); onDone() }
  fonts.addEventListener('loadingdone', handler)
  return () => fonts.removeEventListener('loadingdone', handler)
}

/**
 * Assign fit tiers to table / display-equation pairs. Reevaluate when column width or translation node changes; otherwise use cached results.
 * A pair is followed immediately by a translated clone or mirror (.axt-t with data-axt-for).
 * Skip and do not cache targets without layout information (tests, display:none).
 *
 * Three phases: collect without layout, read all geometry with one forced layout, then write only changes, following pair-margins.ts.
 */
export function fitTables(root: Document | Element, deps: FitDeps = {}): { fitted: number; scrolled: number } {
  const columnWidth = deps.columnWidth ?? measureColumn
  const measureOne = (el: Element, column: number): NaturalWidth => {
    const measured = deps.naturalWidth ? deps.naturalWidth(el) : measureNatural(el, column)
    return typeof measured === 'number' ? { width: measured, exact: true } : measured
  }

  // ── 1. Collect: attributes and siblings only, no geometry reads. ──
  const targets: Array<{ table: Element; translation: Element | null; current: string | null }> = []
  for (const table of Array.from(root.querySelectorAll(FIT_TARGETS))) {
    if (table.classList.contains(T_CLASS)) continue
    targets.push({ table, translation: paired(table) ? table.nextElementSibling : null, current: table.getAttribute(FIT_ATTR) })
  }
  const first = targets.find(t => t.translation)
  if (!first) {
    // No pair to fit: remove only existing stale markers, avoiding redundant writes.
    for (const { table, current } of targets) if (current !== null) table.removeAttribute(FIT_ATTR)
    return { fitted: 0, scrolled: 0 }
  }

  // ── 2. Read: column width once, each uncached table once; no writes. ──
  // All containers share subgrid tracks, so one column-width read suffices per call.
  const column = columnWidth(first.table)
  const decided: Array<{ table: Element; translation: Element | null; current: string | null; next: string | null; cacheable: boolean }> = []
  for (const t of targets) {
    if (!t.translation) { decided.push({ ...t, next: null, cacheable: false }); continue }
    if (!(column > 0)) { decided.push({ ...t, next: null, cacheable: false }); continue }
    const hit = cache.get(t.table)
    if (hit && hit.column === column && hit.translation === t.translation) {
      decided.push({ ...t, next: hit.fit, cacheable: false })
      continue
    }
    // Measure both and fit to the wider one. Translated headers can be longer: 2606.07636v2 Table 4
    // fit the original at 0.75 / 648 px, but the translation was 827 px, overflowing 179 px. Both need the same tier
    // to align row heights, so take max rather than fit separately. All reads remain here, forcing only one layout.
    const own = measureOne(t.table, column)
    const other = measureOne(t.translation, column)
    const natural = Math.max(own.width, other.width)
    const exact = own.exact && other.exact
    if (!(natural > 0)) { decided.push({ ...t, next: null, cacheable: false }); continue }
    let next = decide(natural, column)
    // Never tighten from an estimate (measured while fitting, so tightening lacks evidence); loosen only after applying slack.
    if (!exact && tightness(next) !== tightness(t.current)) {
      next = tightness(next) < tightness(t.current) ? decide(natural * (1 + LOOSEN_SLACK), column) : t.current
      if (tightness(next) > tightness(t.current)) next = t.current
    }
    decided.push({ ...t, next, cacheable: true })
  }

  // ── 3. Write: changed attributes only; update cache. ──
  let fitted = 0
  let scrolled = 0
  for (const { table, translation, next, cacheable } of decided) {
    for (const el of [table, translation]) {
      if (!el) continue
      const has = el.getAttribute(FIT_ATTR)
      if (next === null) { if (has !== null) el.removeAttribute(FIT_ATTR) }
      else if (has !== next) el.setAttribute(FIT_ATTR, next)
    }
    if (!translation) { cache.delete(table); continue }
    if (cacheable) cache.set(table, { column, translation, fit: next })
    if (next === FIT_SCROLL) scrolled++
    else if (next !== null) fitted++
  }
  return { fitted, scrolled }
}
