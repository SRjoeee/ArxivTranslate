import type { Block } from './index'

/** The block statistics shared by the popup and the test snapshots */
export interface BlockStats {
  total: number
  text: number
  table: number
  cells: number
  numericCells: number
  byUnit: Record<string, number>
}

export function statsOf(blocks: Block[]): BlockStats {
  const s: BlockStats = { total: blocks.length, text: 0, table: 0, cells: 0, numericCells: 0, byUnit: {} }
  for (const b of blocks) {
    s.byUnit[b.unit] = (s.byUnit[b.unit] ?? 0) + 1
    if (b.kind === 'table') {
      s.table++
      s.cells += b.cells.length
      s.numericCells += b.cells.filter(c => c.numeric).length
    } else {
      s.text++
    }
  }
  return s
}
