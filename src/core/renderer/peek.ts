// Source peek for a hidden counterpart (DESIGN §7.7, issue #141).
//
// Only mode hides every translated original outright, so the hover highlight has nothing to tint
// on the source side: the ranges are built and correct, they just fall on nodes with no boxes. The
// reader still wants to see what the sentence under the pointer said. This shows it — the
// sentence's own DOM, cloned — in a panel beside the column when the margin has room, and floating
// next to the sentence when it does not.
//
// **Triggered by "the counterpart is not rendered", not by the mode.** `checkVisibility()` on the
// other side's block covers only mode, collapsed regions and whatever else hides one side later,
// where a mode check would need a branch for each.
//
// **A plain element on `<body>`, not a shadow root.** Cloned MathML and `ltx_*` nodes need the
// page's own stylesheet to render; inside a shadow root the formulas fall apart. It carries
// `PEEK_CLASS` so `restore()` takes it away with every other injected node — the same shape §7.1
// already accepts for the band layer. A sibling of that layer, not a child: the layer sits at
// `z-index: -1`, and anything inside it would be painted under the page.

import { INJECTED_SELECTOR, PEEK_CLASS, isInjected, stripInjected } from '@/core/marks'
import { ANNOTATION_SELECTOR, MARGIN_ASIDE } from '@/core/rules/latexml'

/**
 * How long the pointer has to rest on one sentence before its counterpart is shown.
 *
 * A pointer crossing text while the page scrolls touches many sentences, and a panel that fired on
 * each would make the page strobe (user, 2026-09-09). The band may appear promptly — it obscures
 * nothing — but the panel waits until the pointer has genuinely stopped. Counted per sentence, not
 * per pointer position: a pointer wobbling within one sentence is resting on it.
 */
export const PEEK_DWELL_MS = 600
/** Space between the panel and what it is anchored to, in CSS pixels. */
const GAP_PX = 8
/** The margin is used when at least this much of it is free; the panel never grows past the max. */
const MIN_MARGIN_REM = 18
const MAX_MARGIN_REM = 24
/**
 * Below the sentence — or top-aligned to it in the margin — unless fewer than this many pixels
 * remain there *and* the other side has more: about ten lines. The panel is never measured, so
 * putting it on the roomier side when the default one is cramped is all that can be done for a
 * long sentence; one taller than both sides still clips (Codex on #149).
 */
const COMFORT_PX = 240

/** Which tier the panel was placed in; read by tests and available to the stylesheet. */
export const AT_ATTR = 'data-axt-peek-at'

/**
 * What a panel shows: the sentence by the identity the highlight caches (block and index), the
 * element whose text is cloned, and the registration the offsets come from. The element matters
 * when the sides swap — a class flipped on the page hides the other side while the pointer stays
 * on the same sentence (Codex on #149). The registration matters because it is what a mutation
 * makes stale: a block registered again gets a new one, and only then may it be shown again.
 */
export interface PeekKey { root: Element; index: number; shown: Element; registration: object }

/** Where the visible side of the sentence is, in viewport coordinates, read before anything is written. */
export interface PeekAnchor {
  /** Top of the sentence's first line and bottom of its last */
  top: number
  bottom: number
  /**
   * The block the visible side sits in, cut to what is on screen: a floating panel spans it. A wide
   * table in a horizontal scroller has a block wider than the viewport, or one starting left of
   * it, and a panel copying that would begin off screen (Codex on #149)
   */
  block: { left: number; width: number }
  /** The article's right edge, where the margin begins; undefined when there is no article root */
  articleRight: number | undefined
  /** Whether the margin tier can be used; `Peek.marginFree` answers it in the read phase */
  marginFree: boolean
  viewport: { width: number; height: number }
  /**
   * How the page sets its own text, so the panel reads as part of it. Taken from the visible block
   * and the page background rather than from system colours: arXiv sets its type on the article,
   * not on `<body>`, and switches its dark theme itself, not with the OS — `Canvas` went black on
   * a page that had stayed white. Empty strings leave the stylesheet's fallbacks in place.
   */
  type: { font: string; color: string; background: string }
}

export interface Peek {
  /**
   * The pointer resolved to `key`, whose counterpart is not rendered. `ranges` is called only when
   * the panel actually renders — a pointer passing through sentences never pays for it.
   */
  show(key: PeekKey, ranges: () => Range[], anchor: PeekAnchor): void
  /** The pointer left the text, the page scrolled, or the counterpart is visible after all. */
  hide(): void
  /** Takes the panel out of the document. */
  remove(): void
  /** Whether a node is the panel or inside it, so its own mutations are not taken for a reflow. */
  contains(node: Node): boolean
  /**
   * A mutation was observed. One that changes the *content* of the element the panel is showing
   * makes the registered offsets stale — a sentence boundary may now fall anywhere — so the panel
   * closes and that registration is refused until the block is registered again; re-cloning with
   * the old offsets would show a false alignment (Codex on #149, twice). Attribute changes do not
   * move text, and nodes of our own arriving inside the block — a footnote's translation — are
   * skipped by the offsets already, so neither counts.
   */
  touched(record: Pick<MutationRecord, 'target' | 'type'> & Partial<Pick<MutationRecord, 'addedNodes' | 'removedNodes'>>): void
  /**
   * Whether the margin tier can be used for a sentence at these lines: the margin is wide enough,
   * and nothing the page itself shows there meets the panel's footprint.
   *
   * From 96rem up ar5iv keeps footnotes and publication notes at the page's right edge, and
   * `localizeNotes` leaves the translated ones there (§7.2). A panel over them would hide exactly
   * what the margin tier promises not to (Codex on #149). The footprint — the panel's column, from
   * the sentence to the viewport's edge in the direction the panel grows — is intersected with
   * every margin aside's box: one rectangle read per aside, in the frame's read phase, and no
   * sampling that a short note could fall between (Codex on #149, twice).
   */
  marginFree(articleRight: number, top: number, bottom: number, viewport: { width: number; height: number }): boolean
}

const same = (a: PeekKey, b: PeekKey) => a.root === b.root && a.index === b.index && a.shown === b.shown && a.registration === b.registration

/** Whether a mutation record can have moved text that registered offsets point into. */
function movesText(record: Pick<MutationRecord, 'target' | 'type'> & Partial<Pick<MutationRecord, 'addedNodes' | 'removedNodes'>>): boolean {
  if (record.type === 'attributes') return false
  const inside = record.target.nodeType === 1 ? (record.target as Element) : record.target.parentElement
  if (inside?.closest(INJECTED_SELECTOR)) return false
  if (record.type === 'childList') {
    const nodes = [...Array.from(record.addedNodes ?? []), ...Array.from(record.removedNodes ?? [])]
    if (nodes.length > 0 && nodes.every(n => n.nodeType === 1 && isInjected(n as Element))) return false
  }
  return true
}

/**
 * Which way the panel grows from the sentence: down from its first line, or up from its last.
 *
 * Down unless fewer than `COMFORT_PX` remain below *and* there is more room above. Shared by the
 * placement and by the margin check, which has to look where the panel will actually be.
 */
const growsDown = (top: number, bottom: number, viewportHeight: number): boolean => {
  const roomBelow = viewportHeight - bottom
  return roomBelow >= COMFORT_PX || roomBelow >= top
}

/**
 * @param current Whether a sentence is still the one the highlight shows, asked when its dwell
 * ends. `clearSentenceHighlights()` runs from outside the controller — `setMode()`, `applyStyle()`
 * — and finds no panel to remove while the dwell is still counting; without the question the timer
 * would go on to render a panel for a page that has since changed (Codex on #149).
 */
export function createPeek(doc: Document, current: (key: PeekKey) => boolean = () => true): Peek {
  const view = doc.defaultView
  // Root font size, for the rem thresholds. Read once: browser zoom scales CSS pixels and rem alike
  const rem = Number.parseFloat(view?.getComputedStyle(doc.documentElement).fontSize ?? '') || 16
  let panel: HTMLElement | undefined
  /** What the panel shows right now, or null while it is hidden */
  let open: PeekKey | null = null
  /** A sentence waiting out the dwell */
  let pending: { key: PeekKey; ranges: () => Range[]; anchor: PeekAnchor; timer: number } | null = null
  /** Registrations whose offsets a mutation has made stale; shown again only once re-registered */
  const dirty = new WeakSet<object>()

  const cancel = () => {
    if (pending) view?.clearTimeout(pending.timer)
    pending = null
  }

  /**
   * Writes the position. **The panel is never measured**: each tier is expressed so that whatever
   * height the content turns out to have, the panel sits where it should — a `bottom` anchor grows
   * upward from the sentence, a `top` anchor downward, and `max-height` keeps either inside the
   * viewport. Reading its box here would force a layout right after the content was written.
   */
  const place = (el: HTMLElement, a: PeekAnchor) => {
    const margin = a.articleRight === undefined ? 0 : a.viewport.width - a.articleRight - 2 * GAP_PX
    const below = growsDown(a.top, a.bottom, a.viewport.height)
    let at: 'margin' | 'below' | 'above'
    let css: string
    if (margin >= MIN_MARGIN_REM * rem && a.marginFree) {
      at = 'margin'
      const left = (a.articleRight ?? 0) + GAP_PX
      const width = Math.min(margin, MAX_MARGIN_REM * rem)
      // Top-aligned to the sentence's first line; hanging from its last line when that is roomier
      // `max-height` never below zero: a sentence filling the viewport leaves no room on either side
      css = below
        ? `left:${left}px;top:${a.top}px;width:${width}px;max-height:${Math.max(0, a.viewport.height - a.top - GAP_PX)}px`
        : `left:${left}px;bottom:${a.viewport.height - a.bottom}px;width:${width}px;max-height:${Math.max(0, a.bottom - GAP_PX)}px`
    } else if (below) {
      at = 'below'
      const top = a.bottom + GAP_PX
      css = `left:${a.block.left}px;top:${top}px;width:${a.block.width}px;max-height:${Math.max(0, a.viewport.height - top - GAP_PX)}px`
    } else {
      at = 'above'
      css = `left:${a.block.left}px;bottom:${a.viewport.height - a.top + GAP_PX}px;width:${a.block.width}px;max-height:${Math.max(0, a.top - 2 * GAP_PX)}px`
    }
    const { font, color, background } = a.type
    if (font) css += `;font:${font}`
    if (color) css += `;color:${color}`
    if (background) css += `;background-color:${background}`
    el.setAttribute(AT_ATTR, at)
    el.setAttribute('style', css)
  }

  const render = (key: PeekKey, ranges: () => Range[], anchor: PeekAnchor) => {
    if (!panel) {
      panel = doc.createElement('div')
      panel.className = PEEK_CLASS
      // `inert`, not just `aria-hidden` and `pointer-events: none`: those leave a cloned `<a href>`
      // reachable by Tab and activatable by Enter (Codex on #149). Inert takes it out of focus,
      // clicks and the accessibility tree at once
      panel.setAttribute('inert', '')
      panel.setAttribute('aria-hidden', 'true')
      doc.body.append(panel)
    }
    panel.replaceChildren()
    // Piece by piece, in order: `rangesOf` cuts the sentence exactly where one of our own nodes sits
    // between two of its runs, so one range spanning the lot would clone a translation into the
    // panel. What the pieces leave out is only ever ours.
    for (const range of ranges()) panel.append(range.cloneContents())
    // No `id` (the page's anchors must stay unique) and no `data-axt-*` (this is not a block)
    stripInjected(panel, false)
    // Footnote containers float to the page edge with a negative margin; inside the panel they would
    // float right out of it — and the sentence's text does not include them anyway
    for (const note of Array.from(panel.querySelectorAll(ANNOTATION_SELECTOR))) note.remove()
    place(panel, anchor)
    panel.hidden = false
    open = key
  }

  return {
    show(key, ranges, anchor) {
      // `clearSentenceHighlights` takes the panel out from outside this controller (`setMode`,
      // `applyStyle`); a detached panel is as good as no panel, and the dwell starts cold
      if (panel && !panel.isConnected) {
        panel = undefined
        open = null
      }
      if (dirty.has(key.registration)) {
        this.hide()
        return
      }
      if (open && panel && same(open, key)) {
        // The same sentence re-measured after a reflow — or the page's theme changed under it:
        // the content stands, only the position and the copied type move
        place(panel, anchor)
        return
      }
      if (open) {
        // Warm: the reader is stepping from one sentence to the next, and does not wait again
        cancel()
        render(key, ranges, anchor)
        return
      }
      if (pending && same(pending.key, key)) {
        // Still the same sentence: the dwell keeps counting, only what would be shown is refreshed
        pending.ranges = ranges
        pending.anchor = anchor
        return
      }
      cancel()
      const timer = view?.setTimeout(() => {
        const due = pending
        pending = null
        if (due && current(due.key)) render(due.key, due.ranges, due.anchor)
      }, PEEK_DWELL_MS) ?? 0
      pending = { key, ranges, anchor, timer }
    },
    hide() {
      cancel()
      if (!open) return
      open = null
      if (panel) {
        panel.hidden = true
        panel.replaceChildren()
      }
    },
    remove() {
      cancel()
      open = null
      panel?.remove()
      panel = undefined
    },
    contains(node) {
      return panel?.contains(node) ?? false
    },
    touched(record) {
      const showing = open
      if (!showing?.shown.contains(record.target) || !movesText(record)) return
      dirty.add(showing.registration)
      this.hide()
    },
    marginFree(articleRight, top, bottom, viewport) {
      const margin = viewport.width - articleRight - 2 * GAP_PX
      if (margin < MIN_MARGIN_REM * rem) return false
      const left = articleRight + GAP_PX
      const right = left + Math.min(margin, MAX_MARGIN_REM * rem)
      const down = growsDown(top, bottom, viewport.height)
      const box = down ? { left, right, top, bottom: viewport.height - GAP_PX } : { left, right, top: GAP_PX, bottom }
      for (const aside of Array.from(doc.querySelectorAll(MARGIN_ASIDE))) {
        const r = aside.getBoundingClientRect()
        // Collapsed or in the article's own flow: no box, or one that never reaches the gutter
        if (r.width === 0 || r.height === 0) continue
        if (r.left < box.right && r.right > box.left && r.top < box.bottom && r.bottom > box.top) return false
      }
      return true
    },
  }
}
