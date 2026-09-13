// Mirror nodes in side mode (DESIGN §7.2): content in the left column that has no translation gets a copy in the
// right column, or the right column stays empty, the left column's content spans both, and the alignment breaks.
//
// The test is structural, not a list of class names: a container's direct children that are **neither paired nor
// holding a translation inside** are mirror targets. An early version enumerated .ltx_equation / .ltx_graphics and
// the like, and reference numbers, author names and list numbers — content without a translation all the same —
// were left out (measured on 2609.00097).
//
// Made as soon as the blocks are marked (the first moment of a translation), not when the translation arrives;
// they then stay in the DOM under CSS control, so a mode switch still changes one attribute on <html>.
import { DOCUMENT_ROOT, MARGIN_ASIDE } from '@/core/rules/latexml'
import { ID_ATTR } from '@/core/extractor'
import { INJECTED_SELECTOR, T_CLASS, isInjected, stripInjected } from '@/core/marks'
import { FOR_ATTR, MIRROR_CLASS } from './attrs'
import { MIRROR_CONTAINER, SIDE_STACK, isMirrorContainer } from './side-layout'

/** The data-axt-for prefix of a mirror, so it cannot collide with a real block id */
const MIRROR_ID_PREFIX = 'mirror:'
/** An element with no text and none of these is not worth mirroring (decoration, whitespace) */
const MEDIA = 'img, svg, object, math, table, canvas, video'

function needsMirror(child: Element): boolean {
  // Our own nodes (translations, mirrors, image overlays) are not mirrored
  if (isInjected(child)) return false
  // The margin notes and publication metadata ar5iv floats to the page's outer edge: a mirror would only duplicate them (§7.2)
  if (child.matches(MARGIN_ASIDE)) return false
  // A translation unit: its translation is there or on its way; no copy on top of that
  if (child.hasAttribute(ID_ATTR)) return false
  // Followed by a translation or an image overlay (§15.2): paired already, the right column is not empty
  const next = child.nextElementSibling
  if (next && isInjected(next)) return false
  // An element holding a translation inside is itself a container; its children are handled one by one
  if (child.querySelector(INJECTED_SELECTOR)) return false
  // A block still waiting for its translation inside: copied whole, it would have both the copy and the translation
  // once that arrives. **This gate holds only once the block marks are complete** — it cannot tell “a translation
  // unit not yet marked” from “static content that will never have a translation”. run.ts provides the safety: the
  // block marks are written synchronously in startTranslation, so the first side prep sees the full set (issue #67)
  if (child.querySelector(`[${ID_ATTR}]`)) return false
  return /\S/.test(child.textContent ?? '') || child.querySelector(MEDIA) !== null || child.matches(MEDIA)
}

/**
 * Make mirrors for the container's content that is not paired yet; idempotent, a repeated call does not stack.
 * Returns how many mirrors were made.
 */
export function createMirrors(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  // The translation root must also hold “a translation or a marked block inside” to count as a container. Without
  // that, a call before the translation starts copies the abstract and the sections, whole, into the right column —
  // at that moment they have neither a translation nor a block mark (measured: the whole page repeated)
  if (!isMirrorContainer(scope)) return 0
  const containers = [scope, ...Array.from(scope.querySelectorAll(MIRROR_CONTAINER))].filter(isMirrorContainer)
  let made = 0
  for (const container of containers) {
    if (container.classList.contains(MIRROR_CLASS)) continue
    // A stack region has no right column: a mirror would only add a duplicate to the same column (measured on 2312.17141's multi-panel figures)
    if (container.closest(SIDE_STACK)) continue
    for (const child of Array.from(container.children)) {
      if (!needsMirror(child)) continue
      const clone = child.cloneNode(true) as Element
      // What is cloned into a mirror carries no ids, no block marks and nobody else's translation
      stripInjected(clone)
      clone.classList.add(T_CLASS, MIRROR_CLASS)
      // A mirror is the right column's visual balance, the left column's content exactly, with no translation. Not
      // hidden, a screen reader would read the same figure, the same formula twice.
      // `inert` is the necessary half (the A/B audit caught it on 2401.00596, issue #72): with aria-hidden alone the
      // links in the copy stay in the Tab order — a reference entry carries its DOI / arXiv links — and a keyboard
      // user jumps into a decorative copy the screen reader ignores entirely, where focus lands and nothing is
      // announced (axe: aria-hidden-focus)
      clone.setAttribute('aria-hidden', 'true')
      clone.setAttribute('inert', '')
      clone.setAttribute(FOR_ATTR, `${MIRROR_ID_PREFIX}${made}`)
      child.after(clone)
      made++
    }
  }
  return made
}
