// In-page anchors, the fallback (issue #44): only mode hides the original blocks that have a translation with
// `display: none` (§7.4), and every cross-reference into them stops working — the target has no layout box, so the
// browser has nowhere to scroll.
//
// Measured on 2609.00246 (Chromium, only mode, the whole paper translated): 61 in-page anchors had an invisible
// target; clicking “§7” (`#S7.p3.1`, target `p.ltx_p`, `display: none`, `data-axt-state="translated"`) took
// `scrollY` from 0 to 0 — **not a pixel** — while its translation sat right beside it. Across the 12 fixtures, 118
// of 3374 in-page anchors (3.5%) point into translated blocks, almost all `.ltx_p`.
//
// The way out is to land the navigation on the translation, not to reveal the original: a reader in only mode who
// clicks a “see §7” reference wants §7 in Chinese. §7.4 also forbids `display: revert` to undo the hiding (it would undo the
// site's own display too). In keeping with §7.1: the DOM is not changed, only listeners are attached; in side / stack
// the target is visible anyway and this never steps in.
import type { Block } from '@/core/extractor'
import { ID_ATTR } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { ERROR_CLASS, FOR_ATTR, MIRROR_CLASS, PENDING_CLASS, SPLIT_ATTR, SPLIT_CLASS, SPLIT_OF_ATTR } from './attrs'

/** Only an element with a layout box can be scrolled to; `getClientRects()` of a `display: none` element is empty */
function visible(el: Element): boolean {
  return el.getClientRects().length > 0
}

/** `#S7.p3.1` → element. Dots in an id do not bother getElementById, but the href may be escaped */
function targetOf(doc: Document, href: string): Element | null {
  if (!href.startsWith('#') || href.length < 2) return null
  const raw = href.slice(1)
  let id = raw
  try { id = decodeURIComponent(raw) } catch { /* a malformed escape is looked up as written */ }
  return doc.getElementById(id) ?? doc.getElementById(raw)
}

/**
 * The stand-in for an invisible target: from the block the target sits in, the first visible translation found
 * **walking outwards**.
 *
 * The nearest block alone is not enough (Codex on #80): translation units nest (a footnote body inside a
 * paragraph, a heading inside the acknowledgements — 55 such blocks across the 12 fixtures), and a nested unit's
 * translation is inserted **inside the outer original block**. When only mode hides the outer block whole, the
 * inner translation goes with it, while the outer block's own translation is visible right beside. Stopping at
 * `closest()` would return null and the link would stay dead.
 *
 * What is picked is a **real translation** — a mirror is the right column's balancing copy, a pending node is the
 * ring, an error node is the failure widget; scrolling to any of them is scrolling to an empty box
 */
function standIn(doc: Document, target: Element): Element | null {
  // Split figures (Codex on #80): in side mode splitFigures clones the whole figure into a translation-only copy;
  // after a switch to only, the `[data-axt-split]` original is hidden whole (modes.css) and what is visible is the
  // clone right after it — whose ids stripIds removed, so a caption reference like `#S2.F2` cannot reach it. A figure
  // is not a translation unit either, so the block search below never gets there; hand it over here first
  const split = target.closest(`[${SPLIT_ATTR}]`)
  const clone = split?.nextElementSibling
  if (clone?.classList.contains(SPLIT_CLASS) && visible(clone)) {
    // An anchor into a point **inside** the figure must land on that point in the clone, not on the figure's top —
    // 2312.17141 has 21 such anchors (`#S3.Ex73`–`Ex79` are equation rows inside Figure 6; Codex on #80). The clone
    // moved the original id into data-axt-split-of; look it up by that, and fall back to the figure's top only when
    // that point was removed from the clone
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

/** Should this href be taken over? If so, the scroll target */
function resolve(doc: Document, href: string): Element | null {
  const target = targetOf(doc, href)
  // No such target (an external link, an empty hash) or a target visible anyway: the browser's business, not ours
  if (!target || visible(target)) return null
  return standIn(doc, target)
}

/**
 * Attach the fallback; returns the teardown. The content script attaches it when a session starts and removes it
 * when the original is restored. All three entries are covered: a link click, a hash changed in the address bar or
 * by a site script (hashchange), back and forward (popstate)
 */
export function installAnchorFallback(doc: Document): () => void {
  const view = doc.defaultView
  if (!view) return () => {}

  const scrollTo = (node: Element) => node.scrollIntoView({ block: 'start' })

  /**
   * The hash this code just wrote: the `hashchange` that `location.hash = …` dispatches is **asynchronous**, and a
   * synchronous boolean guard would be reset before the event arrived — so the value is remembered, not a flag
   */
  let selfNavHash: string | null = null

  /**
   * Change the hash and scroll there. `location.hash`, not `pushState` (Codex on #80): a native anchor jump
   * dispatches `hashchange` and `pushState` does not, so a page script or another extension would never observe
   * that “a hidden target was clicked” — while it is told about every address-bar change and every back or
   * forward, an inconsistency. arXiv itself listens to neither today (measured on 2609.00246: 0 `hashchange` /
   * `popstate` listeners, `window.onhashchange` null), so this keeps the semantics rather than fixing a live bug.
   * An unchanged hash is not written, to avoid one more history entry; written or not, the scroll happens — the
   * native behaviour jumps on a click of the same anchor too
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
    // A middle click, or Ctrl / Cmd + click, is “open in a new tab” and must not be taken over
    if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!anchor) return
    // A target naming another browsing context makes a plain left click “open in a new tab / another frame” as well —
    // intercepting it and calling preventDefault would turn it into a same-page jump (Codex on #80). arXiv has none
    // (all 3386 in-page anchors across the 12 fixtures carry no target); this is a structural guarantee
    const target = anchor.getAttribute('target')
    if (target && target !== '_self') return
    const href = anchor.getAttribute('href') ?? ''
    const node = resolve(doc, href)
    if (!node) return
    event.preventDefault()
    navigate(href, node)
  }

  const onHashChange = () => {
    // The write this code made has scrolled already; scrolling again would be wasted work
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

/** For tests and debugging: would this block's anchors stop working in the current mode */
export function anchorWouldBreak(doc: Document, block: Block): boolean {
  return !visible(block.el) && standIn(doc, block.el) !== null
}
