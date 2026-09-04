// 脚注在 side 模式下的两栏归位（DESIGN §7.2）。
//
// arXiv 在视口 ≥ 96rem 时把脚注渲染成**常驻边注**：`.ltx_note_outer` 用 `float: inline-end`
// 加一个负的 margin-inline-end（实测 -496px）挂到"文章列外面"。side 模式把文章切成两栏后，
// 左栏的"外面"就是右栏——边注正好压在右栏译文上（实测 2312.17141：边注 1112→1592，右栏 1116→1856）。
//
// 另一半问题是内容：段落译文由占位符协议回填，脚注是受保护节点，所以**译文段落里会重建一份
// 原文脚注**。于是左栏那份脚注里有我们插入的译文（英文 + 中文），右栏那份却只有英文。
// 这里把右栏那份的内容换成该脚注的译文，左栏那份的译文由样式隐藏——两栏各自完整：
// 左栏英文正文配英文脚注，右栏中文正文配中文脚注。
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { T_CLASS } from './index'

/** 脚注正文；它本身就是翻译单元，所以译文是它的兄弟 */
const NOTE_CONTENT = '.ltx_note_content'
/** 已归位的副本，避免重复替换 */
const DONE_ATTR = 'data-axt-note'

/**
 * 把译文块里重建出来的脚注副本换成该脚注的译文；幂等。
 * 返回本轮归位的副本数量。
 */
export function localizeNotes(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let localized = 0
  for (const translation of Array.from(scope.querySelectorAll(`.${T_CLASS}`))) {
    const original = translation.previousElementSibling
    if (!original || original.classList.contains(T_CLASS)) continue
    const copies = Array.from(translation.querySelectorAll(`${NOTE_CONTENT}:not(.${T_CLASS})`))
    if (copies.length === 0) continue
    const sources = Array.from(original.querySelectorAll(`${NOTE_CONTENT}:not(.${T_CLASS})`))
    // 数量对不上就不动：宁可右栏留着原文，也不要张冠李戴
    if (sources.length !== copies.length) continue
    copies.forEach((copy, i) => {
      if (copy.hasAttribute(DONE_ATTR)) return
      const translated = sources[i]?.nextElementSibling
      if (!translated?.classList.contains(T_CLASS)) return // 这条脚注还没翻到
      // 译文节点本身就是一份完整的 .ltx_note_content，整体换过去标号才不会重复
      const clone = translated.cloneNode(true) as Element
      for (const name of clone.getAttributeNames()) if (name.startsWith('data-axt-')) clone.removeAttribute(name)
      copy.replaceChildren(...Array.from(clone.childNodes))
      copy.setAttribute(DONE_ATTR, '')
      localized += 1
    })
  }
  return localized
}
