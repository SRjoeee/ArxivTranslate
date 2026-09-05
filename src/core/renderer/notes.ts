// 脚注在 side 模式下的两栏归位（DESIGN §7.2）。
//
// 段落译文由占位符协议回填，脚注是受保护节点，所以**译文段落里会重建一份原文脚注**：
// 同一条脚注在页面上出现两次，一次跟着原文、一次跟着译文。
//
// 这里把脚注的译文**复制**进那份副本，副本因此是"原文 + 译文"上下排；
// 原件那份标上 data-axt-note，由样式隐藏（原件里的译文随整个边注框一起藏起来）。
// 结果是页面右缘只挂一份边注，英文在上、中文在下
// （实测 2312.17141：文档 522→2026，边注 2042→2522，side 与 stack 都只剩一份）。
//
// 是复制不是移动：renderText 二次翻译时靠"原块的兄弟"找旧译文来替换，译文被搬走后
// 它找不到、旧副本又会随段落译文一起被删，脚注译文就丢了（Codex 在 #26 指出）。
// 副本按内容比对，译文变了（换目标语言重翻）就换新的。
//
// 边注的位置沿用 arXiv 自己的（float + 负边距挂到文章外），不要改：试过把它收进本栏，
// 正文被挤、列表项还被盖住（ar5iv 给列表项里的脚注写死了 height: 0），用户反馈"影响阅读"。
//
// 隐藏只认 data-axt-note 标记、且标记只在复制成功时才打：第一版用一条无条件的 CSS 藏原件译文，
// JS 没跑到中文就凭空消失。现在没跑到时只是退回"原件里原文 + 译文并排"的旧样子，不丢内容。
import { ID_ATTR } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { DOCUMENT_ROOT, NOTE } from '@/core/rules/latexml'

/** 原件上的标记：译文已复制进副本，这份边注由样式隐藏 */
const LOCALIZED_ATTR = 'data-axt-note'
/** 复制进副本的译文换上的 class：脱掉 ar5iv 的脚注框外壳（见下） */
export const NOTE_T_CLASS = 'axt-note-t'

/** 副本里放进去的那份译文：脱掉脚注框外壳、去掉自带标号（副本外层已经有一个） */
function localizedCopy(translated: Element): Element {
  const clone = translated.cloneNode(true) as Element
  // 译文节点自己也是 .ltx_note_content，套进副本就成了"框里套框"——多一条 double 顶边线、
  // 多 9.6px 缩进，它自带的标号又是绝对定位的，会飞到正文里（实测，用户反馈"位置是乱的"）
  clone.classList.remove(NOTE.contentClass)
  clone.classList.add(NOTE_T_CLASS)
  for (const name of clone.getAttributeNames()) if (name.startsWith('data-axt-')) clone.removeAttribute(name)
  for (const mark of Array.from(clone.querySelectorAll(NOTE.marks))) mark.remove()
  return clone
}

/**
 * 把脚注的译文复制进译文块里重建出来的副本，并标记原件。
 * 幂等：副本里已有同样内容就不动；内容变了就换。返回本轮改动的数量。
 */
export function localizeNotes(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let localized = 0
  for (const translation of Array.from(scope.querySelectorAll(`.${T_CLASS}`))) {
    const original = translation.previousElementSibling
    if (!original || original.classList.contains(T_CLASS)) continue
    const copies = Array.from(translation.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
    if (copies.length === 0) continue
    const sources = Array.from(original.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
    // 数量对不上就不动：宁可右栏留着原文，也不要张冠李戴
    if (sources.length !== copies.length) continue
    copies.forEach((copy, i) => {
      const source = sources[i]
      const translated = source?.nextElementSibling
      if (!translated?.classList.contains(T_CLASS)) return // 这条脚注还没翻到，下一轮再说
      const fresh = localizedCopy(translated)
      const existing = copy.querySelector(`:scope > .${NOTE_T_CLASS}`)
      if (existing?.textContent === fresh.textContent) return // 已归位且内容没变
      existing?.remove()
      // 副本保留自己的原文，译文接在后面：一份边注里英文在上、中文在下
      copy.append(fresh)
      source?.closest(NOTE.root)?.setAttribute(LOCALIZED_ATTR, '')
      localized += 1
    })
  }
  return localized
}

/**
 * 撤销与某块相关的脚注归位，在删掉它的译文之前调用（Codex 在 #30 指出）：
 * 块里的脚注——副本随这块的译文一起没了，原件不能再藏着；
 * 块本身是脚注正文——它的译文副本在外层段落的译文里，删掉副本、原件露出来。
 * 否则再翻失败时原件边注仍被样式隐藏、副本却已删除，脚注在所有模式下都消失。返回撤销的条数
 */
export function delocalizeNotes(block: Element): number {
  let undone = 0
  for (const note of Array.from(block.querySelectorAll(`[${LOCALIZED_ATTR}]`))) {
    note.removeAttribute(LOCALIZED_ATTR)
    undone += 1
  }
  const note = block.closest(NOTE.root)
  if (!note?.hasAttribute(LOCALIZED_ATTR)) return undone
  note.removeAttribute(LOCALIZED_ATTR)
  undone += 1
  const outer = note.parentElement?.closest(`[${ID_ATTR}]`)
  const translation = outer?.nextElementSibling
  if (!outer || !translation?.classList.contains(T_CLASS)) return undone
  const sources = Array.from(outer.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
  const copies = Array.from(translation.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
  copies[sources.indexOf(block)]?.querySelector(`:scope > .${NOTE_T_CLASS}`)?.remove()
  return undone
}
