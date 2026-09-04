// 脚注在 side 模式下的两栏归位（DESIGN §7.2）。
//
// arXiv 在视口 ≥ 96rem 时把脚注渲染成**常驻边注**：`.ltx_note_outer` 用 `float: inline-end`
// 加一个负的 margin-inline-end（实测 -496px）挂到"文章列外面"。side 模式把文章切成两栏后，
// 左栏的"外面"就是右栏——边注正好压在右栏译文上（实测 2312.17141：边注 1112→1592，右栏 1116→1856）。
//
// 另一半问题是内容：段落译文由占位符协议回填，脚注是受保护节点，所以**译文段落里会重建一份
// 原文脚注**。于是左栏那份脚注里有我们插入的译文（英文 + 中文），右栏那份却只有英文。
// 这里把脚注的译文**从原件里移动**到副本里：原件因此只剩原文，副本成为译文，
// 三种模式下都自洽（side 左右各一份、stack 上下各一份、only 只剩副本）。
//
// 必须是"移动"而不是"复制 + 用样式把原件里的译文藏起来"：那样一旦这一趟没跑成
// （切模式、配对数对不上），中文就凭空消失了——第一版正是这么写的，用户立刻发现
// "注解不见了"，而 stack 模式下又变成三份。移动是自幂等的：搬完原件就没有译文节点了。
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { FOR_ATTR, T_CLASS } from './index'

/** 脚注正文；它本身就是翻译单元，所以译文是它的兄弟 */
const NOTE_CONTENT = '.ltx_note_content'
/**
 * 把脚注的译文从原件移动到译文块里重建出来的副本上。
 * 自幂等：搬完原件就没有译文节点了，下一轮自然不做事。返回本轮搬动的数量。
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
      const translated = sources[i]?.nextElementSibling
      if (!translated?.classList.contains(T_CLASS)) return // 这条脚注还没翻到，下一轮再说
      // 译文节点本身就是一份完整的 .ltx_note_content，整体搬过去标号才不会重复
      copy.replaceChildren(...Array.from(translated.childNodes))
      copy.setAttribute(FOR_ATTR, translated.getAttribute(FOR_ATTR) ?? '')
      translated.remove()
      localized += 1
    })
  }
  return localized
}
