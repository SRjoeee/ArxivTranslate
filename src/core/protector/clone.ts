import { stripInjected } from '@/core/marks'

/**
 * Clone slot nodes into the target document, stripping all IDs (avoid duplicate anchors, §6.4) and data-axt-* attributes.
 * Remove existing translation nodes entirely: a footnote container is a void slot, but its .ltx_note_content is a separate block.
 * Translating the footnote first would otherwise copy its translation into the outer paragraph's translation (observed 2026-09-04).
 * Preserve other attributes, including href.
 */
export function cloneWithoutIds(doc: Document, node: Node, deep: boolean): Node {
  const clone = doc.importNode(node, deep)
  if (clone.nodeType === 1) stripInjected(clone as Element)
  return clone
}
