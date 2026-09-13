// The bilingual entry on the abstract page (issue #146): one more line under arXiv's own HTML link in “Access Paper”,
// leading straight to the HTML full text already translating.
//
// **The URL is the one arXiv gives**, plus a `#axt-translate` — the content script starts translating of itself on seeing that hash.
// Building `arxiv.org/html/<id>` ourselves would point at the wrong version of a paper with several (its href carries the `v7`).

import { HTML_LINK } from '@/core/rules/abstract'

/** The line we insert; `restore` leaves the abstract page alone, but the mark is still needed, for recognition and idempotence */
export const ABS_LINK_CLASS = 'axt-abs-link'
/** The hash that makes the content script start translating as soon as it enters the page (DESIGN §4.1) */
export const AUTO_TRANSLATE_HASH = '#axt-translate'

/**
 * Insert the bilingual entry; returns whether it was inserted.
 *
 * Nothing happens in three cases: this is not an abstract page, the paper has no HTML version (`HTML_LINK` absent), or it was inserted already.
 * Idempotent because it is cheap: arXiv's abstract page does not re-render, but an assumption that only holds under one DOM shape is not worth relying on.
 */
export function injectBilingualLink(doc: Document, label: string): boolean {
  const html = doc.querySelector<HTMLAnchorElement>(HTML_LINK)
  if (!html) return false
  const item = html.closest('li')
  if (!item?.parentElement) return false
  if (item.parentElement.querySelector(`.${ABS_LINK_CLASS}`)) return false

  const link = doc.createElement('a')
  // arXiv's own button style: this line has to look like a member of “Access Paper”, not something bolted on
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
