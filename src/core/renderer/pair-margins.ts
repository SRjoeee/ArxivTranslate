// Align left and right tops in each side-mode row (DESIGN §7.2).
//
// Translation must be the original's next sibling (§7.1), changing how site adjacent-sibling CSS matches.
// In 2501.00077v1 author metadata, ar5iv applies margin-top through .ltx_role_affiliation + .ltx_role_affiliation.
// Removing either matching class or inserting a node between them reduced 8 px to zero in controlled checks.
// Translations copy original classes. An original follows the previous translation (different role → 0 px),
// while its translation follows that original (same role → 8 px), misaligning the row by 8 px.
//
// Each grid item's top is row top + its margin-top, so unequal margins necessarily misalign.
// CSS cannot read a sibling's computed value; copy the original's top margin onto our own translated node only.
import { T_CLASS } from './index'
import { SIDE_DENY_SUBTREE } from './side-layout'

function translations(root: Document | Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`.${T_CLASS}`))
}

function viewOf(root: Document | Element): (Window & typeof globalThis) | null {
  const doc = root.nodeType === 9 ? (root as Document) : (root as Element).ownerDocument
  return doc?.defaultView ?? null
}

/** Remove our inline margin-top, restoring site-computed style when leaving side mode. */
export function clearPairMargins(root: Document | Element): void {
  for (const t of translations(root)) if (t.style.marginTop) t.style.removeProperty('margin-top')
}

/** Pairs and target margins read this pass; separate reads / writes let cleanup schedule reads before all other writes. */
export interface PairMarginPlan {
  pairs: Array<[Element, HTMLElement, string]>
  wanted: Array<string | null>
}

/**
 * Read: collect pairs, clear previously written margins, measure both computed values. No structural writes (clearing an inline value
 * affects only that element's style, not selector matching). Run before all other writes while styles are clean,
 * avoiding whole-page recalculation. Reading after insertion pays for :has() invalidation, potentially hundreds of milliseconds:
 * issue #46 measured 90 ms per pass, 818 ms over 31 passes in 2312.17141, exposed after removing fitTables' forced layout.
 */
export function readPairMargins(root: Document | Element): PairMarginPlan {
  const view = viewOf(root)
  const pairs: PairMarginPlan['pairs'] = []
  if (!view) return { pairs, wanted: [] }
  for (const t of translations(root)) {
    const original = t.previousElementSibling
    if (!original || original.classList.contains(T_CLASS)) continue
    // In split copies and footnotes, the previous sibling is not the original (removed in clones), so they are not valid pairs.
    // Otherwise 14 caption translations in 2312.17141 copied figure margins (Codex #26).
    if (t.closest(SIDE_DENY_SUBTREE)) continue
    // Clear the previous value first, or we would measure our own write and never adapt to changed column width / site styles.
    const previous = t.style.marginTop
    if (previous) t.style.removeProperty('margin-top')
    pairs.push([original, t, previous])
  }
  // Browsers return 0px for undeclared margins; happy-dom returns empty text. Normalize before comparing.
  const marginTop = (el: Element) => view.getComputedStyle(el).marginTop || '0px'
  const wanted = pairs.map(([original, t]) => {
    const want = marginTop(original)
    return want === marginTop(t) ? null : want
  })
  return { pairs, wanted }
}

/** Write differing margins only; return the count of translations changed (zero once stable). */
export function writePairMargins({ pairs, wanted }: PairMarginPlan): number {
  let changed = 0
  wanted.forEach((want, i) => {
    const [, t, previous] = pairs[i]!
    const next = want ?? ''
    if (next) t.style.marginTop = next // Reads cleared these values; restore unchanged ones too.
    if (next !== previous) changed += 1
  })
  return changed
}

/** Equalize each original / translation pair's top margin; return count changed (zero once stable). */
export function alignPairMargins(root: Document | Element): number {
  return writePairMargins(readPairMargins(root))
}
