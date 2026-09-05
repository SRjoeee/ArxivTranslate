// 渲染（DESIGN §7）。原创：三个参考项目都改动 / 包裹 / 替换原节点，与 §7.1 的 DOM 不变量冲突。
// 不变量：译文节点只作为原块的下一个兄弟插入；原节点只追加 data-axt-id / data-axt-state；
// 全局状态只在 <html> 上；restore 后 DOM 与翻译前逐节点相等。
import type { Block, TableBlock, TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { isInlineTitleCandidate, tableCells, visibleText } from '@/core/rules/latexml'
import modesCss from '@/styles/modes.css?inline'
import { delocalizeNotes } from './notes'

export type Mode = 'stack' | 'side' | 'only'
export type BlockState = 'pending' | 'translated' | 'failed'

export { T_CLASS }
export const FOR_ATTR = 'data-axt-for'
export const STATE_ATTR = 'data-axt-state'
export const ON_ATTR = 'data-axt-on'
export const MODE_ATTR = 'data-axt-mode'
/** 短标题同行（§7.3）：原标题与译文都带此属性 */
export const INLINE_ATTR = 'data-axt-inline'
/**
 * 表翻了一半（§5.3）：原表仍是 translated（only 模式照常只显示克隆），另加此标记画失败提示线、计入失败数。
 * 不能直接标 failed——only 模式只隐藏 translated，原表与半份克隆会一起露出来（Codex 在 #30 指出）
 */
export const PARTIAL_ATTR = 'data-axt-partial'
/** 原标题可见文本不超过这个长度才与译文同行 */
export const INLINE_TITLE_MAX_CHARS = 60

/** 注入的 <style> 的标记属性；恢复原文时按它整体移除。曾叫 data-axt，不合硬规则 5 的 data-axt- 前缀（Codex 在 #3 指出） */
export const STYLE_ATTR = 'data-axt-style'
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
  // 状态一变，上一轮的"翻了一半"标记就过期了；部分成功要在 setState 之后再标
  block.el.removeAttribute(PARTIAL_ATTR)
}

export function markPartial(block: Block): void {
  block.el.setAttribute(PARTIAL_ATTR, '')
}

/**
 * 删掉该块已有的译文：同一块重复渲染（重试、换引擎）时只保留最新一份；
 * 再翻失败时也要删——换了引擎 / 目标语言后页面不能还挂着上一轮的译文冒充这一轮的（Codex 在 #9 指出）
 */
export function clearTranslation(block: Block): void {
  // 脚注归位的标记与副本跟着译文走：译文没了，原件边注要重新露出来
  delocalizeNotes(block.el)
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
  clearTranslation(block)
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
  clearTranslation(block)
  const clone = block.el.cloneNode(true) as Element
  stripCloned(clone, true)
  // 两棵树结构相同：原表的单元格与克隆表的单元格按同序对应（tableCells 取任意深度，嵌套 tabular 的格也在内）。
  // 每格替换前重新定位：外层格的译文里带着嵌套表的克隆，先替换外层再替换内层，
  // 事先取好的内层引用会指向已被丢弃的节点（§5.3）
  block.cells.forEach((cell, i) => {
    const content = cells.get(cell.el)
    if (!content) return
    const target = tableCells(clone)[i]
    if (!target) return
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
  // 先删样式再剥属性：样式标记本身也是 data-axt-* 属性，剥完就找不到它了
  for (const style of Array.from(doc.querySelectorAll(`style[${STYLE_ATTR}]`))) style.remove()
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (attr.name.startsWith(AXT_ATTR_PREFIX)) {
        el.removeAttribute(attr.name)
        strippedAttrs++
      }
    }
  }
  return { removedNodes, strippedAttrs }
}

export * from './mirror'
export * from './side-layout'
export * from './table-fit'
export * from './pair-margins'
export * from './notes'
export * from './split-figures'
export * from './responsive'
