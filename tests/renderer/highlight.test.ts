import { afterEach, describe, expect, it, vi } from 'vitest'
import { rehydrate, serialize } from '@/core/protector'
import { clearSentenceHighlights, registerSentences, restore, startSentenceHighlight } from '@/core/renderer'
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
  view.requestAnimationFrame = (fn: () => void) => frames.push(fn)
  view.cancelAnimationFrame = () => {}
  view.setTimeout = (fn: () => void, delay: number) => { timers.push({ fn, delay }); return timers.length }
  view.clearTimeout = (id: number) => { if (timers[id - 1]) timers[id - 1] = { fn: () => {}, delay: 0 } }

  return {
    highlights,
    caret,
    /** Runs whatever the grace timer scheduled */
    flushTimers: () => { for (const t of timers.splice(0)) t.fn() },
    frames,
    /** One pointer move plus the frame it schedules */
    move: () => {
      doc.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 10, clientY: 10 }))
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
    expect(doc.documentElement.getAttribute('data-axt-hl')).toBe('on')
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
    expect(doc.documentElement.getAttribute('data-axt-hl')).toBe('on')
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

  it('holds through a miss, then fades out', () => {
    // Crossing the gap between two paragraphs is a miss the reader experiences as one continuous
    // movement; reacting to it instantly would blink.
    const { doc, source } = page(TWO)
    const browser = stubBrowser(doc)
    const hl = startSentenceHighlight(doc)!

    browser.caret.mockReturnValue({ offsetNode: source.firstChild!, offset: 3 })
    browser.move()
    browser.caret.mockReturnValue(null)
    browser.move()
    expect(doc.documentElement.getAttribute('data-axt-hl')).toBe('on')

    browser.flushTimers()
    expect(doc.documentElement.getAttribute('data-axt-hl')).toBeNull()
    expect(browser.highlights.size).toBe(0)
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
    expect(doc.documentElement.getAttribute('data-axt-hl')).toBeNull()

    // And after stopping, a pointer move is not listened for any more
    browser.move()
    expect(browser.highlights.size).toBe(0)

    browser.highlights.set('axt-sentence-source', { ranges: [] })
    doc.documentElement.setAttribute('data-axt-hl', 'on')
    clearSentenceHighlights(doc)
    expect(browser.highlights.size).toBe(0)
    expect(doc.documentElement.getAttribute('data-axt-hl')).toBeNull()
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
    expect(doc.documentElement.getAttribute('data-axt-hl')).toBeNull()
    hl.stop()
  })
})
