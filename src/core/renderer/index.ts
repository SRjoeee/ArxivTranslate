// 渲染（DESIGN §7）。原创：三个参考项目都改动 / 包裹 / 替换原节点，与 §7.1 的 DOM 不变量冲突。
// 不变量：译文节点只作为原块的下一个兄弟插入；原节点只追加 data-axt-id / data-axt-state；
// 全局状态只在 <html> 上；restore 后 DOM 与翻译前逐节点相等。
import type { Block, TableBlock, TextBlock } from '@/core/extractor'
import { TABLE_RULES } from '@/core/rules/latexml'
import modesCss from '@/styles/modes.css?inline'

export type Mode = 'stack' | 'side' | 'only'
export type BlockState = 'pending' | 'translated' | 'failed'

export const T_CLASS = 'axt-t'
export const FOR_ATTR = 'data-axt-for'
export const STATE_ATTR = 'data-axt-state'
export const ON_ATTR = 'data-axt-on'
export const MODE_ATTR = 'data-axt-mode'

const STYLE_ATTR = 'data-axt'
const STYLE_MARK = 'modes'
const AXT_ATTR_PREFIX = 'data-axt-'

/** 打开翻译态：<html> 上写状态属性，注入模式样式（幂等） */
export function enable(doc: Document, mode: Mode): void {
  doc.documentElement.setAttribute(ON_ATTR, '')
  doc.documentElement.setAttribute(MODE_ATTR, mode)
  if (!doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)) {
    const style = doc.createElement('style')
    style.setAttribute(STYLE_ATTR, STYLE_MARK)
    style.textContent = modesCss
    doc.head.append(style)
  }
}

/** 模式切换只改一个属性，不经过翻译流程（§4 第 9 步） */
export function setMode(doc: Document, mode: Mode): void {
  doc.documentElement.setAttribute(MODE_ATTR, mode)
}

export function setState(block: Block, state: BlockState): void {
  block.el.setAttribute(STATE_ATTR, state)
}

/** 同一块重复渲染（重试、换引擎）时只保留最新一份 */
function removeExisting(block: Block): void {
  const parent = block.el.parentElement
  if (!parent) return
  for (const sibling of Array.from(parent.children)) {
    if (sibling.classList.contains(T_CLASS) && sibling.getAttribute(FOR_ATTR) === block.id) sibling.remove()
  }
}

function stripIds(root: Element): void {
  root.removeAttribute('id')
  for (const el of Array.from(root.querySelectorAll('[id]'))) el.removeAttribute('id')
}

/** 文本块：与原块同标签名的新元素，内容是 protector 回填的 fragment（克隆已剥 id） */
export function renderText(block: TextBlock, content: DocumentFragment): Element {
  removeExisting(block)
  const node = block.el.ownerDocument.createElement(block.el.tagName)
  node.className = T_CLASS
  node.setAttribute(FOR_ATTR, block.id)
  node.append(content)
  block.el.after(node)
  setState(block, 'translated')
  return node
}

/**
 * 表格块（§5.3）：整表克隆置于原表之后，克隆保留原有类名以沿用页面的表格样式；
 * 有译文的单元格替换内容，数值格与公式格保持克隆内容。cells 的键是原表里的单元格元素。
 */
export function renderTable(block: TableBlock, cells: Map<Element, DocumentFragment>): Element {
  removeExisting(block)
  const clone = block.el.cloneNode(true) as Element
  stripIds(clone)
  // 两棵树结构相同：原表的直接单元格与克隆表的直接单元格按同序对应
  const cloneCells = Array.from(clone.querySelectorAll(TABLE_RULES.cell)).filter(td => td.closest(TABLE_RULES.root) === clone)
  block.cells.forEach((cell, i) => {
    const content = cells.get(cell.el)
    const target = cloneCells[i]
    if (!content || !target) return
    target.textContent = ''
    target.append(content)
  })
  clone.classList.add(T_CLASS)
  clone.setAttribute(FOR_ATTR, block.id)
  block.el.after(clone)
  setState(block, 'translated')
  return clone
}

/** 恢复原文：删所有译文节点、剥所有 data-axt-* 属性、移除注入的样式（含 #axt-debug 的） */
export function restore(doc: Document): { removedNodes: number; strippedAttrs: number } {
  let removedNodes = 0
  let strippedAttrs = 0
  for (const node of Array.from(doc.querySelectorAll(`.${T_CLASS}`))) {
    node.remove()
    removedNodes++
  }
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(AXT_ATTR_PREFIX)) {
        el.removeAttribute(attr.name)
        strippedAttrs++
      }
    }
  }
  for (const style of Array.from(doc.querySelectorAll(`style[${STYLE_ATTR}]`))) style.remove()
  return { removedNodes, strippedAttrs }
}
