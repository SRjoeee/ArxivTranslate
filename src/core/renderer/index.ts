// 渲染（DESIGN §7）。原创：三个参考项目都改动 / 包裹 / 替换原节点，与 §7.1 的 DOM 不变量冲突。
// 不变量：译文节点只作为原块的下一个兄弟插入；原节点只追加 data-axt-id / data-axt-state；
// 全局状态只在 <html> 上；restore 后 DOM 与翻译前逐节点相等。
import type { Block, TableBlock, TextBlock } from '@/core/extractor'
import { TABLE_RULES, isInlineTitleCandidate, visibleText } from '@/core/rules/latexml'
import modesCss from '@/styles/modes.css?inline'

export type Mode = 'stack' | 'side' | 'only'
export type BlockState = 'pending' | 'translated' | 'failed'

export const T_CLASS = 'axt-t'
export const FOR_ATTR = 'data-axt-for'
export const STATE_ATTR = 'data-axt-state'
export const ON_ATTR = 'data-axt-on'
export const MODE_ATTR = 'data-axt-mode'
/** 短标题同行（§7.3）：原标题与译文都带此属性 */
export const INLINE_ATTR = 'data-axt-inline'
/** 原标题可见文本不超过这个长度才与译文同行 */
export const INLINE_TITLE_MAX_CHARS = 60

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

/**
 * 克隆进译文的内容剥掉 id 与全部 data-axt-*（原表、占位符回填的 .ltx_note 都可能带着块标记）。
 * 还要删掉克隆里已有的译文节点：表格单元格里的 .ltx_p 本身也是块，它的译文作为兄弟插在原表内，
 * 整表克隆会把它一起复制进来，于是译文表里出现重复且无 data-axt-for 的节点（2026-09-04 实测）。
 */
function stripCloned(root: Element, includeRoot: boolean): void {
  for (const stale of Array.from(root.querySelectorAll(`.${T_CLASS}`))) stale.remove()
  const targets = Array.from(root.querySelectorAll('*'))
  if (includeRoot) targets.unshift(root)
  for (const el of targets) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith(AXT_ATTR_PREFIX)) el.removeAttribute(name)
  }
}

/** 译文节点的 class：原块的 class 加 axt-t，沿用站点样式（§7.1） */
function translationClass(el: Element): string {
  const own = Array.from(el.classList).filter(c => c !== T_CLASS)
  return [...own, T_CLASS].join(' ')
}

function shouldInline(block: TextBlock): boolean {
  return isInlineTitleCandidate(block.el) && visibleText(block.el).trim().length <= INLINE_TITLE_MAX_CHARS
}

/** 文本块：与原块同标签名的新元素，内容是 protector 回填的 fragment（克隆已剥 id） */
export function renderText(block: TextBlock, content: DocumentFragment): Element {
  removeExisting(block)
  const node = block.el.ownerDocument.createElement(block.el.tagName)
  node.append(content)
  stripCloned(node, false)
  node.className = translationClass(block.el)
  node.setAttribute(FOR_ATTR, block.id)
  if (shouldInline(block)) {
    block.el.setAttribute(INLINE_ATTR, '')
    node.setAttribute(INLINE_ATTR, '')
  }
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
  stripCloned(clone, true)
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

export * from './mirror'
export * from './side-layout'
export * from './table-fit'
export * from './responsive'
