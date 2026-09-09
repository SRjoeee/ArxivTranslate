// Block extraction (DESIGN.md §4.1). extract() only reads the DOM; markBlocks() writes data-axt-id.
// Traversal and classification are separate: rules/latexml classify() classifies; this module decides whether to emit and descend.
import { isInjected } from '@/core/marks'
import { classify, documentRoot, isNumericCell, tableCells } from '@/core/rules/latexml'

export interface Cell {
  el: Element
  /** Numeric cells (§5.3): copy unchanged without translation. */
  numeric: boolean
}

export interface TextBlock {
  id: string
  kind: 'text'
  el: Element
  /** Matched rule ID. */
  unit: string
}

export interface TableBlock {
  id: string
  kind: 'table'
  el: Element
  unit: 'table'
  /** Direct cells of the outermost .ltx_tabular; nested tables belong to an outer cell. */
  cells: Cell[]
}

export type Block = TextBlock | TableBlock

/** Attributes allowed on original nodes (§7.1). */
export const ID_ATTR = 'data-axt-id'

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const LETTER = /\p{L}/u

/**
 * Own text: collect text only from subtrees classified as null. skip / protect are not translatable;
 * unit / table are nested units with their own blocks, so prune these too, unlike the rules module's visibleText.
 * Exclude injected translations and mirrors, which may already be inside original blocks on re-extraction.
 */
function ownText(el: Element): string {
  const parts: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) parts.push((child as Text).data)
      else if (child.nodeType === ELEMENT_NODE && !isInjected(child as Element) && !classify(child as Element)) walk(child as Element)
    }
  }
  walk(el)
  return parts.join('')
}

/**
 * Cell text excludes skip / protect and nested tables (whose cells are handled separately). Include units such as .ltx_p:
 * they are not separate blocks within cells; the protector descends into them during serialization (§5.3).
 */
function cellText(el: Element): string {
  const parts: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        parts.push((child as Text).data)
      } else if (child.nodeType === ELEMENT_NODE) {
        const c = child as Element
        if (isInjected(c)) continue
        const kind = classify(c)?.kind
        if (kind === 'skip' || kind === 'protect' || kind === 'table') continue
        walk(c)
      }
    }
  }
  walk(el)
  return parts.join('')
}

/** Include cells at any depth. Nested cells belong to the outer block; an outer cell containing only a nested table has no own text and is copied as numeric. */
function cellsOf(table: Element): Cell[] {
  return tableCells(table).map(el => ({ el, numeric: isNumericCell(cellText(el)) }))
}

/** A table needs at least one nonnumeric cell containing letters; empty layout tables and formula-only tables do not become blocks. */
function hasTranslatableCell(cells: Cell[]): boolean {
  return cells.some(c => !c.numeric && LETTER.test(cellText(c.el)))
}

/** Extract blocks in document order from the translation root; return [] if absent. Does not modify the DOM. */
export function extract(root: Document | Element): Block[] {
  const start = documentRoot(root)
  if (!start) return []

  const blocks: Block[] = []
  const used = new Set<string>()
  // Prefer existing IDs (e.g. LaTeXML S3.p1.1); otherwise number by block order. Suffix duplicates.
  const assignId = (el: Element): string => {
    const base = el.id || `axt-b${blocks.length + 1}`
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }

  const stack: Element[] = [start]
  while (stack.length) {
    const el = stack.pop()!
    // Injected translations and mirrors retain original classes and would be classified as blocks on re-extraction (Codex #8).
    if (el !== start && isInjected(el)) continue
    const c = el === start ? null : classify(el)
    let descend = true
    if (c) {
      switch (c.kind) {
        case 'skip':
          descend = false
          break
        case 'table': {
          const cells = cellsOf(el)
          if (hasTranslatableCell(cells)) blocks.push({ id: assignId(el), kind: 'table', el, unit: 'table', cells })
          descend = false
          break
        }
        case 'unit':
          if (LETTER.test(ownText(el))) blocks.push({ id: assignId(el), kind: 'text', el, unit: c.rule })
          break
        case 'protect':
          descend = c.descend
          break
      }
    }
    if (descend) {
      const children = Array.from(el.children)
      for (let i = children.length - 1; i >= 0; i--) stack.push(children[i]!)
    }
  }
  return blocks
}

/** Write data-axt-id idempotently; one of the two attributes §7.1 permits on original nodes. */
export function markBlocks(blocks: Block[]): void {
  for (const b of blocks) b.el.setAttribute(ID_ATTR, b.id)
}

export * from './context'
