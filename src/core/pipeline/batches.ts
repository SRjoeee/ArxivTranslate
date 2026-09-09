// Batch planning (DESIGN §8.2 / §6.2): split by section and character budget; formula-dense blocks and whole tables get separate batches.
import type { Block, Cell, TableBlock } from '@/core/extractor'
import { VOID_DENSE_THRESHOLD, serialize, type ProtectedBlock } from '@/core/protector'

export interface Segment {
  id: string
  /** Text with placeholders. */
  text: string
  block: Block
  /** Cells of a table block. */
  cell?: Cell
  protected: ProtectedBlock
}

export interface Batch {
  kind: 'text' | 'table'
  segments: Segment[]
  sectionTitle?: string
  /** Table blocks only. */
  block?: TableBlock
}

const TITLE_MAX = 80

const titleOf = (block: Block) => (block.el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)

/**
 * Section title for each block: scan in document order; blocks following a title belong to that section.
 * Viewport batches often exclude their title (already above the viewport), so compute this once for the entire paper at startup (§10).
 */
export function sectionTitles(blocks: Block[]): Map<Block, string> {
  const map = new Map<Block, string>()
  let title: string | undefined
  for (const block of blocks) {
    if (block.kind === 'text' && block.unit === 'title') title = titleOf(block)
    if (title) map.set(block, title)
  }
  return map
}

/** Without sectionOf, infer sections from the supplied blocks (titles start batches); otherwise use it and split on section changes. */
export function planBatches(
  blocks: Block[],
  options: { maxBatchChars: number; maxBatchItems: number },
  sectionOf?: (block: Block) => string | undefined,
): Batch[] {
  const batches: Batch[] = []
  let current: Segment[] = []
  let currentChars = 0
  let currentTitle: string | undefined
  let sectionTitle: string | undefined

  const flush = () => {
    if (current.length === 0) return
    batches.push({ kind: 'text', segments: current, sectionTitle: currentTitle })
    current = []
    currentChars = 0
  }

  for (const block of blocks) {
    if (sectionOf) {
      const next = sectionOf(block)
      if (next !== sectionTitle) {
        flush()
        sectionTitle = next
      }
    } else if (block.kind === 'text' && block.unit === 'title') {
      // Title: update section context and start a new batch.
      flush()
      sectionTitle = titleOf(block)
    }

    if (block.kind === 'table') {
      flush()
      const segments: Segment[] = []
      block.cells.forEach((cell, i) => {
        if (cell.numeric) return
        const protectedCell = serialize(cell.el)
        segments.push({ id: `${block.id}#c${i}`, text: protectedCell.text, block, cell, protected: protectedCell })
      })
      batches.push({ kind: 'table', segments, sectionTitle, block })
      continue
    }

    const protectedBlock = serialize(block.el)
    const segment: Segment = { id: block.id, text: protectedBlock.text, block, protected: protectedBlock }

    if (protectedBlock.voidCount > VOID_DENSE_THRESHOLD) {
      flush()
      batches.push({ kind: 'text', segments: [segment], sectionTitle })
      continue
    }

    if (current.length > 0 && (currentChars + segment.text.length > options.maxBatchChars || current.length >= options.maxBatchItems)) flush()
    if (current.length === 0) currentTitle = sectionTitle
    current.push(segment)
    currentChars += segment.text.length
  }
  flush()
  return batches
}
