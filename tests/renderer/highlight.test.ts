import { afterEach, describe, expect, it, vi } from 'vitest'
import { rehydrate, serialize } from '@/core/protector'
import { clearSentenceHighlights, registerSentences, restore, setMode, startSentenceHighlight } from '@/core/renderer'
import { splitSentences } from '@/core/sentences'

/**
 * happy-dom has none of the highlight machinery, so the browser side is stubbed: a Map standing in
 * for `CSS.highlights`, a `Highlight` that just keeps its ranges, a scripted
 * `caretPositionFromPoint`, and a `requestAnimationFrame` that runs its callback at once.
 *
 * What that leaves under test is exactly the part that is ours — which sentence a pointer position
 * resolves to, when the registry is written and cleared, and what drives the fade — while the parts
 * the browser owns are verified where they can be: the paint itself was screenshotted in Chrome
 * (`::highlight()` accepts `background-color`, ignores `padding`, and reads a transitioning
 * `@property` custom property), and the ranges in a real browser on #123.
 */
function stubBrowser(doc: Document) {
  const view = doc.defaultView as unknown as Record<string, unknown>
  const caret = vi.fn<(x: number, y: number) => { offsetNode: Node; offset: number } | null>(() => null)
  const timers: { fn: () => void; delay: number }[] = []
  // Queued, not run inline: a real `requestAnimationFrame` returns before the callback runs, and a
  // stub that runs it first makes the handle land after the callback cleared it — after which the
  // highlight thinks a frame is always pending and stops updating.
  const frames: (() => void)[] = []

  Object.assign(doc, { caretPositionFromPoint: caret })
  // happy-dom measures nothing, so the layout is declared here. By default every character lives in
  // one 200×20 box at the origin: a pointer inside it is on the text, one outside is in the margin.
  // `wrapAt` moves the character at that offset down a line, which is what a line wrap looks like
  // to the hit test.
  const line1 = { left: 0, top: 0, right: 200, bottom: 20, width: 200, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  const line2 = { left: 0, top: 30, right: 200, bottom: 50, width: 200, height: 20, x: 0, y: 30, toJSON: () => ({}) } as DOMRect
  /** Two glyphs side by side on one line: 0–100 and 100–200 */
  const leftHalf = { left: 0, top: 0, right: 100, bottom: 20, width: 100, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  const rightHalf = { left: 100, top: 0, right: 200, bottom: 20, width: 100, height: 20, x: 100, y: 0, toJSON: () => ({}) } as DOMRect
  // Queued by call order rather than keyed by offset: happy-dom's `Range.startOffset` does not
  // report what was set on it, so the stub cannot tell the two characters apart any other way.
  const queued: DOMRect[] = []
  const view2 = doc.defaultView as unknown as { Range: { prototype: Range }; Element: { prototype: Element } }
  view2.Range.prototype.getBoundingClientRect = () => queued.shift() ?? line1
  view2.Element.prototype.getBoundingClientRect = () => line1
  // Bands are drawn from line-level rectangles. One line per range by default; `nextLines` sets more.
  let lines: DOMRect[] = [line1]
  view2.Range.prototype.getClientRects = () => Object.assign([...lines], { item: (i: number) => lines[i] ?? null }) as unknown as DOMRectList
  // Which text interval each painted range was built from. `startOffset` cannot be read back in
  // happy-dom, so the calls that set it are recorded instead.
  const starts: [number, number][] = []
  const createRange = doc.createRange.bind(doc)
  doc.createRange = () => {
    const range = createRange()
    const setStart = range.setStart.bind(range)
    const setEnd = range.setEnd.bind(range)
    let from = -1
    range.setStart = (n: Node, o: number) => { from = o; setStart(n, o) }
    range.setEnd = (n: Node, o: number) => { if (from >= 0) starts.push([from, o]); setEnd(n, o) }
    return range
  }
  // happy-dom has no ResizeObserver. The stub registers the callback **when `observe` is called**,
  // not when the observer is constructed, so a controller that never observes anything reports no
  // reflows — otherwise the test would pass without the observation being wired up at all.
  const resizes: (() => void)[] = []
  view.ResizeObserver = class {
    fn: () => void
    constructor(fn: () => void) { this.fn = fn }
    observe() { resizes.push(this.fn) }
    disconnect() { const at = resizes.indexOf(this.fn); if (at >= 0) resizes.splice(at, 1) }
  }
  view.requestAnimationFrame = (fn: () => void) => frames.push(fn)
  view.cancelAnimationFrame = () => {}
  view.setTimeout = (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length }
  view.clearTimeout = (id: number) => { if (timers[id - 1]) timers[id - 1] = { fn: () => {}, delay: 0 } }

  return {
    /** The bands that were painted */
    bands: () => Array.from(doc.querySelectorAll('.axt-hl > div')),
    /** How many lines one range reports */
    nextLines: (...rects: DOMRect[]) => { lines = rects },
    line1,
    line2,
    caret,
    /** The `[from, to]` of every range that was built, in order */
    starts: () => starts.splice(0),
    /** Rects for the next `getBoundingClientRect` calls, in order. `line2` is one line down. */
    nextRects: (...which: ('line1' | 'line2' | 'left' | 'right')[]) => {
      const by = { line1, line2, left: leftHalf, right: rightHalf }
      queued.push(...which.map(n => by[n]))
    },
    /** Runs whatever is scheduled, optionally only the timers of one delay */
    flushTimers: (delay?: number) => {
      const due = delay === undefined ? timers.splice(0) : timers.filter(t => t.delay === delay)
      if (delay !== undefined) for (const t of due) timers.splice(timers.indexOf(t), 1)
      for (const t of due) t.fn()
    },
    delays: () => timers.map(t => t.delay),
    frames,
    /** One pointer move plus the frame it schedules. Defaults to a point on the text. */
    move: (clientX = 10, clientY = 10) => {
      doc.dispatchEvent(Object.assign(new Event('pointermove'), { clientX, clientY }))
      for (const fn of frames.splice(0)) fn()
    },
    /** A scroll dispatched from `el` (capture phase) plus the frame it schedules */
    scrollOn: (el: EventTarget) => {
      el.dispatchEvent(new Event('scroll'))
      for (const fn of frames.splice(0)) fn()
    },
    /** A reflow reported by the ResizeObserver, plus the frame it schedules */
    reflow: () => {
      for (const fn of resizes) fn()
      for (const fn of frames.splice(0)) fn()
    },
    /** A window resize plus the frame it schedules */
    resize: () => {
      doc.defaultView?.dispatchEvent(new Event('resize'))
      for (const fn of frames.splice(0)) fn()
    },
    /** A pointer move with no frame after it, for testing coalescing */
    moveOnly: () => doc.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 10, clientY: 10 })),
  }
}

/** A block with its translation beside it, registered with a real alignment. */
function page(html: string) {
  const doc = new DOMParser().parseFromString('<html><body></body></html>', 'text/html')
  doc.body.innerHTML = html
  const source = doc.body.firstElementChild!
  const block = serialize(source, 'tags')
  const fragment = rehydrate(block.text, block, doc)
  const target = doc.createElement(source.tagName)
  target.append(fragment)
  source.after(target)
  const lengths = splitSentences(block.text, 'tags')
  registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
  return { doc, source, target, sentences: lengths.length }
}

const TWO = '<p class="ltx_p">First sentence here. Second sentence here.</p>'

afterEach(() => vi.unstubAllGlobals())

describe('hover sentence highlight (§7.7)', () => {
  it('does nothing at all when the browser cannot paint it', () => {
    // Chrome below 131, or any engine without the Custom Highlight API. Returning undefined means
    // the caller has no handle and nothing to stop.
    const { doc } = page(TWO)
    expect(startSentenceHighlight(doc)).toBeUndefined()
  })

  it('tints the pointed-at sentence on both sides at once', () => {
    const { doc, source, target } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()

    expect(browser.bands().map(b => b.getAttribute('data-axt-hl-side'))).toEqual(['source', 'target'])
    // Both sides light up from one hit, which is the whole point
    expect(browser.bands().length).toBe(2)
    expect(target.isConnected).toBe(true)
    hl.stop()
  })

  it('follows the pointer from one sentence to the next', () => {
    const { doc, source, sentences } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const text = source.firstChild as Text

    browser.caret.mockReturnValue({ offsetNode: text, offset: 3 })
    browser.move()
    // The stub gives every range the same rectangle, so the painted boxes cannot tell the two
    // sentences apart; the recorder shows which stretch of text was measured, which is the thing
    // that has to change when the pointer moves to the next sentence.
    const first = browser.starts()
    expect(sentences).toBe(2)
    browser.caret.mockReturnValue({ offsetNode: text, offset: text.data.length - 3 })
    browser.move()
    const second = browser.starts()

    expect(first.at(-2)).not.toEqual(second.at(-2))
    expect(browser.bands().length).toBe(2)
    hl.stop()
  })

  it('repaints after a reflow, which produces no pointer event of its own', () => {
    // A resize, a browser zoom or a font swap re-lays out the line the bands were traced from, and
    // the sentence cache would suppress the repaint for as long as the pointer stayed on the same
    // sentence — leaving the tint behind where the text used to be (Codex on #138).
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const r = (top: number) =>
      ({ left: 0, top, right: 200, bottom: top + 20, width: 200, height: 20, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    const before = browser.bands().map(b => b.getAttribute('style'))

    browser.nextLines(r(300))
    browser.resize()

    expect(browser.bands().map(b => b.getAttribute('style'))).not.toEqual(before)
    expect(browser.bands().every(b => (b.getAttribute('style') ?? '').includes('top:300.0px'))).toBe(true)
    hl.stop()
  })

  it('repaints when a container scrolls its own text, and not when the page does', () => {
    // The bands are absolute boxes in document coordinates, so the page's own scroll carries them
    // along — repainting for that would cost a hit test and a set of geometry reads on every frame
    // of ordinary reading. An element scrolling inside `overflow` is the opposite: its text moves
    // relative to the document while the bands stay put, and it produces no pointer event either
    // (Codex on #138).
    const { doc, source, target } = page(TWO)
    // The pair inside a scroller of its own — `<body>` scrolling is the page scrolling
    const scroller = doc.createElement('div')
    source.before(scroller)
    scroller.append(source, target)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const r = (top: number) =>
      ({ left: 0, top, right: 200, bottom: top + 20, width: 200, height: 20, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    const before = browser.bands().map(b => b.getAttribute('style'))

    browser.starts()
    browser.scrollOn(doc)
    expect(browser.starts()).toEqual([]) // the page scrolling rebuilds nothing

    browser.nextLines(r(300))
    browser.scrollOn(scroller)

    expect(browser.bands().map(b => b.getAttribute('style'))).not.toEqual(before)
    expect(browser.bands().every(b => (b.getAttribute('style') ?? '').includes('top:300.0px'))).toBe(true)
    hl.stop()
  })

  it('fades out when a reflow moves the sentence away from the pointer', () => {
    // Invalidating by forgetting what is painted breaks the miss path — it returns early when
    // nothing is on screen, so the bands would sit there for good once the repaint found no
    // sentence under the pointer (Codex on #138). The entry has to survive as stale.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    expect(browser.bands().length).toBe(2)

    // The reflow put blank space under the pointer
    browser.caret.mockReturnValue(null)
    browser.resize()
    expect(browser.bands().length).toBe(2) // held through the grace period, as a pointer crossing a gap is
    browser.flushTimers()

    expect(browser.bands()).toEqual([])
    hl.stop()
  })

  it('measures the bands from the layer\'s own origin, not the root element\'s', () => {
    // The layer is `position: absolute; top: 0; left: 0`, so its rectangle is the origin of whatever
    // containing block it landed in — the initial one normally, the body's padding box when the host
    // positions `<body>`. Measuring against `documentElement` assumed the first case and shifted
    // every band by the body's offset in the second (Codex on #138).
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const proto = (doc.defaultView as unknown as { Element: { prototype: Element } }).Element.prototype
    const previous = proto.getBoundingClientRect
    const shifted = { left: 8, top: 8, right: 8, bottom: 8, width: 0, height: 0, x: 8, y: 8, toJSON: () => ({}) } as DOMRect
    proto.getBoundingClientRect = function (this: Element) {
      return this.classList?.contains('axt-hl') ? shifted : browser.line1
    }
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()

    // the sentence's line is at (0, 0); the layer starts 8px in, so the band has to come back by 8
    expect(browser.bands().map(b => b.getAttribute('style'))).toEqual([
      'left:-8.0px;top:-8.0px;width:200.0px;height:20.0px',
      'left:-8.0px;top:-8.0px;width:200.0px;height:20.0px',
    ])
    hl.stop()
    proto.getBoundingClientRect = previous
  })

  it('does not repaint at coordinates the pointer has left', () => {
    // `x`/`y` keep the last position they were given, so a resize or a scroll arriving after the
    // pointer left the document would hit-test where the pointer no longer is — and before the
    // first move those coordinates are (0, 0), which a startup resize would test (Codex on #138).
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })

    // A resize before the pointer has ever been over the document paints nothing
    browser.resize()
    expect(browser.bands()).toEqual([])

    browser.move()
    expect(browser.bands().length).toBe(2)

    // …and once it leaves, a resize must not bring the tint back
    doc.dispatchEvent(new Event('pointerleave'))
    expect(browser.bands()).toEqual([])
    browser.resize()
    expect(browser.bands()).toEqual([])
    hl.stop()
  })

  it('repaints when the page reflows under a pointer that never moved', () => {
    // Translation arrives progressively and the controller starts before the run does, so a block
    // completing above the pointed-at sentence pushes it down with no resize, no scroll and no
    // pointer event to notice (Codex on #138).
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const r = (top: number) =>
      ({ left: 0, top, right: 200, bottom: top + 20, width: 200, height: 20, x: 0, y: top, toJSON: () => ({}) }) as DOMRect

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    const before = browser.bands().map(b => b.getAttribute('style'))

    browser.nextLines(r(300))
    browser.reflow()

    expect(browser.bands().map(b => b.getAttribute('style'))).not.toEqual(before)
    expect(browser.bands().every(b => (b.getAttribute('style') ?? '').includes('top:300.0px'))).toBe(true)
    hl.stop()
  })

  it('keeps a band inside the container that clips its text', () => {
    // The layer hangs off `<body>`, outside whatever clipped the text — and `getClientRects()`
    // reports the whole layout box, including the part scrolled out of sight. A wide table in side
    // mode scrolls inside `overflow-x: auto`, so an unclipped band would run past it and paint over
    // the column beside it (Codex on #138).
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const box = { left: 0, top: 0, right: 80, bottom: 20, width: 80, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
    const scroller = source.parentElement as HTMLElement
    scroller.style.overflowX = 'auto'
    scroller.style.overflowY = 'hidden'
    scroller.getBoundingClientRect = () => box

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()

    // the stub's line is 200 wide; the container is 80
    expect(browser.bands().map(b => b.getAttribute('style'))).toEqual([
      'left:0.0px;top:0.0px;width:80.0px;height:20.0px',
      'left:0.0px;top:0.0px;width:80.0px;height:20.0px',
    ])
    hl.stop()
  })

  it('merges rectangles that share a line into one band', () => {
    // A range reports more than one rectangle for a line when it crosses inline elements of
    // different heights — a formula in the middle of a sentence. Drawing them as they come leaves a
    // notch where the maths is, which is exactly the ragged look this replaced (user report with a
    // screenshot, 2026-09-09). One line is always one band.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const r = (left: number, top: number, right: number, bottom: number) =>
      ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect

    // One line cut into three by a formula, plus a second line of its own
    browser.nextLines(r(0, 0, 60, 20), r(60, 2, 90, 18), r(90, 0, 200, 20), r(0, 30, 150, 50))
    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()

    const bands = browser.bands().filter(b => b.getAttribute('data-axt-hl-side') === 'source')
    expect(bands).toHaveLength(2)
    expect(bands[0]!.getAttribute('style')).toBe('left:0.0px;top:0.0px;width:200.0px;height:20.0px')
    expect(bands[1]!.getAttribute('style')).toBe('left:0.0px;top:30.0px;width:150.0px;height:20.0px')
    hl.stop()
  })

  it('draws the bands outside the content, so §7.1 is untouched', () => {
    const { doc, source, target } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const before = source.outerHTML + target.outerHTML

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()

    expect(browser.bands().length).toBe(2)
    // 原块与译文一个字节都没动，底色层挂在 body 上、不在它们之间
    expect(source.outerHTML + target.outerHTML).toBe(before)
    expect(doc.querySelector('.axt-hl')!.parentElement!.tagName.toLowerCase()).toBe('body')
    expect(source.nextElementSibling).toBe(target)
    hl.stop()
  })

  it('coalesces a burst of pointer moves into one frame', () => {
    // A pointer produces far more move events than there are frames, and each one would otherwise
    // cost a `caretPositionFromPoint`, which is a layout read.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.moveOnly()
    browser.moveOnly()
    browser.moveOnly()
    expect(browser.frames.length).toBe(1)
    for (const fn of browser.frames.splice(0)) fn()
    expect(browser.caret).toHaveBeenCalledTimes(1)
    hl.stop()
  })

  it('rebuilds nothing while the pointer stays inside the same sentence', () => {
    // The common case: a pointer resting on a line hits it every frame.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const text = source.firstChild as Text

    browser.caret.mockReturnValue({ offsetNode: text, offset: 3 })
    browser.move()
    const first = browser.bands()[0]!.getAttribute('style')
    browser.caret.mockReturnValue({ offsetNode: text, offset: 5 })
    browser.move()

    expect(browser.bands()[0]!.getAttribute('style')).toBe(first)
    hl.stop()
  })

  it('a second controller does not lose its highlight to the first one fading', () => {
    // Out of contract — `content/index.ts` calls `endRun()`, which stops the running controller,
    // before starting another — but cheap to hold: both are listening, so the older one repaints
    // and cancels its own fade on the same pointer move.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const first = startSentenceHighlight(doc)!
    const text = source.firstChild as Text

    browser.caret.mockReturnValue({ offsetNode: text, offset: 3 })
    browser.move()
    browser.caret.mockReturnValue(null)
    browser.move()
    browser.flushTimers(120)

    const second = startSentenceHighlight(doc)!
    browser.caret.mockReturnValue({ offsetNode: text, offset: 3 })
    browser.move()
    browser.flushTimers()
    expect(browser.bands().length).toBe(2)
    first.stop()
    second.stop()
  })

  it('repaints after setMode cleared the highlights under it', () => {
    // `setMode()` empties the registries but cannot reach into this controller. Without the epoch,
    // a pointer still resting on the same sentence takes the "nothing changed" path forever.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    expect(browser.bands().length).toBe(2)

    setMode(doc, 'side')
    expect(browser.bands().length).toBe(0)

    browser.move() // same sentence, same position
    expect(browser.bands().length).toBe(2)
    hl.stop()
  })

  it('holds through a brief miss, then clears', () => {
    // Crossing the gap between two paragraphs is a miss the reader experiences as one continuous
    // movement; reacting to it instantly would blink.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    browser.caret.mockReturnValue(null)
    browser.move()

    browser.flushTimers(120)
    expect(browser.bands().length).toBe(0)
    hl.stop()
  })

  it('ignores a pointer that is beside the text rather than on it', () => {
    // `caretPositionFromPoint` answers "which caret is nearest", not "is there text here", so a
    // pointer out in the right-hand margin still resolves to the last character of a line. Without
    // a hit test the whole gutter of a paper highlights the paragraph beside it — reported from
    // real use, and the reason `onTheText` exists. The stub puts every character in one 200×20 box.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move(600, 10) // far to the right of the text
    expect(browser.bands().length).toBe(0)
    browser.move(10, 400) // far below it
    expect(browser.bands().length).toBe(0)

    browser.move(10, 10) // the same caret, now actually under the pointer
    expect(browser.bands().length).toBe(2)
    hl.stop()
  })

  it('resolves the sentence from the character that actually matched', () => {
    // The hit can come from the character *before* the caret, and the caret's own offset is then
    // one too far. At a boundary with no space between — every boundary in Chinese — one too far
    // is the next sentence, so hovering the right half of a full stop would light up the sentence
    // after it (Codex on #136).
    const { doc, source, target } = page('<p class="ltx_p">One. Two.</p>')
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const text = source.firstChild as Text
    const boundary = 'One. '.length // the caret between the two sentences

    // The character at the boundary is elsewhere; the one before it is under the pointer
    browser.nextRects('line2', 'line1')
    browser.caret.mockReturnValue({ offsetNode: text, offset: boundary })
    browser.move(150, 10)

    // Read through the recorder, not off the Range: happy-dom's `startOffset` does not report what
    // was set on it, which is why `tests/protector/offsets.test.ts` records the calls too.
    // The first two are the hit test probing both characters; the third is the sentence it painted.
    const built = browser.starts()
    expect(built.slice(0, 2)).toEqual([[5, 6], [4, 5]])
    expect(built[2]).toEqual([0, 5]) // the first sentence, not the second
    expect(target.isConnected).toBe(true)
    hl.stop()
  })

  it('prefers the character that really contains the pointer over one the slack reaches', () => {
    // Two adjacent glyphs on a line have rectangles that overlap once widened by the slack, so
    // taking the character after the caret first claims a pointer in the last pixels of the one
    // before it — and at a boundary that is the next sentence (Codex on #136). The slack is for
    // the outer edges of a line, not for choosing between two candidates.
    const { doc, source } = page('<p class="ltx_p">One. Two.</p>')
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!
    const boundary = 'One. '.length

    // After the caret is the right half; before it is the left half. The pointer is at x=98,
    // inside the left half and within 4px of the right half.
    browser.nextRects('right', 'left')
    browser.caret.mockReturnValue({ offsetNode: source.firstChild as Text, offset: boundary })
    browser.move(98, 10)

    const built = browser.starts()
    expect(built.slice(0, 2)).toEqual([[5, 6], [4, 5]])
    expect(built[2]).toEqual([0, 5]) // the first sentence
    hl.stop()
  })

  it('accepts a pointer on the last character of a wrapped line', () => {
    // `caretPositionFromPoint` gives an insertion point: on the right half of a glyph it returns
    // the position *after* it. At a line wrap the character at that offset is on the next line, so
    // measuring only it rejects a pointer sitting plainly on the last word of a line (Codex on
    // #136). Both characters the caret sits between are measured.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    // The character after the caret is measured first and has wrapped; the one before it has not
    browser.nextRects('line2', 'line1')
    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 4 })
    browser.move(150, 10) // on the first line, where the character before the caret is
    expect(browser.bands().length).toBe(2)
    hl.stop()
  })

  it('ignores a block whose translation has been removed', () => {
    // `restore()` leaves the originals in place, so a registry entry outlives its block.
    const { doc, source, target } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    target.remove()
    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()

    expect(browser.bands().length).toBe(0)
    hl.stop()
  })

  it('stop() and clearSentenceHighlights() both leave nothing behind', () => {
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    hl.stop()
    expect(browser.bands().length).toBe(0)

    // And after stopping, a pointer move is not listened for any more
    browser.move()
    expect(browser.bands().length).toBe(0)

    // 外部清空同样什么都不留
    clearSentenceHighlights(doc)
    expect(browser.bands().length).toBe(0)
    expect(doc.querySelectorAll('.axt-hl')).toHaveLength(0)
  })

  it('restore() drops the tint along with the translation nodes', () => {
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    expect(browser.bands().length).toBe(2)

    restore(doc)
    expect(browser.bands().length).toBe(0)
    hl.stop()
  })
})
