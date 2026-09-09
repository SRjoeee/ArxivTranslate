import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { MIRROR_CLASS, SPLIT_ATTR, SPLIT_CLASS, createPrep, renderImage, renderText, resetFitCache, rootsOf, splitFigures } from '@/core/renderer'
import { docOf, frag } from './helpers'

// Incremental preparation (issue #46): each pass touches only containers of changed blocks; mirroring runs once per session.
// Column width is read before any writes and only when stale. Tests observe effects available in happy-dom:
// split siblings, mirror nodes, and column-width read counts.

/**
 * Two captioned figures in separate sections, matching real paper structure. Each caption forms a block.
 * Its root is the figure parent (its section), so touching one figure leaves the other alone.
 */
const TWO_FIGURES = '<section class="ltx_section" id="s1"><figure id="f1" class="ltx_figure"><img class="ltx_graphics" src="a.png" alt="">'
  + '<figcaption class="ltx_caption" id="c1">Figure 1.</figcaption></figure></section>'
  + '<section class="ltx_section" id="s2"><figure id="f2" class="ltx_figure"><img class="ltx_graphics" src="b.png" alt="">'
  + '<figcaption class="ltx_caption" id="c2">Figure 2.</figcaption></figure></section>'

const EQUATION = '<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p>'
  + '<table class="ltx_equation ltx_eqn_table" id="E1"><tbody><tr><td class="ltx_eqn_cell">x=1</td></tr></tbody></table></div>'

function setup(html: string, opts: { side?: boolean; columnWidth?: (root: Element) => number } = {}) {
  const doc = docOf(html)
  const blocks = extract(doc)
  markBlocks(blocks)
  const columnWidth = opts.columnWidth ?? (() => 484)
  const prep = createPrep(doc, { isSide: () => opts.side ?? true, columnWidth })
  return { doc, blocks, prep, byId: (id: string) => blocks.find(b => b.el.id === id) as TextBlock }
}

const flush = () => vi.advanceTimersByTime(150)

describe('createPrep', () => {
  beforeEach(() => { vi.useFakeTimers(); resetFitCache() })
  afterEach(() => vi.useRealTimers())

  it('touch(B) prepares only the container holding B and leaves the untouched figure unchanged', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touch([byId('c1')])
    flush()
    expect(doc.getElementById('f1')!.nextElementSibling?.classList.contains(SPLIT_CLASS)).toBe(true)
    // The untouched figure deliberately stays stale; broadening the root to document would fail this changed-region-only assertion.
    expect(doc.getElementById('f2')!.nextElementSibling?.classList.contains(SPLIT_CLASS) ?? false).toBe(false)
  })

  it('touch roots sit above figure: captions have figure parents, but splitFigures scans descendants only', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    const roots = rootsOf([byId('c1').el])
    // The root is the figure parent, section here, rather than the figure itself.
    expect(roots).toEqual([doc.getElementById('s1')])
    prep.touch([byId('c1')])
    flush()
    expect(doc.getElementById('f1')!.nextElementSibling?.classList.contains(SPLIT_CLASS)).toBe(true)
  })

  it('touchAll splits both figures', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
  })

  it('mixing touch and touchAll in one cycle runs a full pass', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touch([byId('c1')])
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
  })

  it('mirroring runs once per session; a second full pass does not mirror newly inserted formulas', () => {
    const { doc, prep } = setup(EQUATION)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
    // Simulate a later unmirrored formula; real pages do not do this, which is why repeated full scans are unnecessary.
    const late = doc.getElementById('E1')!.cloneNode(true) as Element
    late.id = 'E2'
    doc.getElementById('E1')!.parentElement!.append(late)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('reset allows mirroring to run once again', () => {
    const { doc, prep } = setup(EQUATION)
    prep.touchAll()
    flush()
    const late = doc.getElementById('E1')!.cloneNode(true) as Element
    late.id = 'E2'
    doc.getElementById('E1')!.parentElement!.append(late)
    prep.reset()
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(2)
  })

  it('a pass before block marking does not count as mirroring; the next marked pass creates mirrors', () => {
    const doc = docOf(EQUATION)
    const blocks = extract(doc) // Deliberately omit markBlocks.
    const prep = createPrep(doc, { isSide: () => true, columnWidth: () => 484 })
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
    markBlocks(blocks)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('outside side mode, neither splits figures nor creates mirrors', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES + EQUATION, { side: false })
    renderText(byId('c1'), frag(doc, '图 1。'))
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(0)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('reads column width only when stale: two passes read once, and refreshColumn triggers another read', () => {
    const columnWidth = vi.fn(() => 484)
    const { prep, byId, doc } = setup(EQUATION, { columnWidth })
    renderText(byId('p1'), frag(doc, '文。'))
    prep.touch([byId('p1')])
    flush()
    prep.touch([byId('p1')])
    flush()
    expect(columnWidth).toHaveBeenCalledTimes(1)
    prep.refreshColumn()
    prep.touch([byId('p1')])
    flush()
    expect(columnWidth).toHaveBeenCalledTimes(2)
  })

  it('measures the translation root rather than html because measureColumn uses closest(article) to find grid tracks', () => {
    // Caught by e2e: html has no closest article or parent fallback, producing width 0 and preventing every table from shrinking.
    const columnWidth = vi.fn((_root: Element) => 484)
    const { prep, byId, doc } = setup(EQUATION, { columnWidth })
    renderText(byId('p1'), frag(doc, '文。'))
    prep.touch([byId('p1')])
    flush()
    expect(columnWidth).toHaveBeenCalledTimes(1)
    expect(columnWidth.mock.calls[0]![0]).toBe(doc.querySelector('article.ltx_document'))
  })

  it('font loading triggers a fresh column measurement and a full preparation pass', () => {
    const columnWidth = vi.fn(() => 484)
    const doc = docOf(TWO_FIGURES)
    const fonts = new EventTarget()
    Object.defineProperty(doc, 'fonts', { value: fonts, configurable: true })
    const blocks = extract(doc)
    markBlocks(blocks)
    const prep = createPrep(doc, { isSide: () => true, columnWidth })
    const c1 = blocks.find(b => b.el.id === 'c1') as TextBlock
    const c2 = blocks.find(b => b.el.id === 'c2') as TextBlock
    renderText(c1, frag(doc, '图 1。'))
    renderText(c2, frag(doc, '图 2。'))
    prep.touch([c1])
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
    fonts.dispatchEvent(new Event('loadingdone'))
    flush()
    // Full pass: the other figure splits too, and column width is reread once.
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
    expect(columnWidth).toHaveBeenCalledTimes(2)
  })

  it('cancel removes the queued pass', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    prep.touch([byId('c1')])
    prep.cancel()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(0)
  })
})

describe('createPrep × image overlays (DESIGN §15.2)', () => {
  beforeEach(() => { vi.useFakeTimers(); resetFitCache() })
  afterEach(() => vi.useRealTimers())

  const IMG_FIGURE = '<section class="ltx_section"><figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"><figcaption class="ltx_caption" id="c1">Figure 1.</figcaption></figure></section>'
  const overlayOn = (doc: Document) => {
    const el = doc.querySelector('img') as HTMLImageElement
    const target = { id: el.id, el }
    renderImage(target, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static charge', text: '静态电荷' }])
    return target
  }

  it('touching an image target in side mode splits its figure using the outermost figure parent as root', () => {
    const { doc, prep } = setup(IMG_FIGURE)
    const target = overlayOn(doc)
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS} img`)).not.toBeNull()
  })

  it('removing the only translated content (an overlay) from a side-mode figure discards its stale clone and labels (Codex #89)', () => {
    const NO_CAPTION = '<section class="ltx_section"><figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"></figure></section>'
    const { doc, prep } = setup(NO_CAPTION)
    const target = overlayOn(doc)
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).not.toBeNull()
    // A new run returns only identity translations: removes the overlay and calls onRendered → prep.touch.
    doc.querySelector('.axt-img')!.remove()
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
    expect(doc.querySelector(`[${SPLIT_ATTR}]`)).toBeNull()
  })

  it('discards stale clones outside side mode when overlays arrive after switching side → only', () => {
    const doc = docOf(IMG_FIGURE)
    const blocks = extract(doc)
    markBlocks(blocks)
    renderText(blocks.find(b => b.el.id === 'c1') as TextBlock, frag(doc, '图 1。'))
    splitFigures(doc) // Previously split in side mode
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).not.toBeNull()
    const prep = createPrep(doc, { isSide: () => false, columnWidth: () => 484 })
    const target = overlayOn(doc)
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
    expect(doc.querySelector(`[${SPLIT_ATTR}]`)).toBeNull()
  })
})

describe('rootsOf', () => {
  it('collects parent, ancestor-block parents, and outermost-figure parent, removing contained roots', () => {
    const doc = docOf('<div class="ltx_acknowledgements" id="outer">Thanks <h6 class="ltx_title" id="inner">Ack</h6></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const inner = blocks.find(b => b.el.id === 'inner')!
    const roots = rootsOf([inner.el])
    // inner has block parent outer, whose parent is the translation root; that root contains outer, so only the root remains.
    expect(roots).toHaveLength(1)
    expect(roots[0]!.classList.contains('ltx_document')).toBe(true)
  })

  it('two blocks in the same container produce one root', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="a">A.</p><p class="ltx_p" id="b">B.</p></div>')
    const blocks = extract(doc)
    expect(rootsOf(blocks.map(b => b.el))).toHaveLength(1)
  })
})
