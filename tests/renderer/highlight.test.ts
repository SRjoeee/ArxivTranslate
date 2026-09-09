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
  const highlights = new Map<string, { ranges: Range[] }>()
  const view = doc.defaultView as unknown as Record<string, unknown>
  const caret = vi.fn<(x: number, y: number) => { offsetNode: Node; offset: number } | null>(() => null)
  const timers: { fn: () => void; delay: number }[] = []
  // Queued, not run inline: a real `requestAnimationFrame` returns before the callback runs, and a
  // stub that runs it first makes the handle land after the callback cleared it — after which the
  // highlight thinks a frame is always pending and stops updating.
  const frames: (() => void)[] = []

  vi.stubGlobal('CSS', { highlights })
  vi.stubGlobal('Highlight', class { ranges: Range[]; constructor(...ranges: Range[]) { this.ranges = ranges } })
  Object.assign(doc, { caretPositionFromPoint: caret })
  // happy-dom measures nothing, so the layout is declared here. By default every character lives in
  // one 200×20 box at the origin: a pointer inside it is on the text, one outside is in the margin.
  // `wrapAt` moves the character at that offset down a line, which is what a line wrap looks like
  // to the hit test.
  const line1 = { left: 0, top: 0, right: 200, bottom: 20, width: 200, height: 20, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
  const line2 = { left: 0, top: 30, right: 200, bottom: 50, width: 200, height: 20, x: 0, y: 30, toJSON: () => ({}) } as DOMRect
  // Queued by call order rather than keyed by offset: happy-dom's `Range.startOffset` does not
  // report what was set on it, so the stub cannot tell the two characters apart any other way.
  const queued: DOMRect[] = []
  const view2 = doc.defaultView as unknown as { Range: { prototype: Range }; Element: { prototype: Element } }
  view2.Range.prototype.getBoundingClientRect = () => queued.shift() ?? line1
  view2.Element.prototype.getBoundingClientRect = () => line1
  view.requestAnimationFrame = (fn: () => void) => frames.push(fn)
  view.cancelAnimationFrame = () => {}
  view.setTimeout = (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length }
  view.clearTimeout = (id: number) => { if (timers[id - 1]) timers[id - 1] = { fn: () => {}, delay: 0 } }

  return {
    highlights,
    caret,
    /** Rects for the next `getBoundingClientRect` calls, in order. `line2` is one line down. */
    nextRects: (...which: ('line1' | 'line2')[]) => { queued.push(...which.map(n => (n === 'line2' ? line2 : line1))) },
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

    expect([...browser.highlights.keys()].sort()).toEqual(['axt-sentence-source', 'axt-sentence-target'])
    // Both sides light up from one hit, which is the whole point
    expect(browser.highlights.get('axt-sentence-source')!.ranges.length).toBeGreaterThan(0)
    expect(browser.highlights.get('axt-sentence-target')!.ranges.length).toBeGreaterThan(0)
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
    const first = browser.highlights.get('axt-sentence-source')
    // Well past "First sentence here. " — and the fixture really does split in two, or moving
    // between sentences would not be under test at all
    expect(sentences).toBe(2)
    browser.caret.mockReturnValue({ offsetNode: text, offset: text.data.length - 3 })
    browser.move()

    expect(browser.highlights.get('axt-sentence-source')).not.toBe(first)
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
    const first = browser.highlights.get('axt-sentence-source')
    browser.caret.mockReturnValue({ offsetNode: text, offset: 5 })
    browser.move()

    expect(browser.highlights.get('axt-sentence-source')).toBe(first)
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
    expect(browser.highlights.size).toBe(2)
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
    expect(browser.highlights.size).toBe(2)

    setMode(doc, 'side')
    expect(browser.highlights.size).toBe(0)

    browser.move() // same sentence, same position
    expect(browser.highlights.size).toBe(2)
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
    expect(browser.highlights.size).toBe(0)
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
    expect(browser.highlights.size).toBe(0)
    browser.move(10, 400) // far below it
    expect(browser.highlights.size).toBe(0)

    browser.move(10, 10) // the same caret, now actually under the pointer
    expect(browser.highlights.size).toBe(2)
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
    expect(browser.highlights.size).toBe(2)
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

    expect(browser.highlights.size).toBe(0)
    hl.stop()
  })

  it('stop() and clearSentenceHighlights() both leave nothing behind', () => {
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    hl.stop()
    expect(browser.highlights.size).toBe(0)

    // And after stopping, a pointer move is not listened for any more
    browser.move()
    expect(browser.highlights.size).toBe(0)

    browser.highlights.set('axt-sentence-source', { ranges: [] })
    doc.documentElement.setAttribute('data-axt-hl', 'on')
    clearSentenceHighlights(doc)
    expect(browser.highlights.size).toBe(0)
  })

  it('restore() drops the tint along with the translation nodes', () => {
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    expect(browser.highlights.size).toBe(2)

    restore(doc)
    expect(browser.highlights.size).toBe(0)
    hl.stop()
  })
})
