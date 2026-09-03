// 块提取（DESIGN.md §4.1）。extract() 只读 DOM；markBlocks() 才写 data-axt-id。
// 遍历策略与分类解耦：分类来自 rules/latexml 的 classify()，这里只决定"是否产出"与"是否下钻"。
import { TABLE_RULES, classify, documentRoot, isNumericCell, visibleText } from '@/core/rules/latexml'

export interface Cell {
  el: Element
  /** §5.3 数值格：原样复制，不翻译 */
  numeric: boolean
}

export interface TextBlock {
  id: string
  kind: 'text'
  el: Element
  /** 命中的规则 id */
  unit: string
}

export interface TableBlock {
  id: string
  kind: 'table'
  el: Element
  unit: 'table'
  /** 最外层 .ltx_tabular 的直接单元格；嵌套 tabular 整体属于外层某个单元格 */
  cells: Cell[]
}

export type Block = TextBlock | TableBlock

/** §7.1 允许在原节点追加的属性 */
export const ID_ATTR = 'data-axt-id'

const ELEMENT_NODE = 1
const TEXT_NODE = 3
const LETTER = /\p{L}/u

/**
 * 自有文本：只收集分类为 null 的子树里的文本节点。skip / protect 是不可翻译内容，
 * unit / table 是嵌套单元（各自成块，不算外层的）——比规则模块的 visibleText 多剪后两类。
 */
function ownText(el: Element): string {
  const parts: string[] = []
  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) parts.push((child as Text).data)
      else if (child.nodeType === ELEMENT_NODE && !classify(child as Element)) walk(child as Element)
    }
  }
  walk(el)
  return parts.join('')
}

function cellsOf(table: Element): Cell[] {
  return Array.from(table.querySelectorAll(TABLE_RULES.cell))
    .filter(td => td.closest(TABLE_RULES.root) === table)
    .map(el => ({ el, numeric: isNumericCell(visibleText(el)) }))
}

/** 从翻译根开始按文档序提取块；找不到翻译根返回空数组。不修改 DOM */
export function extract(root: Document | Element): Block[] {
  const start = documentRoot(root)
  if (!start) return []

  const blocks: Block[] = []
  const used = new Set<string>()
  // 元素自带 id（LaTeXML 的 S3.p1.1 等）优先，否则按块序编号；重复加后缀
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
    const c = el === start ? null : classify(el)
    let descend = true
    if (c) {
      switch (c.kind) {
        case 'skip':
          descend = false
          break
        case 'table':
          blocks.push({ id: assignId(el), kind: 'table', el, unit: 'table', cells: cellsOf(el) })
          descend = false
          break
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

/** 写入 data-axt-id。幂等；这是 §7.1 允许在原节点追加的两个属性之一 */
export function markBlocks(blocks: Block[]): void {
  for (const b of blocks) b.el.setAttribute(ID_ATTR, b.id)
}
