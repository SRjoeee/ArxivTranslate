// A block's translation container (ADR-0003): the element that carries a translation, a skeleton
// or a failure widget as the block's next sibling. Shared by translation.ts, pending.ts and
// failed.ts so the three never disagree about what a translation node looks like.
import type { Block, TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { eqnProseCell, isInlineTitleCandidate, visibleText } from '@/core/rules/latexml'

/** A heading whose visible text is at most this long shares its line with the translation */
export const INLINE_TITLE_MAX_CHARS = 60

/** The translation node's classes: the original block's plus axt-t, keeping the site's styles (§7.1) */
export function translationClass(el: Element): string {
  const own = Array.from(el.classList).filter(c => c !== T_CLASS)
  return [...own, T_CLASS].join(' ')
}

/** A short heading shares its line with the translation (§7.3): the pending node is placed the same way, so the layout does not jump when the translation arrives */
export function shouldInline(block: TextBlock): boolean {
  return isInlineTitleCandidate(block.el) && visibleText(block.el).trim().length <= INLINE_TITLE_MAX_CHARS
}

/**
 * A block's translation shell: for most blocks “an element of the original's tag name”; **description rows are the
 * exception** — the content of a `<tr>` must sit in cells, hung under the row directly table layout does not lay it
 * out at all. Returns `node` (what goes into the page) and `slot` (where the content goes); the same element for
 * anything but a description row.
 *
 * The translation, the skeleton and the failure widget **all three come through here**: an exception for the
 * translation alone would hang the waiting ring under `<tr>` directly and make the failure widget a `<span>` child of
 * `<tbody>`, both against the table content model (Codex on #168)
 */
export function translationShell(block: Block, tagName?: string): { node: Element; slot: Element } {
  const doc = block.el.ownerDocument
  const node = doc.createElement(tagName ?? block.el.tagName)
  const cell = eqnProseCell(block.el)
  if (!cell) return { node, slot: node }
  const shell = cell.cloneNode(false) as Element
  // The shell keeps neither the original cell's id nor its block marks (the reason of §6.4: a duplicate id ruins anchors)
  shell.removeAttribute('id')
  node.append(shell)
  return { node, slot: shell }
}
