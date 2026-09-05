// 批次规划（DESIGN §8.2 / §6.2）：按章节与字符预算切批；公式密集块单独成批；表格整表一批。
import type { Block, Cell, TableBlock } from '@/core/extractor'
import { VOID_DENSE_THRESHOLD, serialize, type ProtectedBlock } from '@/core/protector'

export interface Segment {
  id: string
  /** 带占位符的文本 */
  text: string
  block: Block
  /** 表格块的单元格 */
  cell?: Cell
  protected: ProtectedBlock
}

export interface Batch {
  kind: 'text' | 'table'
  segments: Segment[]
  sectionTitle?: string
  /** 仅 table */
  block?: TableBlock
}

const TITLE_MAX = 80

const titleOf = (block: Block) => (block.el.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX)

/**
 * 每个块所属的章节标题：按文档序扫一遍，标题块之后的块都归它。
 * 按视口翻时一批里多半没有标题块（标题早在视口上方），所以要在开始时对整篇算一次（§10）
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

/** 不传 sectionOf 时从传入的块序列里推章节（标题块开启新批次）；传了就按它，章节变化处切批 */
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
      // 标题：更新章节上下文，并开启新批次
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
