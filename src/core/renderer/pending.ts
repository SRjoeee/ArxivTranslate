// The pending translation node (DESIGN §7.6): inserted after the original block before the request goes out, a
// skeleton inside; replaced by the real translation when it arrives — clearTranslation at the start of renderText /
// renderTable removes the sibling with the same data-axt-for. In keeping with §7.1: it is only the original block's
// next sibling, and the original node is untouched.
import type { Block, TextBlock } from '@/core/extractor'
import { FOR_ATTR, INLINE_ATTR, PENDING_CLASS } from './attrs'
import { shouldInline, translationClass, translationShell } from './shell'
import { cancelSkeletonsIn, createSkeletonInside } from './skeleton'
import { clearTranslation, setState } from './translation'


function pendingOf(block: Block): Element | null {
  const next = block.el.nextElementSibling
  return next?.classList.contains(PENDING_CLASS) && next.getAttribute(FOR_ATTR) === block.id ? next : null
}

/**
 * Insert the pending node: the original's tag (a div for table blocks — a table only once the whole clone is there),
 * the original's classes plus axt-t axt-pending. Idempotent: an existing one is returned. A short heading stays on
 * one line per §7.3, with the skeleton after the heading, so the layout does not jump when the translation arrives
 */
export function renderPending(block: Block): Element {
  const existing = pendingOf(block)
  if (existing) return existing
  // A retry has to **return the whole block to the pending state**, and nothing from the previous round may remain:
  //   - the failure widget (`.axt-error`): `pendingOf` does not recognise it, the skeleton would go between the
  //     original and the widget, and the reader would see “translating” and the exclamation mark with “retry” at once, with an extra item in
  //     the right column in side mode (Codex on #36);
  //   - `data-axt-state="failed"`: modes.css paints the red line by it; uncleared, the skeleton breathes and the red
  //     line stays through the retry (#76);
  //   - **a half-translated table**: the `cells.size > 0` path goes through `renderTable` + `markPartial`, which
  //     **builds no widget** yet records the block as failed (run.ts:240-246). So the reset cannot hang on “a widget
  //     was removed” — for such a block `clearFailed` returns false, and the old clone, `data-axt-partial` and the
  //     translated state would stay as they were (#81).
  // `clearTranslation` clears the translation / the half-finished one / the widget of the same id together, and
  // `setState` clears the partial mark along the way
  clearTranslation(block)
  setState(block, 'pending')
  // A description row's ring goes into a cell as well: hung under `<tr>` directly, table layout does not lay it out (Codex on #168)
  const { node, slot } = translationShell(block, block.kind === 'table' ? 'div' : undefined)
  node.className = `${translationClass(block.el)} ${PENDING_CLASS}`
  node.setAttribute(FOR_ATTR, block.id)
  if (block.kind === 'text' && shouldInline(block as TextBlock)) {
    block.el.setAttribute(INLINE_ATTR, '')
    node.setAttribute(INLINE_ATTR, '')
  }
  // The bars are estimated from the original's length (skeleton.ts says why nothing is measured); a short heading on the same line gets one bar
  createSkeletonInside(slot as HTMLElement, { chars: block.el.textContent?.length ?? 0, inline: node.hasAttribute(INLINE_ATTR) })
  block.el.after(node)
  return node
}

/** Stop the session: every pending node on the page removed at once; returns how many */
export function clearAllPending(doc: Document): number {
  const nodes = Array.from(doc.querySelectorAll(`.${PENDING_CLASS}`))
  for (const node of nodes) {
    cancelSkeletonsIn(node)
    node.remove()
  }
  return nodes.length
}
