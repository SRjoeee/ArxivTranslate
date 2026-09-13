// Tables and display equations made to fit their own column in side mode (DESIGN §7.2).
// A paper's numeric tables are mostly wider than half a column at min-content (three tables on one page measured
// 509 / 551 / 613px against a 484px column), and a display equation cannot wrap either (measured on 2609.04056v1:
// with a 436px column, (1.8) was 800px wide and (1.15) 900px — the left column's equation ran into the right one,
// and the equation number landed at the start of the mirror). Neither can be squeezed below min-content, so they
// are scaled down: the ratio needed is measured and snapped to one of a few discrete zoom stops (written as
// data-axt-fit, styled in modes.css). Content that does not fit even at MIN_FIT falls back to horizontal scrolling
// within the column (ar5iv handles equation tables in .ltx_td / .ltx_inline-block the same way).
//
// **The measurement only reads; it clones nothing and writes no DOM.** An earlier version cloned every table into
// body to measure its min-content — a write-then-read cycle forcing a whole-page reflow per table: with the targets
// extended to equations, 2312.17141 had 392 of them, and a 45-second long task, an unresponsive page and 6 blocks
// translated in 134 seconds were measured (the owner's feedback); the read-only measurement takes 1 ms on the same page.
//
// **Reads and writes are batched, and what was measured is not measured again** (issue #46). “1 ms read-only” was
// the figure with a few tables as targets: at 392, going table by table “read geometry → write data-axt-fit → read
// the next” still interleaves reads and writes — the zoom just written forces synchronous layout on the next read,
// up to 392 times a pass — and every pass re-measured every table regardless of the last result. Side prep runs
// thirty-odd passes a session, 991 ms in all on 2312.17141 (half the whole prep). Now a pass reads all its geometry
// first (one layout), then writes only what changed; a measured table is cached by “column width + translation
// node” — every render path (renderTable / renderPending / a retry) replaces that sibling, and the mirrors are made
// once a session, so **node identity is content version**, with no hashing needed.
import { DOCUMENT_ROOT, EQUATION_PAD_CELL, EQUATION_TABLE, FIT_TARGETS } from '@/core/rules/latexml'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR } from './attrs'

/** An original node may only gain data-axt-* attributes (§7.1), so the ratio is an attribute, not an inline style */
export const FIT_ATTR = 'data-axt-fit'
/** Discrete stops: a few CSS rules cover them, and no new value is written on every window resize */
export const FIT_BUCKETS = [95, 90, 85, 80, 75, 70] as const
/** Below this ratio the text is too small; scrolling within the column instead */
export const MIN_FIT = 0.7
export const FIT_SCROLL = 'scroll'
/**
 * The slack a loosening (removing the mark, or a larger stop) requires. When an equation table fits, its natural
 * width can only be estimated (see measureNatural), and the estimate runs 1–2% under the real value (a maximum of
 * 28px measured over 145 tables); without slack it would flip between “loosen → overflow → tighten” for ever
 */
export const LOOSEN_SLACK = 0.05

export interface NaturalWidth {
  width: number
  /** An exact value may tighten; an estimate may only loosen, and with LOOSEN_SLACK to spare */
  exact: boolean
}

export interface FitDeps {
  /** The table's natural width when unconstrained by the column; a plain number counts as exact. The original and the translated table are each measured, and the wider decides the stop */
  naturalWidth?: (table: Element) => number | NaturalWidth
  /** The width of one column of the container the table sits in */
  columnWidth?: (table: Element) => number
}

function currentZoom(table: Element): number {
  const fit = table.getAttribute(FIT_ATTR)
  return fit && fit !== FIT_SCROLL ? Number(fit) / 100 : 1
}

/**
 * Measure the natural width without writing, in three cases by the current state:
 * - scrolling within the column (scroll): the box is held at the column width by max-width, and scrollWidth is the
 *   content width — exact
 * - the box wider than the column (the current zoom included): a table cannot be squeezed below min-content, so box
 *   width ÷ zoom is the natural width — exact
 * - fits with room to spare: .ltx_tabular sizes to its content, so the box width is still the natural width — exact;
 *   an equation table is width: 100% and its box says nothing about the content, so the sum of each row's non-fill
 *   cells (a fill cell counts at its min-width, 2em from ar5iv), the widest row taken — an estimate
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
 * The column width is the translation root's first grid track: every container is a subgrid of it, so the column
 * width is the same everywhere (§7.2). Reading the track is more reliable than “parent width minus gap, halved” — a
 * table's parent is not necessarily a grid container we set up.
 */
export function measureColumn(table: Element): number {
  const view = table.ownerDocument.defaultView
  const root = table.closest(DOCUMENT_ROOT)
  if (view && root) {
    const first = Number.parseFloat(view.getComputedStyle(root).gridTemplateColumns.split(' ')[0] ?? '')
    if (Number.isFinite(first) && first > 0) return first
  }
  // The fallback: not in side yet, or the track unreadable — half the parent container as an estimate
  const holder = table.parentElement
  if (!holder || !view) return 0
  const gap = Number.parseFloat(view.getComputedStyle(holder).columnGap) || 0
  return (holder.getBoundingClientRect().width - gap) / 2
}

const paired = (table: Element): boolean =>
  table.nextElementSibling?.classList.contains(T_CLASS) === true
  && table.nextElementSibling?.getAttribute(FOR_ATTR) !== null

/** From loosest to tightest: no mark is the loosest, scroll the tightest */
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

/** Measured once, remembered: with the same column width and the same translation node the natural width cannot change (the original table is immutable) */
interface FitEntry {
  column: number
  translation: Element
  fit: string | null
}

let cache = new WeakMap<Element, FitEntry>()

/** Clear the width cache. Called on a new session and once fonts have loaded */
export function resetFitCache(): void {
  cache = new WeakMap()
}

/**
 * Natural widths change once web fonts have loaded, yet with the translation node and the column width unchanged
 * the cache still hits, and the stop stays where the fonts' absence left it (Codex on #84). `loadingdone` of
 * `document.fonts` is the only event source for that change: clear the cache and let the caller schedule a tidy
 * pass. Returns the teardown; an environment without FontFaceSet does nothing
 */
export function watchFontLoads(doc: Document, onDone: () => void): () => void {
  const fonts = (doc as Document & { fonts?: EventTarget }).fonts
  if (!fonts?.addEventListener) return () => {}
  const handler = () => { resetFitCache(); onDone() }
  fonts.addEventListener('loadingdone', handler)
  return () => fonts.removeEventListener('loadingdone', handler)
}

/**
 * Give each table / display-equation pair its zoom stop; a repeated call re-decides by the current column width,
 * and a table whose column width and translation node are unchanged reuses the last result. A pair = a translation
 * clone or a mirror right after (both .axt-t with data-axt-for). An environment without layout information (tests,
 * display:none) is skipped and not cached.
 *
 * Three stages: collect (no layout touched), then read everything at once (one forced layout), then write only
 * what changed — the discipline of pair-margins.ts
 */
export function fitTables(root: Document | Element, deps: FitDeps = {}): { fitted: number; scrolled: number } {
  const columnWidth = deps.columnWidth ?? measureColumn
  const measureOne = (el: Element, column: number): NaturalWidth => {
    const measured = deps.naturalWidth ? deps.naturalWidth(el) : measureNatural(el, column)
    return typeof measured === 'number' ? { width: measured, exact: true } : measured
  }

  // ── 1. Collect: attributes and siblings only, no geometry read ──
  const targets: Array<{ table: Element; translation: Element | null; current: string | null }> = []
  for (const table of Array.from(root.querySelectorAll(FIT_TARGETS))) {
    if (table.classList.contains(T_CLASS)) continue
    targets.push({ table, translation: paired(table) ? table.nextElementSibling : null, current: table.getAttribute(FIT_ATTR) })
  }
  const first = targets.find(t => t.translation)
  if (!first) {
    // No pair to handle: only stale marks are erased (when present — no needless writes)
    for (const { table, current } of targets) if (current !== null) table.removeAttribute(FIT_ATTR)
    return { fitted: 0, scrolled: 0 }
  }

  // ── 2. Read: the column width once, every table not in the cache once; nothing written throughout ──
  // The column width is the same everywhere within one call (every container shares the same subgrid tracks), so one read
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
    // **Both measured, the wider decides the stop**: the translated table may be wider than the original — longer
    // Chinese headers (measured on Table 4 of 2606.07636v2: the original at the 0.75 stop fits the column at exactly
    // 648, the translation at the same stop is 827 and overflows the right column by 179px). The two must share one
    // stop, or the row heights differ and the sides misalign — hence max rather than each on its own. Every read is
    // in this stage, still one layout
    const own = measureOne(t.table, column)
    const other = measureOne(t.translation, column)
    const natural = Math.max(own.width, other.width)
    const exact = own.exact && other.exact
    if (!(natural > 0)) { decided.push({ ...t, next: null, cacheable: false }); continue }
    let next = decide(natural, column)
    // An estimate never tightens (it measures the “fits” state, no ground for tightening); a loosening is re-decided by the width with slack added
    if (!exact && tightness(next) !== tightness(t.current)) {
      next = tightness(next) < tightness(t.current) ? decide(natural * (1 + LOOSEN_SLACK), column) : t.current
      if (tightness(next) > tightness(t.current)) next = t.current
    }
    decided.push({ ...t, next, cacheable: true })
  }

  // ── 3. Write: only attributes that differ from the present state; record the cache ──
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
