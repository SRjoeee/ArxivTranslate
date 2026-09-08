// 渲染（DESIGN §7）。原创：三个参考项目都改动 / 包裹 / 替换原节点，与 §7.1 的 DOM 不变量冲突。
// 不变量：译文节点只作为原块的下一个兄弟插入；原节点只追加 data-axt-id / data-axt-state；
// 全局状态只在 <html> 上；restore 后 DOM 与翻译前逐节点相等。
import type { Block, TableBlock, TextBlock } from '@/core/extractor'
import { AXT_ATTR_PREFIX, INJECTED_SELECTOR, T_CLASS, isInjected, stripInjected } from '@/core/marks'
import { isInlineTitleCandidate, tableCells, visibleText } from '@/core/rules/latexml'
import imageCss from '@/styles/image.css?inline'
import modesCss from '@/styles/modes.css?inline'
import presetsCss from '@/styles/presets.css?inline'
import { STYLE_ATTR_NAME, customStyleRule, styleVarsRule, type StylePreset, type StyleVars } from './style-preset'
import { delocalizeNotes } from './notes'
import { cancelSpinnersIn } from './spinner'

export type Mode = 'stack' | 'side' | 'only'
export type BlockState = 'pending' | 'translated' | 'failed'

export { T_CLASS }
export const FOR_ATTR = 'data-axt-for'
export const STATE_ATTR = 'data-axt-state'
export const ON_ATTR = 'data-axt-on'
export const MODE_ATTR = 'data-axt-mode'
/** 短标题同行（§7.3）：原标题与译文都带此属性 */
export const INLINE_ATTR = 'data-axt-inline'
/** 译文语言（BCP-47），由 enable 写在 <html> 上供 renderText 读取 */
export const LANG_ATTR = 'data-axt-lang'
/**
 * 「译文与原文逐字相同」的标记（Codex 在 #74 指出）。默认提示词里那条
 * 「Keep author names, journal names, conference names … in the original language」
 * 会让纯人名的引文作者段原样返回，`renderText` 又无条件插入兄弟节点——
 * stack 模式下每一行作者就出现两遍。这不限于人名：任何译文等于原文的块都一样。
 * 标出来交给 CSS：stack 藏掉重复的那份，side 要靠它撑住右栏、only 原块本来就隐藏，都保留
 */
export const IDENTITY_ATTR = 'data-axt-identity'
/**
 * 表翻了一半（§5.3）：原表仍是 translated（only 模式照常只显示克隆），另加此标记画失败提示线、计入失败数。
 * 不能直接标 failed——only 模式只隐藏 translated，原表与半份克隆会一起露出来（Codex 在 #30 指出）
 */
export const PARTIAL_ATTR = 'data-axt-partial'
/** 原标题可见文本不超过这个长度才与译文同行 */
export const INLINE_TITLE_MAX_CHARS = 60

/** 注入的 <style> 的标记属性；恢复原文时按它整体移除。曾叫 data-axt，不合硬规则 5 的 data-axt- 前缀（Codex 在 #3 指出） */
/** 我们注入的 <style> 元素的标记；恢复原文时按它清理。与 <html> 上的 data-axt-style（样式预设）不是一回事 */
export const STYLE_ATTR = 'data-axt-sheet'
const STYLE_MARK = 'modes'

/** 注入样式表所需的全部用户可调项（§7.5） */
export interface StyleOptions extends StyleVars {
  preset: StylePreset
  customCss?: string
}

/**
 * 注入表的内容。顺序即层叠顺序，两处**必须**保持：
 * - `styleVarsRule` 排在 presetsCss 之后：`muted` / `green` 也写 `--axt-color`，选择器形状与特异度相同，
 *   靠顺序让用户的值赢；`--axt-accent` 同理覆盖 presets.css 里的默认强调色
 * - `customStyleRule` 排在最后：它是进阶逃生口，该有最后的发言权
 */
function styleSheet(style?: StyleOptions): string {
  const vars = style ? styleVarsRule(style) : ''
  const custom = style ? customStyleRule(style.customCss ?? '') : ''
  return `${modesCss}\n${presetsCss}\n${imageCss}\n${vars}${custom}`
}

/**
 * 只改外观、不碰任何译文节点（#47）：写 `data-axt-style`，重算注入表的内容。
 * 设置页改颜色时走这条，**不重新请求翻译**（§8.5 的 chainConfigChanged 本来就忽略 style）。
 * 翻译没开着（没有注入表）时什么都不做——下次 enable 会带上新值
 */
export function applyStyle(doc: Document, style: StyleOptions): boolean {
  const sheet = doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)
  if (!sheet) return false
  setStylePreset(doc, style)
  const css = styleSheet(style)
  if (sheet.textContent !== css) sheet.textContent = css
  return true
}

/**
 * 打开翻译态：<html> 上写状态属性，注入模式与预设样式（幂等）。
 * 样式预设与模式一样只是 <html> 上的一个属性（§7.5），切换不动 DOM；自定义 CSS 每次注入时重算
 */
export function enable(doc: Document, mode: Mode, style?: StyleOptions, lang?: string): void {
  doc.documentElement.setAttribute(ON_ATTR, '')
  doc.documentElement.setAttribute(MODE_ATTR, mode)
  // 译文的语言记在 <html> 上（§7.1：全局状态只在这里），renderText 逐个写到译文节点的 lang 上。
  // 不能直接改 <html lang>：那会把原文也说成中文
  if (lang) doc.documentElement.setAttribute(LANG_ATTR, lang)
  if (style) setStylePreset(doc, style)
  const existing = doc.querySelector(`style[${STYLE_ATTR}="${STYLE_MARK}"]`)
  const css = styleSheet(style)
  if (existing) {
    // 自定义 CSS 可能变了（设置页改完再翻一次）：内容不同才写，避免无谓的样式重算
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const el = doc.createElement('style')
  el.setAttribute(STYLE_ATTR, STYLE_MARK)
  el.textContent = css
  doc.head.append(el)
}

/** 只改属性的样式切换（§7.5）；custom 的声明块由 enable 注入 */
export function setStylePreset(doc: Document, style: { preset: StylePreset }): void {
  doc.documentElement.setAttribute(STYLE_ATTR_NAME, style.preset)
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
  // 同行标记也跟着译文走：留着它，没有译文的短标题仍会被压成 inline-block（Codex 在 #30 指出）；renderText 成功后再加回
  block.el.removeAttribute(INLINE_ATTR)
  const parent = block.el.parentElement
  if (!parent) return
  for (const sibling of Array.from(parent.children)) {
    if (sibling.classList.contains(T_CLASS) && sibling.getAttribute(FOR_ATTR) === block.id) {
      // pending 节点里有圆环：先取消动画再删（§7.6）
      cancelSpinnersIn(sibling)
      sibling.remove()
    }
  }
}

/** 译文节点的 class：原块的 class 加 axt-t，沿用站点样式（§7.1） */
export function translationClass(el: Element): string {
  const own = Array.from(el.classList).filter(c => c !== T_CLASS)
  return [...own, T_CLASS].join(' ')
}

/** 短标题与译文同行（§7.3）：pending 节点也按此放，译文到达时版式不跳 */
export function shouldInline(block: TextBlock): boolean {
  return isInlineTitleCandidate(block.el) && visibleText(block.el).trim().length <= INLINE_TITLE_MAX_CHARS
}

/** 文本块：与原块同标签名的新元素，内容是 protector 回填的 fragment（克隆已剥 id） */
export function renderText(block: TextBlock, content: DocumentFragment): Element {
  clearTranslation(block)
  const node = block.el.ownerDocument.createElement(block.el.tagName)
  node.append(content)
  // 表格单元格里的 .ltx_p 本身也是块，它的译文作为兄弟插在原表内，整表克隆会把它一起复制进来（2026-09-04 实测）
  stripInjected(node, false)
  node.className = translationClass(block.el)
  node.setAttribute(FOR_ATTR, block.id)
  // 译文是另一种语言，页面的 <html lang> 说的是原文（arXiv 上是 en）。不标的话屏幕阅读器会用英文
  // 语音去念中文（实测：14 个译文节点全部继承 lang="en"，Codex 的同行审计没查到这条）
  const lang = block.el.ownerDocument.documentElement.getAttribute(LANG_ATTR)
  if (lang) node.setAttribute('lang', lang)
  if (shouldInline(block)) {
    block.el.setAttribute(INLINE_ATTR, '')
    node.setAttribute(INLINE_ATTR, '')
  }
  // 归一化后逐字相同 = 这一块其实没被翻译。空白差异不算数：rehydrate 回填时
  // 标签边界处的空白与原文未必一一对应。
  // 两边都要**跳过注入节点**（Codex 在 #81 指出）：块可以嵌套，内层块先翻完的话
  // 原块的 textContent 里就多出一段内层译文，而候选译文那边 stripCloned 早把它删了——
  // 不排除的话，一个原样返回的外层块永远判不成恒等，stack 模式下照旧重复
  if (squash(ownText(node)) === squash(ownText(block.el))) node.setAttribute(IDENTITY_ATTR, '')
  block.el.after(node)
  setState(block, 'translated')
  return node
}

const squash = (text: string | null) => (text ?? '').replace(/\s+/g, ' ').trim()

/** 元素自己的文本，不含我们注入的节点（译文 / 镜像 / 拆分副本 / 圆环 / 失败小部件） */
function ownText(el: Element): string {
  let text = ''
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 1) {
      const element = child as Element
      if (isInjected(element)) continue
      text += ownText(element)
    } else text += child.textContent ?? ''
  }
  return text
}

/**
 * 表格块（§5.3）：整表克隆置于原表之后，克隆保留原有类名以沿用页面的表格样式；
 * 有译文的单元格替换内容，数值格与公式格保持克隆内容。cells 的键是原表里的单元格元素。
 */
export function renderTable(block: TableBlock, cells: Map<Element, DocumentFragment>): Element {
  clearTranslation(block)
  const clone = block.el.cloneNode(true) as Element
  stripInjected(clone)
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

/** 恢复原文：删所有注入节点（译文与图片叠加层，§7.1 第 4 条）、剥所有 data-axt-* 属性、移除注入的样式（含 #axt-debug 的） */
export function restore(doc: Document): { removedNodes: number; strippedAttrs: number } {
  let removedNodes = 0
  let strippedAttrs = 0
  for (const node of Array.from(doc.querySelectorAll(INJECTED_SELECTOR))) {
    cancelSpinnersIn(node)
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
export * from './anchors'
export * from './prep'
export * from './split-figures'
export * from './responsive'
export * from './spinner'
export * from './pending'
export * from './failed'
export * from './style-preset'
export * from './image'
