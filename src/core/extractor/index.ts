// Block extraction (DESIGN.md §4.1). extract() only reads the DOM; markBlocks() is what writes data-axt-id.
// The traversal is decoupled from the classification: classification comes from classify() of rules/latexml, and
// this file decides only “yield or not” and “descend or not”.
import { isInjected } from '@/core/marks'
import { YIELDS_TO_OUTER_BLOCK, classify, documentRoot, isNumericCell, tableCells } from '@/core/rules/latexml'
import { collectText } from '@/core/text'

export interface Cell {
  el: Element
  /** §5.3 numeric cells: copied as they are, not translated */
  numeric: boolean
}

export interface TextBlock {
  id: string
  kind: 'text'
  el: Element
  /** The id of the rule matched */
  unit: string
}

export interface TableBlock {
  id: string
  kind: 'table'
  el: Element
  unit: 'table'
  /** The direct cells of the outermost .ltx_tabular; a nested tabular belongs whole to some outer cell */
  cells: Cell[]
}

export type Block = TextBlock | TableBlock

/** The attributes §7.1 allows to be added to an original node */
export const ID_ATTR = 'data-axt-id'

const LETTER = /\p{L}/u

/**
 * Own text: only the text nodes of subtrees classified null are collected. skip / protect are untranslatable content,
 * unit / table are nested units (blocks of their own, not the outer's) — two categories more than the rules module's
 * visibleText prunes. The translations / mirrors we inserted do not count either (on a re-extraction they are already inside the block).
 */
function ownText(el: Element): string {
  return collectText(el, child => isInjected(child) || classify(child) !== null)
}

/**
 * A cell's text: skip / protect and nested tables excluded (a nested table's cells are cells of their own); the
 * .ltx_p and other units inside the cell count — they are no blocks of their own, and the protector walks into them
 * when serialising (§5.3).
 */
function cellText(el: Element): string {
  return collectText(el, child => {
    if (isInjected(child)) return true
    const kind = classify(child)?.kind
    return kind === 'skip' || kind === 'protect' || kind === 'table'
  })
}

/** Cells at any depth count: a nested tabular's cells are the outer block's cells, and an outer cell holding only a nested table has no own text and is copied as a numeric cell */
function cellsOf(table: Element): Cell[] {
  return tableCells(table).map(el => ({ el, numeric: isNumericCell(cellText(el)) }))
}

/** At least one cell that is neither numeric nor letterless makes a table worth translating; an empty layout table or a formula-only table is no block */
function hasTranslatableCell(cells: Cell[]): boolean {
  return cells.some(c => !c.numeric && LETTER.test(cellText(c.el)))
}

/** Extract the blocks in document order from the translation root; an empty array when the root is not found. The DOM is not modified */
export function extract(root: Document | Element): Block[] {
  const start = documentRoot(root)
  if (!start) return []

  const blocks: Block[] = []
  const used = new Set<string>()
  // The element's own id (LaTeXML's S3.p1.1 and the like) is preferred, else numbered by block order; a duplicate gets a suffix
  const assignId = (el: Element): string => {
    const base = el.id || `axt-b${blocks.length + 1}`
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }

  /**
   * The units that really yielded a block. The units in `YIELDS_TO_OUTER_BLOCK` (a description row in an equation
   * group) give way by it: the outer becoming a block means it has cloned the whole group into its own translation as
   * a void, and a block for the row on top would make two copies. Judged by “the outer really became a block”, not
   * “an ancestor matches a unit selector” — the latter also hits “a unit ancestor that has no ownText of its own and
   * so is no block” (Codex on #168). The walk is pre-order, so an ancestor is finished before its descendants, and by
   * the time this is consulted the table is complete for the ancestors
   */
  const emitted = new Set<Element>()
  const underEmittedBlock = (el: Element): boolean => {
    for (let p = el.parentElement; p; p = p.parentElement) if (emitted.has(p)) return true
    return false
  }

  const stack: Element[] = [start]
  while (stack.length) {
    const el = stack.pop()!
    // The translations / mirrors we inserted carry the original block's class and the rules would take them for blocks; on a re-extraction they are already in the page (Codex on #8)
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
          if (YIELDS_TO_OUTER_BLOCK.has(c.rule) && underEmittedBlock(el)) break
          if (LETTER.test(ownText(el))) {
            blocks.push({ id: assignId(el), kind: 'text', el, unit: c.rule })
            emitted.add(el)
          }
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

/** Write data-axt-id. Idempotent; one of the two attributes §7.1 allows on an original node */
export function markBlocks(blocks: Block[]): void {
  for (const b of blocks) b.el.setAttribute(ID_ATTR, b.id)
}

export * from './context'
