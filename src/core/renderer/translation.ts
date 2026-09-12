// A block's translation node (DESIGN §7; ADR-0003). 原创：三个参考项目都改动 / 包裹 / 替换原节点，
// 与 §7.1 的 DOM 不变量冲突。
// 不变量：译文节点只作为原块的下一个兄弟插入；原节点只追加 data-axt-* 属性；restore 后 DOM 与翻译前逐节点相等。
import type { Block, TableBlock, TextBlock } from '@/core/extractor'
import { T_CLASS, isInjected, stripInjected } from '@/core/marks'
import { tableCells } from '@/core/rules/latexml'
import { type BlockState, DIR_ATTR, FOR_ATTR, IDENTITY_ATTR, INLINE_ATTR, LANG_ATTR, PARTIAL_ATTR, STATE_ATTR } from './attrs'
import { delocalizeNotes } from './notes'
import { shouldInline, translationClass, translationShell } from './shell'
import { cancelSkeletonsIn } from './skeleton'
import { collectText, squash } from '@/core/text'

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
      cancelSkeletonsIn(sibling)
      sibling.remove()
    }
  }
}

/**
 * 回填出来的片段本身是不是一个单元格。
 *
 * 占位符路径下说明行整格就是一个成对占位符，`rehydrate` 交回来的顶层元素**已经是 `<td>`**；
 * 再套一层壳就成了 `<tr><td><td>…</td></td></tr>`（Codex 在 #168 指出，我的第一版测试用裸文本
 * fragment 所以没抓到）。runs 降级路径把标记拍平，那时交回来的是纯文本，仍然需要壳
 */
function isCellFragment(content: DocumentFragment): boolean {
  let cell: Element | null = null
  for (const node of Array.from(content.childNodes)) {
    if (node.nodeType === 1) {
      if (cell) return false
      const el = node as Element
      if (!el.matches('td, th')) return false
      cell = el
    } else if (/\S/.test(node.textContent ?? '')) {
      return false
    }
  }
  return cell !== null
}

/** 文本块：与原块同标签名的新元素，内容是 protector 回填的 fragment（克隆已剥 id） */
export function renderText(block: TextBlock, content: DocumentFragment): Element {
  clearTranslation(block)
  const { node, slot } = translationShell(block)
  // 回填出来的已经是一个 `<td>` 时直接用它，别再套壳（见 isCellFragment）
  if (slot !== node && isCellFragment(content)) {
    slot.remove()
    node.append(content)
  } else {
    slot.append(content)
  }
  // 表格单元格里的 .ltx_p 本身也是块，它的译文作为兄弟插在原表内，整表克隆会把它一起复制进来（2026-09-04 实测）
  stripInjected(node, false)
  node.className = translationClass(block.el)
  node.setAttribute(FOR_ATTR, block.id)
  // 译文是另一种语言，页面的 <html lang> 说的是原文（arXiv 上是 en）。不标的话屏幕阅读器会用英文
  // 语音去念中文（实测：14 个译文节点全部继承 lang="en"，Codex 的同行审计没查到这条）
  const html = block.el.ownerDocument.documentElement
  const lang = html.getAttribute(LANG_ATTR)
  if (lang) node.setAttribute('lang', lang)
  // 从右往左的语言还要 `dir`：`lang` 只说"这是哪种语言"，段落的基方向由 `dir` 定。
  // 只给真正的译文写——骨架屏、失败小部件是界面语言，镜像里装的是原文
  const dir = html.getAttribute(DIR_ATTR)
  if (dir) node.setAttribute('dir', dir)
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

/** The element's own text, without the nodes we inject (translation, mirror, split copy, skeleton, failure widget) */
const ownText = (el: Element): string => collectText(el, isInjected)

/**
 * 表格块（§5.3）：整表克隆置于原表之后，克隆保留原有类名以沿用页面的表格样式；
 * 有译文的单元格替换内容，数值格与公式格保持克隆内容。cells 的键是原表里的单元格元素。
 *
 * @param rendered filled in with original cell → the clone's cell that now holds its translation,
 *   so the caller can pair the two sides for the hover highlight (§7.7). Only the clone's cells are
 *   on screen, and they are built here, so nowhere else can make that pairing.
 */
export function renderTable(block: TableBlock, cells: Map<Element, DocumentFragment>, rendered?: Map<Element, Element>): Element {
  clearTranslation(block)
  const clone = block.el.cloneNode(true) as Element
  stripInjected(clone)
  // 译文单元格也要 `lang` / `dir`，理由与 renderText 里那两段完全相同（Codex 在 #163 指出表格这条
  // 路漏了 `dir`；`lang` 同样漏了，屏幕阅读器会用英文语音念表格里的中文）。打在**换过内容的格**上
  // 而不是整张表上：`dir` 落到 `<table>` 会连列序一起翻转，而这张克隆表里没被翻译的数字列仍是原样，
  // 翻转列序会让它与上面的原表对不上；落到格上只改这一格里文本的基方向，正是我们要的那一点
  const html = block.el.ownerDocument.documentElement
  const cellLang = html.getAttribute(LANG_ATTR)
  const cellDir = html.getAttribute(DIR_ATTR)
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
    if (cellLang) target.setAttribute('lang', cellLang)
    if (cellDir) target.setAttribute('dir', cellDir)
    rendered?.set(cell.el, target)
  })
  clone.classList.add(T_CLASS)
  clone.setAttribute(FOR_ATTR, block.id)
  block.el.after(clone)
  setState(block, 'translated')
  return clone
}
