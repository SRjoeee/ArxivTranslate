// Hover sentence highlight (DESIGN §7.7, issue #105): point at a sentence on either side and both
// it and its counterpart are tinted.
//
// **Nothing here touches the DOM.** The tint is painted through the CSS Custom Highlight API, which
// takes plain `Range`s and needs no wrapper elements, so §7.1's invariant — the original subtree is
// never modified — holds without a cleanup path. The only trace on the page is one attribute on
// `<html>`, which is where §7.1 puts global state anyway.
//
// The registry (`sentences.ts`) holds what is needed at pointer time; this file is the part that
// runs on every pointer move, so it is written to do as little as possible.

import { rangesOf, wireOffsetAt } from '@/core/protector'
import { sentenceAt, sentenceMapAt } from './sentences'

/** Highlight registry names. Namespaced like everything else we put on the page (§ hard rule 5). */
const SOURCE_HIGHLIGHT = 'axt-sentence-source'
const TARGET_HIGHLIGHT = 'axt-sentence-target'
/**
 * How long a miss is tolerated before the tint fades out.
 *
 * Sentences of adjacent blocks are separated by a paragraph gap, and a pointer moving from one to
 * the next passes through it. Reacting to that instantly would fade out and back in — a visible
 * blink in the middle of a movement the reader experiences as continuous. Holding briefly makes the
 * crossing invisible, and is short enough that a pointer genuinely parked outside the text still
 * clears within a frame or two of the fade the reader expects.
 */
const MISS_GRACE_MS = 120

/**
 * How far outside a character's own box the pointer may still count as being on it, in CSS pixels.
 *
 * `caretPositionFromPoint` answers "which caret position is nearest", not "is there text here", so
 * it happily returns the last character of a line for a pointer in the margin metres away — the
 * whole right-hand gutter of a paper would highlight the paragraph beside it (reported from real
 * use). Checking the pointer against the character's own rectangle is what turns the answer back
 * into a hit test. A few pixels of slack keeps the edges of a line from feeling dead.
 */
const HIT_SLACK_PX = 4


/**
 * Bumped whenever the highlights are cleared from outside this controller — `setMode()` and
 * `restore()` both do it. A running controller caches which sentence it painted and skips the work
 * when the pointer stays on it; without this it would go on believing a cleared sentence is still
 * on screen and never repaint it (Codex pointed this out on #130).
 */
let epoch = 0

/**
 * Whether this browser can paint the highlight.
 *
 * `caretPositionFromPoint` rather than `highlightsFromPoint`: the latter would answer the hit test
 * directly, but it landed in Chrome 140 and `minimum_chrome_version` is 131.
 */
function supported(doc: Document): boolean {
  return typeof CSS !== 'undefined' && 'highlights' in CSS && typeof doc.caretPositionFromPoint === 'function' && typeof Highlight === 'function'
}

/**
 * Drops whatever is painted right now. Safe to call at any time and on a document that never
 * started a highlight: `restore()` and `setMode()` use it without knowing whether one is running.
 */
export function clearSentenceHighlights(_doc: Document): void {
  epoch++
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
  CSS.highlights.delete(SOURCE_HIGHLIGHT)
  CSS.highlights.delete(TARGET_HIGHLIGHT)
}

export interface SentenceHighlight {
  /** Removes the listener, clears both registries and the root attribute */
  stop(): void
}

/**
 * Starts following the pointer. Returns undefined when the browser cannot paint the highlight, so
 * the caller has nothing to clean up.
 *
 * Work per pointer move is one `caretPositionFromPoint`, a walk up to the block, two binary
 * searches, and — only when the sentence actually changed — building its ranges. Coalesced to one
 * frame: a pointer can produce far more `pointermove` events than frames, and every one of them
 * would otherwise cost a layout read.
 */
export function startSentenceHighlight(doc: Document): SentenceHighlight | undefined {
  if (!supported(doc)) return undefined

  let x = 0
  let y = 0
  let frame = 0
  let missTimer = 0
  /**
   * The sentence currently painted, with the `epoch` it was painted at. The epoch is what makes
   * this cache safe: anything that clears the highlights from outside bumps it, and a stale entry
   * then compares unequal instead of suppressing the repaint.
   */
  let shown: { root: Element; index: number; at: number } | null = null

  const view = doc.defaultView
  const clearTimer = (id: number) => { if (id !== 0) view?.clearTimeout(id) }

  /** Drops everything at once. */
  const clearNow = () => {
    shown = null
    clearSentenceHighlights(doc)
  }

  const miss = () => {
    if (!shown || missTimer !== 0) return
    missTimer = view?.setTimeout(() => {
      missTimer = 0
      clearNow()
    }, MISS_GRACE_MS) ?? 0
  }
  const hit = () => {
    clearTimer(missTimer)
    missTimer = 0
  }

  /**
   * Whether the pointer is actually over text, rather than merely nearest to some.
   *
   * **The caret is an insertion point, not the character under the pointer.** On the right half of
   * a glyph Chromium returns the position *after* it, so measuring the character at the offset
   * measures the next one — and at a line wrap that next character is on the following line, a
   * whole line-height away. Checking only it would reject a pointer sitting plainly on the last
   * word of a line (Codex pointed this out on #136). Both characters the caret sits between are
   * measured, and either one containing the pointer is a hit.
   *
   * At most two `getBoundingClientRect` calls, and only once a candidate exists. Nothing has been
   * written to the DOM at this point in the frame, so neither forces a reflow.
   */
  const inside = (rect: DOMRect | undefined): boolean =>
    !!rect && !(rect.width === 0 && rect.height === 0)
    && x >= rect.left - HIT_SLACK_PX && x <= rect.right + HIT_SLACK_PX
    && y >= rect.top - HIT_SLACK_PX && y <= rect.bottom + HIT_SLACK_PX

  const charRect = (text: Text, from: number): DOMRect | undefined => {
    if (from < 0 || from + 1 > text.data.length) return undefined
    const range = doc.createRange()
    range.setStart(text, from)
    range.setEnd(text, from + 1)
    return range.getBoundingClientRect()
  }

  const onTheText = (node: Node, offset: number): boolean => {
    if (node.nodeType === 1) {
      // A formula or other placeholder: its own box is the thing under the pointer
      return inside((node as Element).getBoundingClientRect())
    }
    if (node.nodeType !== 3) return false
    const text = node as Text
    // The character after the caret, then the one before it
    return inside(charRect(text, offset)) || inside(charRect(text, offset - 1))
  }

  const update = () => {
    frame = 0
    const caret = doc.caretPositionFromPoint(x, y)
    const node = caret?.offsetNode
    const found = node ? sentenceMapAt(node) : undefined
    if (!found || !node || !onTheText(node, caret.offset)) {
      miss()
      return
    }
    const { map, side } = found
    const wire = wireOffsetAt(map[side].index, node, caret.offset)
    const sentence = wire === undefined ? undefined : sentenceAt(map.pairs, side, wire)
    if (!sentence) {
      miss()
      return
    }
    hit()
    // The same sentence as last frame: the ranges have not changed and rebuilding them would be
    // pure work. This is the common case — a pointer resting on a line of text hits it every frame.
    if (shown && shown.at === epoch && shown.root === map.source.root && shown.index === sentence.index) return
    shown = { root: map.source.root, index: sentence.index, at: epoch }
    CSS.highlights.set(SOURCE_HIGHLIGHT, new Highlight(...rangesOf(map.source.spans, sentence.source.from, sentence.source.to)))
    CSS.highlights.set(TARGET_HIGHLIGHT, new Highlight(...rangesOf(map.target.spans, sentence.target.from, sentence.target.to)))
  }

  const onMove = (event: PointerEvent) => {
    x = event.clientX
    y = event.clientY
    if (frame === 0) frame = view?.requestAnimationFrame(update) ?? 0
  }
  const onLeave = () => {
    hit()
    clearNow()
  }

  doc.addEventListener('pointermove', onMove, { passive: true })
  // Leaving the window keeps no pointer events coming, so the tint would stay behind
  doc.addEventListener('pointerleave', onLeave)

  return {
    stop() {
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerleave', onLeave)
      if (frame !== 0) view?.cancelAnimationFrame(frame)
      hit()
      // Unconditionally, not conditioned on anything being shown: another run of this document may
      // have left entries behind, and stopping should leave the page clean either way
      clearNow()
    },
  }
}
