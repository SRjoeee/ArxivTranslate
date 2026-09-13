// Batch planning (DESIGN §8.2 / §6.2): batches cut by section and character budget; a formula-dense block on its own; a table whole in one batch.
import { type RenderPath, wireFormatOf } from '@/cache/key'
import type { Block, Cell, TableBlock } from '@/core/extractor'
import { VOID_DENSE_THRESHOLD, serialize, type ProtectedBlock } from '@/core/protector'
import { squash } from '@/core/text'

export interface Segment {
  id: string
  /** The text with placeholders */
  text: string
  block: Block
  /** The cells of a table block */
  cell?: Cell
  protected: ProtectedBlock
}

export interface Batch {
  kind: 'text' | 'table'
  segments: Segment[]
  sectionTitle?: string
  /** table only */
  block?: TableBlock
}

const TITLE_MAX = 80

const titleOf = (block: Block) => squash(block.el.textContent).slice(0, TITLE_MAX)

/**
 * The section heading each block belongs to: one scan in document order, and every block after a heading block is
 * its. Translating by viewport, a batch mostly holds no heading block (the heading is long above the viewport), so
 * this is computed once for the whole paper at the start (§10)
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

/** Without sectionOf, sections are inferred from the block sequence given (a heading block opens a new batch); with it, batches are cut where the section changes */
export function planBatches(
  blocks: Block[],
  options: { maxBatchChars: number; maxBatchItems: number; renderPath?: RenderPath },
  sectionOf?: (block: Block) => string | undefined,
): Batch[] {
  const format = wireFormatOf(options.renderPath ?? 'tags')
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
      // A heading: the section context moves on, and a new batch opens
      flush()
      sectionTitle = titleOf(block)
    }

    if (block.kind === 'table') {
      flush()
      const segments: Segment[] = []
      block.cells.forEach((cell, i) => {
        if (cell.numeric) return
        const protectedCell = serialize(cell.el, format)
        segments.push({ id: `${block.id}#c${i}`, text: protectedCell.text, block, cell, protected: protectedCell })
      })
      batches.push({ kind: 'table', segments, sectionTitle, block })
      continue
    }

    const protectedBlock = serialize(block.el, format)
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
