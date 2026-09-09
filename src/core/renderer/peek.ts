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

import { PEEK_CLASS, stripInjected } from '@/core/marks'
import { ANNOTATION_SELECTOR } from '@/core/rules/latexml'

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
/** Anchored below the sentence unless fewer than this many pixels remain under it — about four lines. */
const MIN_ROOM_PX = 100

/** Which tier the panel was placed in; read by tests and available to the stylesheet. */
export const AT_ATTR = 'data-axt-peek-at'

/** The sentence a panel shows, by the same identity the highlight caches: block and index. */
export interface PeekKey { root: Element; index: number }

/** Where the visible side of the sentence is, in viewport coordinates, read before anything is written. */
export interface PeekAnchor {
  /** Top of the sentence's first line and bottom of its last */
  top: number
  bottom: number
  /** The block the visible side sits in: a floating panel spans its width */
  block: { left: number; width: number }
  /** The article's right edge, where the margin begins; undefined when there is no article root */
  articleRight: number | undefined
  viewport: { width: number; height: number }
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
}

const same = (a: PeekKey, b: PeekKey) => a.root === b.root && a.index === b.index

export function createPeek(doc: Document): Peek {
  const view = doc.defaultView
  // Root font size, for the rem thresholds. Read once: browser zoom scales CSS pixels and rem alike
  const rem = Number.parseFloat(view?.getComputedStyle(doc.documentElement).fontSize ?? '') || 16
  let panel: HTMLElement | undefined
  /** What the panel shows right now, or null while it is hidden */
  let open: PeekKey | null = null
  /** A sentence waiting out the dwell */
  let pending: { key: PeekKey; ranges: () => Range[]; anchor: PeekAnchor; timer: number } | null = null

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
    const roomBelow = a.viewport.height - a.bottom
    let at: 'margin' | 'below' | 'above'
    let css: string
    if (margin >= MIN_MARGIN_REM * rem) {
      at = 'margin'
      const left = (a.articleRight ?? 0) + GAP_PX
      const width = Math.min(margin, MAX_MARGIN_REM * rem)
      // Top-aligned to the sentence's first line; bottom-aligned to its last when little room is left below
      css = roomBelow >= MIN_ROOM_PX
        ? `left:${left}px;top:${a.top}px;width:${width}px;max-height:${a.viewport.height - a.top - GAP_PX}px`
        : `left:${left}px;bottom:${a.viewport.height - a.bottom}px;width:${width}px;max-height:${a.bottom - GAP_PX}px`
    } else if (roomBelow >= MIN_ROOM_PX) {
      at = 'below'
      const top = a.bottom + GAP_PX
      css = `left:${a.block.left}px;top:${top}px;width:${a.block.width}px;max-height:${a.viewport.height - top - GAP_PX}px`
    } else {
      at = 'above'
      css = `left:${a.block.left}px;bottom:${a.viewport.height - a.top + GAP_PX}px;width:${a.block.width}px;max-height:${a.top - 2 * GAP_PX}px`
    }
    el.setAttribute(AT_ATTR, at)
    el.setAttribute('style', css)
  }

  const render = (key: PeekKey, ranges: () => Range[], anchor: PeekAnchor) => {
    if (!panel) {
      panel = doc.createElement('div')
      panel.className = PEEK_CLASS
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
      if (open && panel && same(open, key)) {
        // The same sentence re-measured after a reflow: the content stands, only the position moves
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
        if (due) render(due.key, due.ranges, due.anchor)
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
  }
}
