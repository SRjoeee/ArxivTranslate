import { stripInjected } from '@/core/marks'

/**
 * Clone a slot node into the target document, strip every id in the cloned subtree (no duplicate anchors, §6.4) and
 * every data-axt-* mark; translation nodes already inside the clone are removed whole — a footnote container is a void
 * slot while its .ltx_note_content is a block of its own, and with the footnote translated before the outer paragraph
 * the outer translation would copy the footnote's translation along (measured 2026-09-04). Other attributes such as
 * href are kept.
 */
export function cloneWithoutIds(doc: Document, node: Node, deep: boolean): Node {
  const clone = doc.importNode(node, deep)
  if (clone.nodeType === 1) stripInjected(clone as Element)
  return clone
}
