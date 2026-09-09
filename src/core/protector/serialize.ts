// Serialization (DESIGN §6.2): block → placeholder text + slot map. Read-only; no DOM writes.
// Reuse rule classification for void / paired: any classify() match (skip / protect / unit / table) is void.
// This covers nested units (footnote containers, inline .ltx_p). Unmatched elements with text are paired; those without text are void.
// Table cells are the sole exception (§5.3): extraction does not descend into tables, so their .ltx_p / titles are not separate blocks.
// Serialize them as ordinary paired elements; otherwise the entire cell becomes one placeholder and loses its text (2410.00260 table 1; Codex #5).
import { isInjected } from '@/core/marks'
import { classify, isTableCell } from '@/core/rules/latexml'
import { escapeText } from './text'

export interface ProtectedBlock {
  /** Placeholder text; & < > in text nodes are escaped. */
  text: string
  /** ID → original node: the entire node for void; the element itself for paired (shallow-cloned on rehydration). */
  slots: Map<number, Node>
  paired: Set<number>
  /** Blocks exceeding VOID_DENSE_THRESHOLD are formula-dense and get their own pipeline batch. */
  voidCount: number
}

export const VOID_DENSE_THRESHOLD = 40

const ELEMENT_NODE = 1
const TEXT_NODE = 3

const hasText = (el: Element) => /\S/.test(el.textContent ?? '')

export function serialize(root: Element): ProtectedBlock {
  const slots = new Map<number, Node>()
  const paired = new Set<number>()
  const parts: string[] = []
  let voidCount = 0
  let next = 1
  const inCell = isTableCell(root)

  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        parts.push(escapeText((child as Text).data))
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element
        // Injected translations and mirrors are not original text; they may already be inside original blocks on retranslation (Codex #8).
        if (isInjected(el)) continue
        const id = next++
        slots.set(id, el)
        const c = classify(el)
        const isVoid = c ? !(inCell && c.kind === 'unit' && hasText(el)) : !hasText(el)
        if (isVoid) {
          voidCount++
          parts.push(`<x id="${id}"/>`)
        } else {
          paired.add(id)
          parts.push(`<t id="${id}">`)
          walk(el)
          parts.push('</t>')
        }
      }
      // Ignore comments and other node types.
    }
  }
  walk(root)
  return { text: parts.join(''), slots, paired, voidCount }
}
