// Anchor fallback (issue #44): only mode sets translated original blocks to display: none (§7.4),
// breaking cross-references to them: without a target layout box, the browser cannot scroll there.
//
// Measured in 2609.00246 (Chromium, only mode, fully translated): 61 local anchors had invisible targets.
// Clicking §7 (#S7.p3.1, a p.ltx_p with display: none and data-axt-state="translated")
// left scrollY at 0, despite the adjacent translation. Across 12 fixtures,
// 118 of 3,374 local anchors (3.5%) target translation blocks, almost all .ltx_p.
//
// Navigate to the translation instead of revealing the source: in only mode, readers following "see §7"
// want the translated section. §7.4 also forbids display: revert, which would override the site's own display rules.
// Consistent with §7.1: only attach events; no DOM changes. Side / stack targets are already visible and need no intervention.
import type { Block } from '@/core/extractor'
import { ID_ATTR } from '@/core/extractor'
import { FOR_ATTR, T_CLASS } from './index'
import { MIRROR_CLASS } from './mirror'
import { SPLIT_ATTR, SPLIT_CLASS, SPLIT_OF_ATTR } from './split-figures'
import { PENDING_CLASS } from './pending'
import { ERROR_CLASS } from './failed'

/** A scroll target needs a layout box; display: none yields no getClientRects(). */
function visible(el: Element): boolean {
  return el.getClientRects().length > 0
}

/** #S7.p3.1 → element. Dots are safe for getElementById, but href may be escaped. */
function targetOf(doc: Document, href: string): Element | null {
  if (!href.startsWith('#') || href.length < 2) return null
  const raw = href.slice(1)
  let id = raw
  try { id = decodeURIComponent(raw) } catch { /* Look up malformed escapes as written. */ }
  return doc.getElementById(id) ?? doc.getElementById(raw)
}

/**
 * Substitute for an invisible target: start at its block and walk outward to the first visible translation.
 *
 * Do not stop at the nearest block (Codex #80). Units can nest (footnotes in paragraphs, titles in acknowledgements;
 * 55 such blocks in 12 fixtures). Their translations are inserted inside the outer original block.
 * When only mode hides that entire block, the inner translation disappears too, but the outer translation remains visible beside it.
 * Stopping at closest() would return null and leave the link broken.
 *
 * Select real translations: mirrors balance the right column, pending nodes contain spinners, and error nodes are failure widgets.
 * Scrolling to those would effectively target an empty box.
 */
function standIn(doc: Document, target: Element): Element | null {
  // Split figures (Codex #80): side-mode splitFigures clones a whole figure with translated content only.
  // In only mode, modes.css hides the entire data-axt-split original and shows its adjacent clone.
  // stripIds removed the clone's IDs, so references such as #S2.F2 cannot target it. Figures are not translation units;
  // the block search below cannot find them, so redirect them here first.
  const split = target.closest(`[${SPLIT_ATTR}]`)
  const clone = split?.nextElementSibling
  if (clone?.classList.contains(SPLIT_CLASS) && visible(clone)) {
    // An anchor inside a figure must target the corresponding position in the clone, not the figure top.
    // 2312.17141 has 21 such anchors (#S3.Ex73–Ex79 are equation rows in Figure 6; Codex #80).
    // Clone IDs were moved to data-axt-split-of. Fall back to the figure top only if that position was removed from the clone.
    const id = target.getAttribute('id')
    const inner = id ? clone.querySelector(`[${SPLIT_OF_ATTR}="${CSS.escape(id)}"]`) : null
    if (inner && visible(inner)) return inner
    return clone
  }

  for (let block = target.closest(`[${ID_ATTR}]`); block; block = block.parentElement?.closest(`[${ID_ATTR}]`) ?? null) {
    const id = block.getAttribute(ID_ATTR)
    if (!id) continue
    for (const node of Array.from(doc.querySelectorAll(`.${T_CLASS}[${FOR_ATTR}="${CSS.escape(id)}"]`))) {
      if (node.classList.contains(MIRROR_CLASS) || node.classList.contains(PENDING_CLASS) || node.classList.contains(ERROR_CLASS)) continue
      if (visible(node)) return node
    }
  }
  return null
}

/** Should we handle this href? If so, return its scroll target. */
function resolve(doc: Document, href: string): Element | null {
  const target = targetOf(doc, href)
  // Missing targets (external links, empty hashes) and visible targets remain browser-managed.
  if (!target || visible(target)) return null
  return standIn(doc, target)
}

/**
 * Install the fallback and return cleanup. The content script installs at session start and removes on restore.
 * Handle all three entry points: link clicks, address-bar / page-script hash changes, and history navigation (popstate).
 */
export function installAnchorFallback(doc: Document): () => void {
  const view = doc.defaultView
  if (!view) return () => {}

  const scrollTo = (node: Element) => node.scrollIntoView({ block: 'start' })

  /**
   * Hash just written by us: location.hash dispatches hashchange asynchronously.
   * A synchronous boolean would reset before delivery, so remember the value instead.
   */
  let selfNavHash: string | null = null

  /**
   * Update hash and scroll. Use location.hash, not pushState (Codex #80):
   * native anchor navigation emits hashchange, while pushState does not. Page scripts and other extensions must observe
   * clicks on hidden targets just as they observe address-bar changes and history navigation.
   * arXiv currently has no listeners (2609.00246: zero hashchange / popstate registrations,
   * window.onhashchange is null). This preserves semantics rather than fixing a currently observed bug.
   * Avoid writing an unchanged hash, which adds history; always scroll, matching native repeated-anchor clicks.
   */
  const navigate = (href: string, node: Element) => {
    const next = href.slice(1)
    if (view.location.hash.slice(1) !== next) {
      selfNavHash = `#${next}`
      try { view.location.hash = next } catch { selfNavHash = null }
    }
    scrollTo(node)
  }

  const onClick = (event: Event) => {
    if (event.defaultPrevented) return
    const mouse = event as MouseEvent
    // Middle-click and Ctrl/Cmd-click open a new tab; leave them alone.
    if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!anchor) return
    // A target pointing to another browsing context also opens normal left-clicks in another tab / frame.
    // Intercepting it with preventDefault would incorrectly turn it into current-page navigation (Codex #80).
    // None of 3,386 local anchors across 12 fixtures have target; this is a structural guarantee.
    const target = anchor.getAttribute('target')
    if (target && target !== '_self') return
    const href = anchor.getAttribute('href') ?? ''
    const node = resolve(doc, href)
    if (!node) return
    event.preventDefault()
    navigate(href, node)
  }

  const onHashChange = () => {
    // Our own hash update already scrolled; do not repeat it.
    if (selfNavHash !== null && view.location.hash === selfNavHash) { selfNavHash = null; return }
    selfNavHash = null
    const node = resolve(doc, view.location.hash)
    if (node) scrollTo(node)
  }

  doc.addEventListener('click', onClick, true)
  view.addEventListener('hashchange', onHashChange)
  view.addEventListener('popstate', onHashChange)
  return () => {
    doc.removeEventListener('click', onClick, true)
    view.removeEventListener('hashchange', onHashChange)
    view.removeEventListener('popstate', onHashChange)
  }
}

/** Tests and debugging: whether this block's anchor fails in the current mode. */
export function anchorWouldBreak(doc: Document, block: Block): boolean {
  return !visible(block.el) && standIn(doc, block.el) !== null
}
