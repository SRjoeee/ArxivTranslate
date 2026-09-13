import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { MIRROR_CLASS, SPLIT_ATTR, SPLIT_CLASS } from '@/core/renderer/attrs'
import { renderImage } from '@/core/renderer/image'
import { createPrep, rootsOf } from '@/core/renderer/prep'
import { splitFigures } from '@/core/renderer/split-figures'
import { resetFitCache } from '@/core/renderer/table-fit'
import { renderText } from '@/core/renderer/translation'
import { docOf, frag } from './helpers'

// Incremental tidying (issue #46): each pass touches only the containers of the blocks whose DOM just changed, the mirror runs once per session,
// and the column width is read before anything is written, and only when stale. The cases here use effects observable in happy-dom:
// the split (an .axt-split sibling), the mirror (.axt-mirror), the number of column-width reads

/**
 * Two captioned figures, each in its own section (the shape of a real paper). The caption is a block;
 * its root is the figure's parent — each its own section — so touching one does not spill onto the other
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

  it('touch(B) tidies only B\'s container: the untouched figure stays as it was', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touch([byId('c1')])
    flush()
    expect(doc.getElementById('f1')!.nextElementSibling?.classList.contains(SPLIT_CLASS)).toBe(true)
    // The untouched one **stays stale** — that is what “touch only the changed area” means; widen the scope to document and this case fails
    expect(doc.getElementById('f2')!.nextElementSibling?.classList.contains(SPLIT_CLASS) ?? false).toBe(false)
  })

  it('the touch root is one level above the figure: the caption block\'s parent is the figure, and splitFigures scans descendants only', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    const roots = rootsOf([byId('c1').el])
    // The root is not the figure itself but its parent (the section here)
    expect(roots).toEqual([doc.getElementById('s1')])
    prep.touch([byId('c1')])
    flush()
    expect(doc.getElementById('f1')!.nextElementSibling?.classList.contains(SPLIT_CLASS)).toBe(true)
  })

  it('touchAll splits both', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
  })

  it('touch and touchAll mixed in one round run as a full pass', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touch([byId('c1')])
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
  })

  it('the mirror runs once per session: the second full pass builds no mirror for a formula inserted later', () => {
    const { doc, prep } = setup(EQUATION)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
    // Imitates “an unmirrored formula appearing later” — it does not happen on a real page, which is exactly why every pass need not rescan
    const late = doc.getElementById('E1')!.cloneNode(true) as Element
    late.id = 'E2'
    doc.getElementById('E1')!.parentElement!.append(late)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('after reset() the mirror may run once more', () => {
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

  it('before the block marks are written the mirror does not count as run: that pass mirrors nothing, the next one after the marks does', () => {
    const doc = docOf(EQUATION)
    const blocks = extract(doc) // deliberately no markBlocks
    const prep = createPrep(doc, { isSide: () => true, columnWidth: () => 484 })
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
    markBlocks(blocks)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('not in side mode: no split, no mirror', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES + EQUATION, { side: false })
    renderText(byId('c1'), frag(doc, '图 1。'))
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(0)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('the column width is read only when stale: two passes in a row read once, once more after refreshColumn', () => {
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

  it('the column width is measured from the translation root, not from <html>: measureColumn finds the grid track by closest(article)', () => {
    // Caught by e2e: passed <html>, closest finds nothing, the fallback's parentElement is null → column width 0 → not one table shrinks
    const columnWidth = vi.fn((_root: Element) => 484)
    const { prep, byId, doc } = setup(EQUATION, { columnWidth })
    renderText(byId('p1'), frag(doc, '文。'))
    prep.touch([byId('p1')])
    flush()
    expect(columnWidth).toHaveBeenCalledTimes(1)
    expect(columnWidth.mock.calls[0]![0]).toBe(doc.querySelector('article.ltx_document'))
  })

  it('fonts loaded: the column width is re-read and a full tidy pass runs', () => {
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
    // Full: the other one is split too; the column width was re-read once
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
    expect(columnWidth).toHaveBeenCalledTimes(2)
  })

  it('cancel withdraws the queued pass', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    prep.touch([byId('c1')])
    prep.cancel()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(0)
  })
})

describe('createPrep × the image overlay (DESIGN §15.2)', () => {
  beforeEach(() => { vi.useFakeTimers(); resetFitCache() })
  afterEach(() => vi.useRealTimers())

  const IMG_FIGURE = '<section class="ltx_section"><figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"><figcaption class="ltx_caption" id="c1">Figure 1.</figcaption></figure></section>'
  const overlayOn = (doc: Document) => {
    const el = doc.querySelector('img') as HTMLImageElement
    const target = { id: el.id, el, kind: 'raster' as const }
    renderImage(target, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static charge', text: '静态电荷' }])
    return target
  }

  it('touch([image target]) under side splits the figure it is in: the root goes through the outermost figure\'s parent', () => {
    const { doc, prep } = setup(IMG_FIGURE)
    const target = overlayOn(doc)
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS} img`)).not.toBeNull()
  })

  it('under side the figure\'s only translation (the overlay) is removed: the old copy has to go, not keep wearing the old labels (Codex on #89)', () => {
    const NO_CAPTION = '<section class="ltx_section"><figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"></figure></section>'
    const { doc, prep } = setup(NO_CAPTION)
    const target = overlayOn(doc)
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).not.toBeNull()
    // The new round is all identity translations: the overlay is removed, and run goes through onRendered → prep.touch
    doc.querySelector('.axt-img')!.remove()
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
    expect(doc.querySelector(`[${SPLIT_ATTR}]`)).toBeNull()
  })

  it('outside side a copy with a stale signature is dropped: the case of the overlay arriving only after side → only', () => {
    const doc = docOf(IMG_FIGURE)
    const blocks = extract(doc)
    markBlocks(blocks)
    renderText(blocks.find(b => b.el.id === 'c1') as TextBlock, frag(doc, '图 1。'))
    splitFigures(doc) // once split under side
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
  it('the parent, the parents of the enclosing blocks, the outermost figure\'s parent; contained roots removed', () => {
    const doc = docOf('<div class="ltx_acknowledgements" id="outer">Thanks <h6 class="ltx_title" id="inner">Ack</h6></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const inner = blocks.find(b => b.el.id === 'inner')!
    const roots = rootsOf([inner.el])
    // inner's parent is outer (a block), outer's parent is the translation root; the root contains outer, so only the root remains
    expect(roots).toHaveLength(1)
    expect(roots[0]!.classList.contains('ltx_document')).toBe(true)
  })

  it('two blocks in one container count as one root', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="a">A.</p><p class="ltx_p" id="b">B.</p></div>')
    const blocks = extract(doc)
    expect(rootsOf(blocks.map(b => b.el))).toHaveLength(1)
  })
})
