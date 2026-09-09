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
/** Drives the fade in `highlight.css`; on `<html>`, like the other global flags */
const HL_ATTR = 'data-axt-hl'

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
export function clearSentenceHighlights(doc: Document): void {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return
  CSS.highlights.delete(SOURCE_HIGHLIGHT)
  CSS.highlights.delete(TARGET_HIGHLIGHT)
  doc.documentElement.removeAttribute(HL_ATTR)
}

export interface SentenceHighlight {
  /** Removes the listener, clears both registries and the root attribute */
  stop(): void
}

/**
 * Starts following the pointer. Returns undefined when the browser cannot paint the highlight, so
 * the caller has nothing to clean up.
 *
 * Work per pointer move is one `caretPositionFromPoint`, a bounded walk up to the block, two binary
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
  /** The sentence currently painted, as block identity plus index; null when nothing is */
  let shown: { root: Element; index: number } | null = null

  const clear = () => {
    if (!shown) return
    shown = null
    clearSentenceHighlights(doc)
  }

  const miss = () => {
    if (!shown || missTimer !== 0) return
    missTimer = doc.defaultView?.setTimeout(() => {
      missTimer = 0
      clear()
    }, MISS_GRACE_MS) ?? 0
  }
  const hit = () => {
    if (missTimer === 0) return
    doc.defaultView?.clearTimeout(missTimer)
    missTimer = 0
  }

  const update = () => {
    frame = 0
    const caret = doc.caretPositionFromPoint(x, y)
    const node = caret?.offsetNode
    const found = node ? sentenceMapAt(node) : undefined
    if (!found || !node) {
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
    if (shown && shown.root === map.source.root && shown.index === sentence.index) return
    shown = { root: map.source.root, index: sentence.index }
    CSS.highlights.set(SOURCE_HIGHLIGHT, new Highlight(...rangesOf(map.source.spans, sentence.source.from, sentence.source.to)))
    CSS.highlights.set(TARGET_HIGHLIGHT, new Highlight(...rangesOf(map.target.spans, sentence.target.from, sentence.target.to)))
    // Set after the ranges so the first paint of a new highlight is already the faded-in one rather
    // than a frame at full strength
    doc.documentElement.setAttribute(HL_ATTR, 'on')
  }

  const onMove = (event: PointerEvent) => {
    x = event.clientX
    y = event.clientY
    if (frame === 0) frame = doc.defaultView?.requestAnimationFrame(update) ?? 0
  }
  const onLeave = () => {
    hit()
    clear()
  }

  doc.addEventListener('pointermove', onMove, { passive: true })
  // Leaving the window keeps no pointer events coming, so the tint would stay behind
  doc.addEventListener('pointerleave', onLeave)

  return {
    stop() {
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerleave', onLeave)
      if (frame !== 0) doc.defaultView?.cancelAnimationFrame(frame)
      hit()
      shown = null
      // Unconditionally, not through `clear`: another run of this document may have left entries
      // behind, and stopping should leave the page clean either way
      clearSentenceHighlights(doc)
    },
  }
}
