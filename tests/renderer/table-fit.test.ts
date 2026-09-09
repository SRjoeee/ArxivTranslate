import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FIT_ATTR, FIT_SCROLL, T_CLASS, fitTables, resetFitCache, watchFontLoads } from '@/core/renderer'
import { docOf } from './helpers'

/** Table pair: original and translated clone, matching renderTable output */
const pairDoc = (count = 1) => {
  const one = '<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table>'
    + `<table class="ltx_tabular ${T_CLASS}" data-axt-for="T"><tbody><tr><td class="ltx_td">甲</td></tr></tbody></table></figure>`
  return docOf(one.repeat(count))
}
const originals = (doc: Document) => Array.from(doc.querySelectorAll(`.ltx_tabular:not(.${T_CLASS})`))
const fitOf = (el: Element) => el.getAttribute(FIT_ATTR)

/** Display-equation pair: original and mirror, matching createMirrors output */
const eqnDoc = () => docOf('<div class="ltx_para"><table class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell">x</td><td class="ltx_eqn_cell ltx_eqn_eqno">(1)</td></tr></tbody></table>'
  + `<table class="ltx_equation ltx_eqn_table ${T_CLASS} axt-mirror" data-axt-for="mirror:0"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell">x</td><td class="ltx_eqn_cell ltx_eqn_eqno">(1)</td></tr></tbody></table></div>`)

describe('fitTables', () => {
  beforeEach(() => resetFitCache())
  it('fits display equations and mirrors like tables, marking only outer table.ltx_eqn_table rather than each grouped equation row', () => {
    const doc = eqnDoc()
    const r = fitTables(doc, { naturalWidth: () => 800, columnWidth: () => 436 })
    expect(r).toEqual({ fitted: 0, scrolled: 1 }) // 436/800 = 0.545 < 0.7 → scrolling
    const [original, mirror] = Array.from(doc.querySelectorAll('table'))
    expect(fitOf(original!)).toBe(FIT_SCROLL)
    expect(fitOf(mirror!)).toBe(FIT_SCROLL)
    expect(doc.querySelector(`tr[${FIT_ATTR}]`)).toBeNull()
    // Widening remeasures only after column width changes; unchanged width and translation nodes hit the cache below.
    const again = fitTables(doc, { naturalWidth: () => 500, columnWidth: () => 425 })
    expect(again).toEqual({ fitted: 1, scrolled: 0 })
    expect(fitOf(original!)).toBe('85') // 425/500 = 0.85
  })

  it('tables that fit receive no scale marker', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { naturalWidth: () => 400, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('oversized tables use the fitting scale step on both original and translation', () => {
    const doc = pairDoc()
    // Required 484/551 = 0.878 → 85 step
    const r = fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    const original = originals(doc)[0]!
    expect(fitOf(original)).toBe('85')
    expect(fitOf(original.nextElementSibling!)).toBe('85')
  })

  it('rounds scale steps downward and keeps exact matches', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 1000, columnWidth: () => 950 })
    expect(fitOf(originals(doc)[0]!)).toBe('95')
  })

  it('falls back to in-column scrolling when scale 0.7 still cannot fit', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { naturalWidth: () => 1200, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 1 })
    expect(fitOf(originals(doc)[0]!)).toBe(FIT_SCROLL)
  })

  it('ignores tables without translations', () => {
    const doc = docOf('<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table></figure>')
    const r = fitTables(doc, { naturalWidth: () => 900, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('does nothing without layout information, as in happy-dom or display:none', () => {
    const doc = pairDoc()
    expect(fitTables(doc, { naturalWidth: () => 0, columnWidth: () => 0 })).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('recomputes for new widths and clears markers when the viewport widens', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 700 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('computes each table independently', () => {
    const doc = pairDoc(2)
    // Both tables in each pair are measured and the wider one determines scale, so assign widths by element, not call order.
    const widths = new Map(Array.from(doc.querySelectorAll('.ltx_tabular')).map((el, i) => [el, i < 2 ? 551 : 1200]))
    const r = fitTables(doc, { naturalWidth: el => widths.get(el) ?? 0, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 1 })
    expect(originals(doc).map(fitOf)).toEqual(['85', FIT_SCROLL])
  })

  it('when the translated table is wider, both use its scale (2606.07636v2 Table 4: original fit, translation overflowed 179px)', () => {
    const doc = pairDoc()
    const [orig, clone] = Array.from(doc.querySelectorAll('.ltx_tabular'))
    const widths = new Map([[orig!, 600], [clone!, 800]])
    const r = fitTables(doc, { naturalWidth: el => widths.get(el) ?? 0, columnWidth: () => 648 })
    // The original alone needs no scaling at 600 ≤ 648; the translation requires 648/800 = 0.81 → 80 step.
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    expect(fitOf(orig!)).toBe('80')
    expect(fitOf(clone!)).toBe('80')
  })
})

describe('tightening and relaxing with read-only measurements', () => {
  beforeEach(() => resetFitCache())
  const column = 468
  const marked = (fit: string | null) => {
    const doc = eqnDoc()
    if (fit) for (const t of Array.from(doc.querySelectorAll('table'))) t.setAttribute(FIT_ATTR, fit)
    return doc
  }
  const original = (doc: Document) => doc.querySelector('table')!

  it('exact overflowing box widths may tighten scale', () => {
    const doc = marked('90')
    fitTables(doc, { naturalWidth: () => 560, columnWidth: () => column }) // 468/560 = 0.836 → 80
    expect(fitOf(original(doc))).toBe('80')
  })

  it('estimated widths never tighten because they measure an already-fitting state', () => {
    const doc = marked('90')
    fitTables(doc, { naturalWidth: () => ({ width: 560, exact: false }), columnWidth: () => column })
    expect(fitOf(original(doc))).toBe('90')
  })

  it('relaxing estimated scale requires 5% headroom to avoid oscillating between steps', () => {
    // 460 × 1.05 = 483 > 468: keep the marker.
    const stay = marked('95')
    fitTables(stay, { naturalWidth: () => ({ width: 460, exact: false }), columnWidth: () => column })
    expect(fitOf(original(stay))).toBe('95')
    // 440 × 1.05 = 462 ≤ 468: remove the marker.
    const loosen = marked('95')
    fitTables(loosen, { naturalWidth: () => ({ width: 440, exact: false }), columnWidth: () => column })
    expect(fitOf(original(loosen))).toBeNull()
    // Relax from 80 with headroom: 500 × 1.05 = 525, then 468/525 = 0.891 → 85 instead of 90 without headroom.
    const step = marked('80')
    fitTables(step, { naturalWidth: () => ({ width: 500, exact: false }), columnWidth: () => column })
    expect(fitOf(original(step))).toBe('85')
  })

  it('measures without clones or probes and inserts no measurement nodes into the document', async () => {
    const mod = await import('@/core/renderer/table-fit')
    expect('createFitProbe' in mod).toBe(false)
    const doc = eqnDoc()
    const before = doc.body.childElementCount
    fitTables(doc, { naturalWidth: () => 800, columnWidth: () => column })
    expect(doc.body.childElementCount).toBe(before)
  })
})

describe('batched reads and writes with caching (issue #46)', () => {
  beforeEach(() => resetFitCache())

  it('same column width and translation node reuse the prior scale without another measurement', () => {
    const doc = pairDoc()
    const natural = vi.fn(() => 551)
    // Measure twice per table pair, taking the wider original or translation.
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(2)
    const r = fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(2)
    // Results and counts remain unchanged.
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
  })

  it('changed column width triggers remeasurement', () => {
    const doc = pairDoc()
    const natural = vi.fn(() => 551)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 700 })
    expect(natural).toHaveBeenCalledTimes(4) // Two passes × two tables
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('replacing the translation node after rendering or retry triggers remeasurement because node identity represents content version', () => {
    const doc = pairDoc()
    const natural = vi.fn(() => 551)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    const original = originals(doc)[0]!
    const fresh = original.nextElementSibling!.cloneNode(true) as Element
    original.nextElementSibling!.replaceWith(fresh)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(4) // Two passes × two tables
    expect(fitOf(fresh)).toBe('85')
  })

  it('zero widths before layout are not cached and are measured again next pass', () => {
    const doc = pairDoc()
    const widths = [0, 0, 551, 551]
    const natural = vi.fn(() => widths.shift()!)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(4) // Two passes × two tables
    expect(fitOf(originals(doc)[0]!)).toBe('85')
  })

  it('unchanged values cause no attribute writes on the second pass', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    const original = originals(doc)[0]!
    const set = vi.spyOn(original, 'setAttribute')
    const setT = vi.spyOn(original.nextElementSibling!, 'setAttribute')
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(set).not.toHaveBeenCalled()
    expect(setT).not.toHaveBeenCalled()
  })

  it('unpaired tables without markers avoid unnecessary removeAttribute calls', () => {
    const doc = docOf('<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table></figure>')
    const remove = vi.spyOn(originals(doc)[0]!, 'removeAttribute')
    fitTables(doc, { naturalWidth: () => 900, columnWidth: () => 484 })
    expect(remove).not.toHaveBeenCalled()
  })

  it('batches reads before writes: the first table is still unmarked while measuring the second', () => {
    // Interleaving zoom writes with geometry reads would force a synchronous layout for every table.
    const doc = pairDoc(2)
    const [t1] = originals(doc)
    const seen: Array<string | null> = []
    const natural = vi.fn((table: Element) => {
      if (table !== t1) seen.push(t1!.getAttribute(FIT_ATTR))
      return 551
    })
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    // Both pairs need scale 85, but the first remains clean during all three subsequent measurements across the two pairs.
    expect(originals(doc).map(fitOf)).toEqual(['85', '85'])
    expect(seen).toEqual([null, null, null])
  })
})

describe('font loading invalidates the cache (Codex #84)', () => {
  beforeEach(() => resetFitCache())

  /** happy-dom has no FontFaceSet; provide an event-only test double */
  const withFonts = (doc: Document) => {
    const fonts = new EventTarget()
    Object.defineProperty(doc, 'fonts', { value: fonts, configurable: true })
    return fonts
  }

  it('preparation after loadingdone remeasures and selects scale from the new natural width', () => {
    const doc = pairDoc()
    const fonts = withFonts(doc)
    const scheduled = vi.fn()
    const off = watchFontLoads(doc, scheduled)
    // Each pass measures original and translation; provide one width before and another after font loading.
    let width = 551
    const natural = vi.fn(() => width)
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
    // The font changes natural width to 700 without changing node identity or column width; stale cache would stay at 85 forever.
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(scheduled).toHaveBeenCalledTimes(1)
    width = 700
    fitTables(doc, { naturalWidth: natural, columnWidth: () => 484 })
    expect(natural).toHaveBeenCalledTimes(4) // Two passes × two tables
    expect(fitOf(originals(doc)[0]!)).toBe(FIT_SCROLL) // 484/700 = 0.69 < 0.7
    off()
  })

  it('uninstall stops responding', () => {
    const doc = pairDoc()
    const fonts = withFonts(doc)
    const scheduled = vi.fn()
    watchFontLoads(doc, scheduled)()
    fonts.dispatchEvent(new Event('loadingdone'))
    expect(scheduled).not.toHaveBeenCalled()
  })

  it('does nothing without FontFaceSet', () => {
    const doc = pairDoc()
    expect(() => watchFontLoads(doc, () => {})()).not.toThrow()
  })
})

