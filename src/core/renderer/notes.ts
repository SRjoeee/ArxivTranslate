// 脚注在 side 模式下的两栏归位（DESIGN §7.2）。
//
// 段落译文由占位符协议回填，脚注是受保护节点，所以**译文段落里会重建一份原文脚注**：
// 同一条脚注在页面上出现两次，一次跟着原文、一次跟着译文。
//
// 这里把脚注的译文**从原件移动到那份副本里**，副本因此是"原文 + 译文"上下排；
// 原件那份标上 data-axt-note，由样式隐藏。结果是页面右缘只挂一份边注，英文在上、中文在下
// （实测 2312.17141：文档 522→2026，边注 2042→2522，side 与 stack 都只剩一份）。
//
// 边注的位置沿用 arXiv 自己的（float + 负边距挂到文章外），不要改：试过把它收进本栏，
// 正文被挤、列表项还被盖住（ar5iv 给列表项里的脚注写死了 height: 0），用户反馈"影响阅读"。
//
// 必须是"移动"而不是"复制 + 样式隐藏"：那样把一件事拆成 CSS 与 JS 两段，
// 只要这一趟没跑成（切模式、配对数对不上），中文就凭空消失——第一版正是这么写的。
// 移动是自幂等的：搬完原件就没有译文节点了，没搬成时也只是退回"原文 + 译文并排"的旧样子。
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { T_CLASS } from './index'

/** 脚注正文；它本身就是翻译单元，所以译文是它的兄弟 */
const NOTE_CONTENT = '.ltx_note_content'
/** 原件上的标记：译文已经搬走，这份边注由样式隐藏 */
const MOVED_ATTR = 'data-axt-note'

/**
 * 把脚注的译文搬进译文块里重建出来的副本，并标记原件。
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
      const source = sources[i]
      const translated = source?.nextElementSibling
      if (!translated?.classList.contains(T_CLASS)) return // 这条脚注还没翻到，下一轮再说
      // 副本保留自己的原文，译文接在后面：一份边注里英文在上、中文在下
      copy.append(translated)
      source?.closest('.ltx_note')?.setAttribute(MOVED_ATTR, 'moved')
      localized += 1
    })
  }
  return localized
}
