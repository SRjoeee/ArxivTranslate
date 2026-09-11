// 摘要页的双语入口（issue #146）：在「Access Paper」里 arXiv 自己的 HTML 链接下面加一条，
// 点进去直接是已经在翻的 HTML 全文。
//
// **URL 用 arXiv 给的那一个**，只补一个 `#axt-translate`——content script 见到这个 hash 会自动开始翻译。
// 自己拼 `arxiv.org/html/<id>` 会在论文有多个版本时指到错的那一版（它的 href 里带 `v7`）。

import { HTML_LINK } from '@/core/rules/abstract'

/** 我们插进去的那一条；`restore` 不管摘要页，但标记仍然要有，好识别、好幂等 */
export const ABS_LINK_CLASS = 'axt-abs-link'
/** 让 content script 一进页面就开始翻的 hash（DESIGN §4.1） */
export const AUTO_TRANSLATE_HASH = '#axt-translate'

/**
 * 插入双语入口，返回是否插了。
 *
 * 三种情况什么都不做：这不是摘要页、这篇论文没有 HTML 版（`HTML_LINK` 不存在）、已经插过了。
 * 幂等是因为它便宜：arXiv 的摘要页不会重渲染，但一个只在特定 DOM 形状下才对的假设不值得依赖。
 */
export function injectBilingualLink(doc: Document, label: string): boolean {
  const html = doc.querySelector<HTMLAnchorElement>(HTML_LINK)
  if (!html) return false
  const item = html.closest('li')
  if (!item?.parentElement) return false
  if (item.parentElement.querySelector(`.${ABS_LINK_CLASS}`)) return false

  const link = doc.createElement('a')
  // arXiv 自己的按钮样式：这一条要看起来就是「Access Paper」里的一员，而不是外挂上去的
  link.className = `abs-button ${ABS_LINK_CLASS}`
  link.href = `${html.href}${AUTO_TRANSLATE_HASH}`
  link.textContent = label
  const li = doc.createElement('li')
  li.append(link)
  item.after(li)
  return true
}

/**
 * Rewrite the label of a link already on the page. The interface's language can change while an
 * abstract page sits open, and this entry point reads the setting once (Codex on #161)
 */
export function relabelBilingualLink(doc: Document, label: string): boolean {
  const link = doc.querySelector<HTMLAnchorElement>(`.${ABS_LINK_CLASS}`)
  if (!link) return false
  link.textContent = label
  return true
}
