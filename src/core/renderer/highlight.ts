// Hover sentence highlight (DESIGN §7.7, issue #105): point at a sentence on either side and both
// it and its counterpart are tinted.
//
// **Painted as bands, one per line, not as glyph shapes.** The first version used the CSS Custom
// Highlight API, which needs no DOM at all — but `::highlight()` paints the text's own boxes, so a
// paragraph with inline formulas came out as scattered patches with gaps wherever the maths was,
// and it followed the letters rather than sitting behind them. The user asked for the flat band the
// `highlight` style preset already produces, and showed both side by side.
//
// A `Range` reports its geometry as line-level rectangles — measured on a real paragraph, one
// rectangle per line at a uniform 25px, covering formulas and text alike — so drawing those is what
// gives the flat look. Rectangles that share a line are merged, so a line is always exactly one
// band however many boxes the range is made of.
//
// **§7.1 still holds.** The bands live in one container appended to `<body>`, outside
// `article.ltx_document` entirely: the original subtree is not touched, nothing is inserted between
// the paired nodes, and `restore()` removes the container with every other injected node because it
// carries `HL_CLASS`.
//
// **A side with no boxes is shown instead of tinted** (issue #141). Only mode hides the original,
// so its bands would be empty; after a dwell its sentence is cloned into a panel beside or next to
// the visible one (`peek.ts`). Same hit test, same registry, same read-then-write frame.

import { HL_CLASS, PEEK_CLASS } from '@/core/marks'
import { rangesOf, wireOffsetAt } from '@/core/protector'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { createPeek, type PeekAnchor } from './peek'
import { rendered, sentenceAt, sentenceMapAt } from './sentences'

/** Which side a band belongs to, so the stylesheet can tell them apart if it ever needs to. */
const SIDE_ATTR = 'data-axt-hl-side'
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
 * How long the page has to stop scrolling before the pointer is asked what it is on now.
 *
 * A scroll moves the text under a stationary pointer, so the sentence changes without a pointer
 * event. Doing the hit test on every frame of the scroll is the per-frame cost this feature is not
 * allowed to have; waiting for the scroll to settle costs one test per gesture, and matches when
 * the reader actually looks at the page again.
 */
const SCROLL_SETTLE_MS = 120


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
  return typeof doc.caretPositionFromPoint === 'function'
}

/** The one container every band lives in, created on first use. */
function layerOf(doc: Document): Element {
  const existing = doc.body.querySelector(`:scope > .${HL_CLASS}`)
  if (existing) return existing
  const layer = doc.createElement('div')
  layer.className = HL_CLASS
  doc.body.append(layer)
  return layer
}

/**
 * Line-level bands for a set of ranges, in document coordinates.
 *
 * A `Range` reports one rectangle per line box, but a line can produce more than one when the range
 * crosses inline elements of different heights. They are merged by vertical overlap so that a line
 * is always exactly one band — which is the whole point of the flat look, and what keeps a formula
 * from leaving a notch in the middle of a sentence.
 *
 * Offsets are taken against **the layer's own origin**, which the caller reads from the empty
 * container itself. The layer is `position: absolute; top: 0; left: 0`, so its rectangle *is* the
 * origin of whatever containing block it ended up in — the initial containing block normally, the
 * body's padding box if the host positions `<body>`. Measuring against `documentElement` instead
 * assumed the first case and shifted every band by the body's offset in the second (Codex on
 * #138).
 */
function bandsOf(origin: { left: number; top: number }, ranges: readonly Range[], clip: Clip): { left: number; top: number; width: number; height: number }[] {
  const rects: DOMRect[] = []
  for (const range of ranges) for (const rect of Array.from(range.getClientRects())) if (rect.width > 0 && rect.height > 0) rects.push(rect)
  const lines: { top: number; bottom: number; left: number; right: number }[] = []
  for (const rect of rects.sort((a, b) => a.top - b.top || a.left - b.left)) {
    // Same line when they overlap vertically by more than half the shorter one
    const line = lines.find(l => Math.min(l.bottom, rect.bottom) - Math.max(l.top, rect.top) > Math.min(l.bottom - l.top, rect.height) / 2)
    if (line) {
      line.top = Math.min(line.top, rect.top)
      line.bottom = Math.max(line.bottom, rect.bottom)
      line.left = Math.min(line.left, rect.left)
      line.right = Math.max(line.right, rect.right)
    } else lines.push({ top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right })
  }
  return lines
    .map(l => ({
      left: Math.max(l.left, clip.left),
      top: Math.max(l.top, clip.top),
      right: Math.min(l.right, clip.right),
      bottom: Math.min(l.bottom, clip.bottom),
    }))
    .filter(l => l.right > l.left && l.bottom > l.top)
    .map(l => ({ left: l.left - origin.left, top: l.top - origin.top, width: l.right - l.left, height: l.bottom - l.top }))
}

/** Viewport-space bounds a side's bands may paint in. */
interface Clip { left: number; top: number; right: number; bottom: number }

/** A computed background that paints nothing. */
const NO_BACKGROUND = /^(?:transparent|rgba\(0, 0, 0, 0\)|)$/

/**
 * The colour the page actually paints behind its text: the body's background, the root's when
 * the body has none, and the UA canvas when neither sets one.
 */
function pageBackground(doc: Document, view: Window): string {
  for (const el of [doc.body, doc.documentElement]) {
    const background = el ? view.getComputedStyle(el).backgroundColor : ''
    if (!NO_BACKGROUND.test(background)) return background
  }
  return 'Canvas'
}

/** The `overflow` values that clip. Anything else — `visible`, or nothing at all — does not. */
const CLIPS = /^(?:hidden|clip|scroll|auto)$/

/**
 * Where the bands for this side are allowed to paint: the intersection of every clipping ancestor's
 * box.
 *
 * The layer hangs off `<body>`, which is what keeps §7.1 intact — but it also puts the bands outside
 * whatever clipped the text they trace. A wide table in side mode scrolls inside `overflow-x: auto`
 * (`modes.css`, `[data-axt-fit="scroll"]` and `.axt-split`), and `Range.getClientRects()` reports
 * the full layout box of the text, including the part scrolled out of sight — so an unclipped band
 * would run past the container and paint over whatever sits beside it (Codex on #138).
 *
 * Read once per repaint, which happens only when the pointer moves to another sentence, and only
 * over the ancestors of one block.
 */
function clipOf(root: Element, view: Window): Clip {
  const clip: Clip = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
  // From the block itself: a container that scrolls its own content clips it just as an ancestor does
  for (let node: Element | null = root; node; node = node.parentElement) {
    const style = view.getComputedStyle(node)
    // `overflow: hidden` on one axis clips that axis alone; the other stays visible. Matched by the
    // values that clip rather than by "not visible": a computed style can report an empty string.
    const x = CLIPS.test(style.overflowX)
    const y = CLIPS.test(style.overflowY)
    if (!x && !y) continue
    const box = node.getBoundingClientRect()
    if (x) {
      clip.left = Math.max(clip.left, box.left)
      clip.right = Math.min(clip.right, box.right)
    }
    if (y) {
      clip.top = Math.max(clip.top, box.top)
      clip.bottom = Math.min(clip.bottom, box.bottom)
    }
  }
  return clip
}

/**
 * Drops whatever is painted right now. Safe to call at any time and on a document that never
 * started a highlight: `restore()` and `setMode()` use it without knowing whether one is running.
 */
export function clearSentenceHighlights(doc: Document): void {
  epoch++
  doc.body?.querySelector(`:scope > .${HL_CLASS}`)?.remove()
  doc.body?.querySelector(`:scope > .${PEEK_CLASS}`)?.remove()
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
  /** Whether the pointer is in the document at all. False until the first move, false again after leaving. */
  let over = false
  /** The band container, once it exists: mutations inside it are ours and must not feed back */
  let layer: Element | undefined
  let frame = 0
  let missTimer = 0
  let settleTimer = 0
  /**
   * The sentence currently painted, with the `epoch` it was painted at. The epoch is what makes
   * this cache safe: anything that clears the highlights from outside bumps it, and a stale entry
   * then compares unequal instead of suppressing the repaint.
   */
  let shown: { root: Element; index: number; at: number } | null = null

  /**
   * Marks what is painted as stale without forgetting that it is painted.
   *
   * **Not `shown = null`.** The miss path returns early when nothing is on screen, so forgetting the
   * entry means a repaint that finds no sentence under the pointer — a reflow moved it away, a
   * scroll brought blank space under the cursor — leaves the bands there for good (Codex on #138).
   * An impossible epoch makes the cache compare unequal, which is what invalidation needs, while
   * `miss()` still sees that there is something to fade out.
   */
  const STALE = -1
  const invalidate = () => {
    // Nothing to re-measure while the pointer is elsewhere. `x`/`y` keep the last position they were
    // given, so a resize or a scroll arriving after the pointer left the document would hit-test at
    // coordinates the pointer no longer occupies and paint a sentence nobody is pointing at — and
    // before the first `pointermove` those coordinates are (0, 0), which a startup resize would test
    // (Codex on #138).
    if (!over) return
    if (shown) shown = { ...shown, at: STALE }
    if (frame === 0) frame = view?.requestAnimationFrame(update) ?? 0
  }

  const view = doc.defaultView
  const clearTimer = (id: number) => { if (id !== 0) view?.clearTimeout(id) }
  const peek = createPeek(doc)
  /** The article root, whose right edge is where the margin begins. Static for the page's life. */
  const article = doc.querySelector(DOCUMENT_ROOT)

  /**
   * Drops what is painted, keeping the (empty) layer.
   *
   * Keeping it is what lets the repaint read its origin without having just written to the DOM:
   * created once per controller, emptied from then on. `stop()` still takes it away, as does
   * `clearSentenceHighlights` when `setMode()` or `restore()` calls it from outside.
   */
  const clearNow = () => {
    shown = null
    doc.body?.querySelector(`:scope > .${HL_CLASS}`)?.replaceChildren()
    peek.hide()
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
  const inside = (rect: DOMRect | undefined, slack: number): boolean =>
    !!rect && !(rect.width === 0 && rect.height === 0)
    && x >= rect.left - slack && x <= rect.right + slack
    && y >= rect.top - slack && y <= rect.bottom + slack

  const charRect = (text: Text, from: number): DOMRect | undefined => {
    if (from < 0 || from + 1 > text.data.length) return undefined
    const range = doc.createRange()
    range.setStart(text, from)
    range.setEnd(text, from + 1)
    return range.getBoundingClientRect()
  }

  /**
   * The DOM offset the pointer is really on, or undefined if it is not on text at all.
   *
   * **The answer feeds the sentence lookup, not just a yes/no.** When the hit comes from the
   * character *before* the caret, the caret's own offset is one too far — and at a sentence
   * boundary with no space between, which is every boundary in Chinese (`第一句。第二句。`),
   * one too far is the next sentence. Hovering the right half of the full stop would highlight the
   * sentence after it (Codex pointed this out on #136).
   */
  const offsetOn = (node: Node, offset: number): number | undefined => {
    if (node.nodeType === 1) {
      // A formula or other placeholder: its own box is the thing under the pointer
      return inside((node as Element).getBoundingClientRect(), HIT_SLACK_PX) ? offset : undefined
    }
    if (node.nodeType !== 3) return undefined
    const text = node as Text
    const after = charRect(text, offset)
    const before = charRect(text, offset - 1)
    // **Real containment first, for both, before any slack.** Two adjacent glyphs on one line have
    // rectangles that overlap once they are widened, so preferring the character after the caret
    // would take the next one for a pointer in the last few pixels of this one — and at a sentence
    // boundary that is the next sentence (Codex pointed this out on #136). The slack exists to
    // keep the outer edges of a line alive, not to decide between two candidates.
    if (inside(after, 0)) return offset
    if (inside(before, 0)) return offset - 1
    if (inside(after, HIT_SLACK_PX)) return offset
    return inside(before, HIT_SLACK_PX) ? offset - 1 : undefined
  }

  const update = () => {
    frame = 0
    const caret = doc.caretPositionFromPoint(x, y)
    const node = caret?.offsetNode
    const found = node ? sentenceMapAt(node) : undefined
    const at = found && node ? offsetOn(node, caret.offset) : undefined
    if (!found || !node || at === undefined) {
      miss()
      return
    }
    const { map, side } = found
    const wire = wireOffsetAt(map[side].index, node, at)
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
    // The layer is fetched first because its own rectangle is the origin every band is measured
    // against, and it must be read in the same pass as the ranges. It is created at most once per
    // controller — the miss path empties it rather than removing it — so this is a read, not a
    // write followed by reads.
    layer = layerOf(doc)
    const origin = layer.getBoundingClientRect()
    // The side the pointer is not on. When it is not rendered — only mode hides the original — its
    // bands would come out empty, so they are not measured at all; its ranges go to the panel
    // instead, built only once the panel actually renders (issue #141)
    const other = side === 'source' ? 'target' : 'source'
    const hidden = !rendered(map[other].root)
    const bandsFor = (which: 'source' | 'target') =>
      view ? bandsOf(origin, rangesOf(map[which].spans, sentence[which].from, sentence[which].to), clipOf(map[which].root, view)) : []
    // Every side is measured before anything is written: reads and writes never interleave
    const sides = [{ side, bands: bandsFor(side) }, ...(hidden ? [] : [{ side: other, bands: bandsFor(other) }])]
    // What the panel needs is read in the same pass — the sentence's own lines, the block they sit
    // in and the article's edge, in viewport coordinates. The bands were shifted to the layer's
    // origin, so it is added back here
    let anchor: PeekAnchor | undefined
    if (hidden && view) {
      const own = sides[0]!.bands
      const first = own[0]
      const last = own[own.length - 1]
      if (first && last) {
        const block = map[side].root.getBoundingClientRect()
        const type = view.getComputedStyle(map[side].root)
        anchor = {
          top: first.top + origin.top,
          bottom: last.top + last.height + origin.top,
          block: { left: block.left, width: block.width },
          articleRight: article?.getBoundingClientRect().right,
          viewport: { width: view.innerWidth, height: view.innerHeight },
          type: { font: type.font, color: type.color, background: pageBackground(doc, view) },
        }
      }
    }
    layer.textContent = ''
    for (const { side, bands } of sides) {
      for (const band of bands) {
        const el = doc.createElement('div')
        el.setAttribute(SIDE_ATTR, side)
        el.setAttribute('style', `left:${band.left.toFixed(1)}px;top:${band.top.toFixed(1)}px;width:${band.width.toFixed(1)}px;height:${band.height.toFixed(1)}px`)
        layer.append(el)
      }
    }
    if (anchor) peek.show({ root: map.source.root, index: sentence.index }, () => rangesOf(map[other].spans, sentence[other].from, sentence[other].to), anchor)
    else peek.hide()
  }

  const onMove = (event: PointerEvent) => {
    over = true
    x = event.clientX
    y = event.clientY
    if (frame === 0) frame = view?.requestAnimationFrame(update) ?? 0
  }
  const onLeave = () => {
    over = false
    hit()
    clearNow()
  }

  /**
   * A reflow moves the text but not the bands.
   *
   * The bands are absolute boxes in document coordinates, so scrolling carries them along — but a
   * window resize, a browser zoom or a font swap re-lays out the line they were traced from, and
   * nothing about that produces a pointer event. Worse, the sentence cache would suppress the
   * repaint even once the pointer did move, as long as it stayed on the same sentence (Codex on
   * #138). Dropping the cache and asking for a frame re-measures at the pointer's own position,
   * which is where the reader is looking; a reflow that moved that sentence out from under it
   * fades out through the ordinary miss path.
   */
  const onResize = invalidate

  /**
   * A container scrolling its own content moves the text out from under the bands.
   *
   * The page's own scroll does not: the bands are absolute boxes in document coordinates and are
   * carried along with everything else, which is why this deliberately ignores it — repainting on
   * every frame of ordinary reading would cost a hit test and a set of geometry reads for nothing.
   * An element scrolling inside `overflow`, though, moves its text relative to the document while
   * the bands stay put, and nothing about that produces a pointer event (Codex on #138). Those are
   * the same containers `clipOf` bounds the bands to.
   *
   * Capture phase: `scroll` does not bubble, so a listener on the document only sees an element's
   * scroll on the way down.
   */
  const onScroll = (event: Event) => {
    const target = event.target
    if (target !== doc && target !== doc.documentElement && target !== doc.body) {
      invalidate()
      return
    }
    // The page's own scroll carries the bands along, so the tint stays on its sentence — but that
    // sentence is no longer the one under the pointer, and nothing else will notice until the
    // pointer moves (Codex on #138). Re-testing every frame of a scroll is what this deliberately
    // does not do; once it settles is enough, and that is also when the reader looks again.
    //
    // The panel, though, closes at once: the sentence it showed is on its way out, and the
    // sentences the pointer crosses while the page moves must not each get their turn — the dwell
    // starts over once the page has settled (issue #141)
    peek.hide()
    clearTimer(settleTimer)
    settleTimer = view?.setTimeout(() => {
      settleTimer = 0
      invalidate()
    }, SCROLL_SETTLE_MS) ?? 0
  }

  doc.addEventListener('pointermove', onMove, { passive: true })
  // Leaving the window keeps no pointer events coming, so the tint would stay behind
  doc.addEventListener('pointerleave', onLeave)
  view?.addEventListener('resize', onResize)
  doc.addEventListener('scroll', onScroll, { capture: true, passive: true })
  /**
   * The page reflowing under a pointer that never moved.
   *
   * Translation arrives progressively — the controller is started before the run does (`content/
   * index.ts`) — so a block completing *above* the sentence being pointed at pushes it down while
   * the bands stay at the coordinates they were measured at. No resize, no scroll, no pointer event
   * (Codex on #138). Observing the body's own box catches it, along with anything else that changes
   * the document's height: images loading, fonts swapping, a section expanding.
   *
   * The bands themselves cannot trigger it — they are absolutely positioned, so they contribute
   * nothing to their container's size — and the callback costs nothing while the pointer is away,
   * since `invalidate` returns early then.
   */
  const observer = view?.ResizeObserver ? new view.ResizeObserver(() => invalidate()) : undefined
  if (doc.body) observer?.observe(doc.body)
  /**
   * Reflows that never change the body's own box.
   *
   * A block landing between two others re-wraps everything below it without necessarily changing
   * the document's height, and a column that changes width re-wraps its text at the same height
   * (Codex on #138). Watching for the mutations themselves catches those, and it is the same signal
   * the progressive-translation case really rests on.
   *
   * **Our own bands are written into the layer, which is inside `<body>`**, so a record whose
   * target is the layer is skipped — reacting to it would repaint on every repaint.
   */
  const mutations = view?.MutationObserver
    ? new view.MutationObserver(records => {
        for (const record of records) {
          if (record.target !== layer && !peek.contains(record.target)) {
            invalidate()
            return
          }
        }
      })
    : undefined
  // `attributes` as well as `childList`: a class or inline style toggled on an ancestor re-lays out
  // its subtree without inserting anything, and `characterData` because the text of a translation
  // node is set in place after its node is inserted (Codex on #138). The panel's own writes are
  // skipped the same way as the layer's; it is `position: fixed` and never changes the body's box
  // either, so the size observer does not see it
  if (doc.body) mutations?.observe(doc.body, { childList: true, subtree: true, attributes: true, characterData: true })
  /**
   * A font swapping under the text.
   *
   * It re-lays out every line and produces no mutation at all; the size observer only sees it if the
   * document's height happens to change with it. `loadingdone` is the event for exactly this.
   */
  const onFonts = () => invalidate()
  doc.fonts?.addEventListener('loadingdone', onFonts)

  return {
    stop() {
      doc.removeEventListener('pointermove', onMove)
      doc.removeEventListener('pointerleave', onLeave)
      view?.removeEventListener('resize', onResize)
      doc.removeEventListener('scroll', onScroll, { capture: true })
      observer?.disconnect()
      mutations?.disconnect()
      doc.fonts?.removeEventListener('loadingdone', onFonts)
      clearTimer(settleTimer)
      settleTimer = 0
      if (frame !== 0) view?.cancelAnimationFrame(frame)
      hit()
      shown = null
      peek.remove()
      // Unconditionally, not conditioned on anything being shown: another run of this document may
      // have left entries behind, and stopping should leave the page clean either way
      clearSentenceHighlights(doc)
    },
  }
}
