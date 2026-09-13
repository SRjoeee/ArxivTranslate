import { beforeEach, describe, expect, it, vi } from 'vitest'
import { T_CLASS } from '@/core/marks'
import { FIT_ATTR, FIT_SCROLL, fitTables, resetFitCache, watchFontLoads } from '@/core/renderer/table-fit'
import { docOf } from './helpers'

/** A table pair: the source table + the translation clone (the shape renderTable produces) */
const pairDoc = (count = 1) => {
  const one = '<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table>'
    + `<table class="ltx_tabular ${T_CLASS}" data-axt-for="T"><tbody><tr><td class="ltx_td">甲</td></tr></tbody></table></figure>`
  return docOf(one.repeat(count))
}
const originals = (doc: Document) => Array.from(doc.querySelectorAll(`.ltx_tabular:not(.${T_CLASS})`))
const fitOf = (el: Element) => el.getAttribute(FIT_ATTR)

/** A display-formula pair: the source formula + the mirror (the shape createMirrors produces) */
const eqnDoc = () => docOf('<div class="ltx_para"><table class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell">x</td><td class="ltx_eqn_cell ltx_eqn_eqno">(1)</td></tr></tbody></table>'
  + `<table class="ltx_equation ltx_eqn_table ${T_CLASS} axt-mirror" data-axt-for="mirror:0"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell">x</td><td class="ltx_eqn_cell ltx_eqn_eqno">(1)</td></tr></tbody></table></div>`)

describe('fitTables', () => {
  beforeEach(() => resetFitCache())
  it('display formulas with their mirrors scale by column like tables: only the outermost table.ltx_eqn_table is marked, the tr.ltx_equation rows of a group are not counted on their own', () => {
    const doc = eqnDoc()
    const r = fitTables(doc, { naturalWidth: () => 800, columnWidth: () => 436 })
    expect(r).toEqual({ fitted: 0, scrolled: 1 }) // 436/800 = 0.545 < 0.7 → scroll
    const [original, mirror] = Array.from(doc.querySelectorAll('table'))
    expect(fitOf(original!)).toBe(FIT_SCROLL)
    expect(fitOf(mirror!)).toBe(FIT_SCROLL)
    expect(doc.querySelector(`tr[${FIT_ATTR}]`)).toBeNull()
    // The window widens: re-measured only once the column width changed (same width and same translation node hit the cache, see the group below)
    const again = fitTables(doc, { naturalWidth: () => 500, columnWidth: () => 425 })
    expect(again).toEqual({ fitted: 1, scrolled: 0 })
    expect(fitOf(original!)).toBe('85') // 425/500 = 0.85
  })

  it('fitting, no ratio is marked', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { naturalWidth: () => 400, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('not fitting, it drops to the step that fits, the source and the translation marked alike', () => {
    const doc = pairDoc()
    // Needs 484/551 = 0.878 → the 85 step
    const r = fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    const original = originals(doc)[0]!
    expect(fitOf(original)).toBe('85')
    expect(fitOf(original.nextElementSibling!)).toBe('85')
  })

  it('steps round down: exactly on a step uses that step', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 1000, columnWidth: () => 950 })
    expect(fitOf(originals(doc)[0]!)).toBe('95')
  })

  it('still not fitting at 0.7, it degrades to scrolling inside the column', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { naturalWidth: () => 1200, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 1 })
    expect(fitOf(originals(doc)[0]!)).toBe(FIT_SCROLL)
  })

  it('a table without a translation is left alone', () => {
    const doc = docOf('<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table></figure>')
    const r = fitTables(doc, { naturalWidth: () => 900, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('with no layout information nothing happens (happy-dom, display:none)', () => {
    const doc = pairDoc()
    expect(fitTables(doc, { naturalWidth: () => 0, columnWidth: () => 0 })).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('a repeated call recomputes by the new width, and the mark is cleared once the window widens', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 700 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('several tables are computed each on their own', () => {
    const doc = pairDoc(2)
    // Both tables of a pair are measured (the step set by the wider), so widths are given per element, not by call order
    const widths = new Map(Array.from(doc.querySelectorAll('.ltx_tabular')).map((el, i) => [el, i < 2 ? 551 : 1200]))
    const r = fitTables(doc, { naturalWidth: el => widths.get(el) ?? 0, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 1 })
    expect(originals(doc).map(fitOf)).toEqual(['85', FIT_SCROLL])
  })

  it('a translated table wider than the source sets the step by the translation, both on the same step (measured on 2606.07636v2\'s Table 4: the source fits, the translation overflows by 179px)', () => {
    const doc = pairDoc()
    const [orig, clone] = Array.from(doc.querySelectorAll('.ltx_tabular'))
    const widths = new Map([[orig!, 600], [clone!, 800]])
    const r = fitTables(doc, { naturalWidth: el => widths.get(el) ?? 0, columnWidth: () => 648 })
    // Looking at the source alone, 600 ≤ 648 needs no shrink; by the translation 648/800 = 0.81 → the 80 step
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    expect(fitOf(orig!)).toBe('80')
    expect(fitOf(clone!)).toBe('80')
  })
})

describe('the loosening rules of read-only measurement', () => {
  beforeEach(() => resetFitCache())
  const column = 468
  const marked = (fit: string | null) => {
    const doc = eqnDoc()
    if (fit) for (const t of Array.from(doc.querySelectorAll('table'))) t.setAttribute(FIT_ATTR, fit)
    return doc
  }
  const original = (doc: Document) => doc.querySelector('table')!

  it('an exact value (the box width while overflowing) may tighten', () => {
    const doc = marked('90')
    fitTables(doc, { naturalWidth: () => 560, columnWidth: () => column }) // 468/560 = 0.836 → 80
    expect(fitOf(original(doc))).toBe('80')
  })

  it('an estimate never tightens: it measures the “fits” state', () => {
    const doc = marked('90')
    fitTables(doc, { naturalWidth: () => ({ width: 560, exact: false }), columnWidth: () => column })
    expect(fitOf(original(doc))).toBe('90')
  })

  it('loosening from an estimate keeps a 5% margin, or it flips back and forth between two steps', () => {
    // 460 × 1.05 = 483 > 468: the mark cannot go
    const stay = marked('95')
    fitTables(stay, { naturalWidth: () => ({ width: 460, exact: false }), columnWidth: () => column })
    expect(fitOf(original(stay))).toBe('95')
    // 440 × 1.05 = 462 ≤ 468: it can go
    const loosen = marked('95')
    fitTables(loosen, { naturalWidth: () => ({ width: 440, exact: false }), columnWidth: () => column })
    expect(fitOf(original(loosen))).toBeNull()
    // Loosening from 80: with the margin 500 × 1.05 = 525 → 468/525 = 0.891 → 85, not the 90 without the margin
    const step = marked('80')
    fitTables(step, { naturalWidth: () => ({ width: 500, exact: false }), columnWidth: () => column })
    expect(fitOf(original(step))).toBe('85')
  })

  it('no more cloning to measure: the module has no probe, and measuring a width inserts no node into the document', async () => {
    const mod = await import('@/core/renderer/table-fit')
    expect('createFitProbe' in mod).toBe(false)
    const doc = eqnDoc()
    const before = doc.body.childElementCount
    fitTables(doc, { naturalWidth: () => 800, columnWidth: () => column })
    expect(doc.body.childElementCount).toBe(before)
  })
})

describe('batched reads and writes, and the cache (issue #46)', () => {
  beforeEach(() => resetFitCache())

  it('same column width, same translation node: the second pass does not measure again and uses the previous step', () => {
    const doc = pairDoc()
    const natural = vi.fn(() => 551)
    // A pair is measured twice (source + translation, the step set by the wider)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(2)
    const r = fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(2)
    // The result and the count are as before
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
  })

  it('a changed column width measures again', () => {
    const doc = pairDoc()
    const natural = vi.fn(() => 551)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 700 })
    expect(natural).toHaveBeenCalledTimes(4) // two passes × two tables each
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('a changed translation node (re-rendered / retried) measures again: the node\'s identity is the content version', () => {
    const doc = pairDoc()
    const natural = vi.fn(() => 551)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    const original = originals(doc)[0]!
    const fresh = original.nextElementSibling!.cloneNode(true) as Element
    original.nextElementSibling!.replaceWith(fresh)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(4) // two passes × two tables each
    expect(fitOf(fresh)).toBe('85')
  })

  it('a measurement of 0 (not laid out yet) is not cached and is measured again next pass', () => {
    const doc = pairDoc()
    const widths = [0, 0, 551, 551]
    const natural = vi.fn(() => widths.shift()!)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(4) // two passes × two tables each
    expect(fitOf(originals(doc)[0]!)).toBe('85')
  })

  it('an unchanged value writes no attribute: the second pass makes not one setAttribute call', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    const original = originals(doc)[0]!
    const set = vi.spyOn(original, 'setAttribute')
    const setT = vi.spyOn(original.nextElementSibling!, 'setAttribute')
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(set).not.toHaveBeenCalled()
    expect(setT).not.toHaveBeenCalled()
  })

  it('an unpaired table: no pointless removeAttribute when there was no mark to begin with', () => {
    const doc = docOf('<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table></figure>')
    const remove = vi.spyOn(originals(doc)[0]!, 'removeAttribute')
    fitTables(doc, { naturalWidth: () => 900, columnWidth: () => 484 })
    expect(remove).not.toHaveBeenCalled()
  })

  it('batched reads and writes: while the second table is measured, the first\'s mark is not written yet', () => {
    // Interleaved, the first writes its zoom and the second reads its geometry right after, each a forced synchronous layout
    const doc = pairDoc(2)
    const [t1] = originals(doc)
    const seen: Array<string | null> = []
    const natural = vi.fn((table: Element) => {
      if (table !== t1) seen.push(t1!.getAttribute(FIT_ATTR))
      return 551
    })
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    // Both should land on the 85 step — but while any table other than the first is measured, the first is still clean (a pair measures two, two pairs three times in all)
    expect(originals(doc).map(fitOf)).toEqual(['85', '85'])
    expect(seen).toEqual([null, null, null])
  })
})

describe('fonts finishing loading must invalidate the cache (Codex on #84)', () => {
  beforeEach(() => resetFitCache())

  /** happy-dom has no FontFaceSet: build one with events only */
  const withFonts = (doc: Document) => {
    const fonts = new EventTarget()
    Object.defineProperty(doc, 'fonts', { value: fonts, configurable: true })
    return fonts
  }

  it('tidying after loadingdone measures again, the step following the new natural width', () => {
    const doc = pairDoc()
    const fonts = withFonts(doc)
    const scheduled = vi.fn()
    const off = watchFontLoads(doc, scheduled)
    // One pass measures two (source + translation): one width each before and after the fonts arrive
    let width = 551
    const natural = vi.fn(() => width)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
    // The fonts arrived: the natural width became 700, but neither the translation node nor the column width changed — without clearing the cache it stays at 85 for good
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(scheduled).toHaveBeenCalledTimes(1)
    width = 700
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(4) // two passes × two tables each
    expect(fitOf(originals(doc)[0]!)).toBe(FIT_SCROLL) // 484/700 = 0.69 < 0.7
    off()
  })

  it('after unmounting it no longer responds', () => {
    const doc = pairDoc()
    const fonts = withFonts(doc)
    const scheduled = vi.fn()
    watchFontLoads(doc, scheduled)()
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(scheduled).not.toHaveBeenCalled()
  })

  it('an environment without FontFaceSet does nothing', () => {
    const doc = pairDoc()
    expect(() => watchFontLoads(doc, () => {})()).not.toThrow()
  })
})

