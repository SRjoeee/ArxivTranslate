// Top edges aligned across the two columns of one row in side mode (DESIGN §7.2).
//
// A translation can only be inserted as the original block's next sibling (§7.1), and inserting it rewrites what
// the site's **adjacent-sibling selectors** match. Measured in the author area of 2501.00077v1: ar5iv has a top-margin
// rule of the form `.ltx_role_affiliation + .ltx_role_affiliation` (control experiment: removing the class from
// the element, from its previous sibling, or inserting a node between them each zeroes the 8px). The translation
// node copies the original's class, so the original's previous sibling is the previous **translation** (different
// role → 0px) while the translation's previous sibling is its own **original** (same role → 8px): the two columns
// of one row differ by 8px at the top.
//
// In a grid, a cell's top = the row's top + its own margin-top; unequal top margins misalign by necessity. CSS has
// no “the sibling's computed value”, so the original's top margin is copied onto the translation — our own node only.
import { T_CLASS } from '@/core/marks'
import { SIDE_DENY_SUBTREE } from './side-layout'

function translations(root: Document | Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`.${T_CLASS}`))
}

function viewOf(root: Document | Element): (Window & typeof globalThis) | null {
  const doc = root.nodeType === 9 ? (root as Document) : (root as Element).ownerDocument
  return doc?.defaultView ?? null
}

/** Erase the inline top margins we wrote, so the computed value returns to the site's style (on leaving side mode) */
export function clearPairMargins(root: Document | Element): void {
  for (const t of translations(root)) if (t.style.marginTop) t.style.removeProperty('margin-top')
}

/** The pairs read in one pass and the value each should get; reading and writing are two functions so the tidy layer can put the read before any write */
export interface PairMarginPlan {
  pairs: Array<[Element, HTMLElement, string]>
  wanted: Array<string | null>
}

/**
 * Read: collect the pairs, erase the values written last round, measure both sides' computed margins. **No writes**
 * (erasing an inline value affects that element's style only and disturbs no selector matching). The tidy layer
 * calls it before writing anything — the styles are clean at that moment and getComputedStyle does not pay for a
 * whole-page recalculation; read after nodes are inserted, the invalidation of `:has()` makes this one read cost
 * hundreds of milliseconds (issue #46 measured 90 ms a pass on 2312.17141, 818 ms over 31 passes — the layer that
 * showed once fitTables' forced layout had been moved away)
 */
export function readPairMargins(root: Document | Element): PairMarginPlan {
  const view = viewOf(root)
  const pairs: PairMarginPlan['pairs'] = []
  if (!view) return { pairs, wanted: [] }
  for (const t of translations(root)) {
    const original = t.previousElementSibling
    if (!original || original.classList.contains(T_CLASS)) continue
    // In a split clone and in a footnote the “previous sibling” is not the original (the clone's original members
    // were taken out); not a pair (measured: 14 caption translations on 2312.17141 would copy the figure's margin;
    // Codex on #26)
    if (t.closest(SIDE_DENY_SUBTREE)) continue
    // Last round's value erased first, or what is measured is what we wrote, and a changed column width or site style could never be corrected
    const previous = t.style.marginTop
    if (previous) t.style.removeProperty('margin-top')
    pairs.push([original, t, previous])
  }
  // With no declared margin the browser gives "0px" and happy-dom an empty string; normalised to "0px" before comparing
  const marginTop = (el: Element) => view.getComputedStyle(el).marginTop || '0px'
  const wanted = pairs.map(([original, t]) => {
    const want = marginTop(original)
    return want === marginTop(t) ? null : want
  })
  return { pairs, wanted }
}

/** Write: only the ones that disagree; returns how many translations changed this round (0 once settled) */
export function writePairMargins({ pairs, wanted }: PairMarginPlan): number {
  let changed = 0
  wanted.forEach((want, i) => {
    const [, t, previous] = pairs[i]!
    const next = want ?? ''
    if (next) t.style.marginTop = next // erased at read time, so the ones that agree are written back too
    if (next !== previous) changed += 1
  })
  return changed
}

/** Make every original / translation pair's top margins agree; returns how many translations changed this round (0 once settled) */
export function alignPairMargins(root: Document | Element): number {
  return writePairMargins(readPairMargins(root))
}
