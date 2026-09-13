// Margin notes stack down the gutter one after another (DESIGN §7.2). The style sheet zeroes the note box's height (or it would stretch the grid row),
// at the cost of floats no longer avoiding each other; the positions are therefore measured by JS and pushed apart with transform.
import { describe, expect, it } from 'vitest'
import { applyMarginNotes, clearMarginNotes, planMarginNotes, stackShifts } from '@/core/renderer/margin-notes'
import { docOf } from './helpers'

const box = (top: number, height: number, ours = true) => ({ top, height, ours })

describe('stackShifts', () => {
  it('notes that do not touch stay put', () => {
    expect(stackShifts([box(0, 40), box(100, 40)], 8)).toEqual([0, 0])
  })

  it('one pressing on the previous is pushed down below it plus one gap', () => {
    // The first takes 0–40, gap 8: the second falls at 20 by nature and is pushed to 48
    expect(stackShifts([box(0, 40), box(20, 30)], 8)).toEqual([0, 28])
  })

  it('the push propagates: once one is pushed down, the ones after clear the pushed position', () => {
    expect(stackShifts([box(0, 100), box(10, 100), box(20, 10)], 0)).toEqual([0, 90, 180])
  })

  it('the original copy cannot be pushed (§7.1 allows no style on original nodes), but the ones after go around it', () => {
    const shifts = stackShifts([box(0, 50, false), box(10, 20, true)], 0)
    expect(shifts).toEqual([0, 40])
  })

  // Codex on #163, two rounds: first the bottom line was pulled back by an immovable original, then “only dodge the ones before” fell short —
  // a long copy would cover the original of the block **after** it, and since the original may not move, only the copy can keep giving way
  it('an immovable original is an obstacle regardless of order, and the copies give way all along', () => {
    const boxes = [box(0, 100), box(10, 20, false), box(20, 30)]
    const shifts = stackShifts(boxes, 0)
    const spans = shifts.map((v, i) => [boxes[i]!.top + v, boxes[i]!.top + v + boxes[i]!.height])
    // Copy one takes 0–100 by nature and covers the original after it (10–30): it gives way to below the original, 30–130
    // The original stays (10–30); copy two follows copy one, 130–160. No two of the three overlap
    expect(spans).toEqual([[30, 130], [10, 30], [130, 160]])
    for (let i = 1; i < spans.length; i++) {
      for (let j = 0; j < i; j++) {
        expect([i, j, spans[i]![0]! >= spans[j]![1]! || spans[j]![0]! >= spans[i]![1]!]).toEqual([i, j, true])
      }
    }
  })

  it('the bottom line only moves down: an original lying above does not pull it back', () => {
    // Copy one takes 100–300; the original is **above** it (40–60, no contact, copy one need not give way); copy two falls at 120 by nature.
    // Pulled back to 60 by the original, the bottom line would leave copy two in place, right on top of copy one
    const shifts = stackShifts([box(100, 200), box(40, 20, false), box(120, 30)], 0)
    expect(shifts).toEqual([0, 0, 180])
  })

  it('six short footnotes on the same line stack into one column (the shape of 2509.10652v3)', () => {
    const boxes = Array.from({ length: 6 }, (_, i) => box(i * 32, 50))
    const shifts = stackShifts(boxes, 8)
    const tops = shifts.map((s, i) => boxes[i]!.top + s)
    for (let i = 1; i < tops.length; i++) expect(tops[i]! - tops[i - 1]!).toBe(58)
  })
})

/** A document with two margin notes, the second pressing on the first. heights / tops can be changed in place to imitate a translation arriving or being withdrawn */
function stubbed(heights: [number, number], tops: [number, number]) {
  const doc = docOf(`
    <p class="ltx_p" data-axt-id="p1">body</p>
    <p class="ltx_p axt-t" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
      ><span class="ltx_note_outer" id="o1"><span class="ltx_note_content">Note one.</span></span></span>
      <span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">2</sup
      ><span class="ltx_note_outer" id="o2"><span class="ltx_note_content">Note two.</span></span></span></p>`)
  const contents = Array.from(doc.querySelectorAll('.ltx_note_content')) as HTMLElement[]
  contents.forEach((content, i) => {
    content.getBoundingClientRect = () => {
      const outer = content.closest('.ltx_note_outer') as HTMLElement
      // A displacement already written shows in the measured position, as in a real browser
      const shift = /translateY\((-?\d+)px\)/.exec(outer.style.transform)?.[1]
      const top = tops[i]! + (shift ? Number(shift) : 0)
      const height = heights[i]!
      return { top, bottom: top + height, height, width: 192, left: 0, right: 192, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    }
  })
  return doc
}

describe('planMarginNotes / applyMarginNotes', () => {
  it('two pressed together: the second is pushed below the first, and not one node of the original moves', () => {
    const doc = stubbed([100, 60], [0, 20])
    const before = doc.querySelector('.ltx_p:not(.axt-t)')!.outerHTML
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(doc.querySelector('#o1')!.getAttribute('style')).toBeNull()
    // 100 high + a 2rem gap (happy-dom's root font size is 16px) → the second is pushed from 20 to 132
    expect((doc.querySelector('#o2') as HTMLElement).style.transform).toBe('translateY(112px)')
    expect(doc.querySelector('.ltx_p:not(.axt-t)')!.outerHTML).toBe(before)
  })

  it('idempotent: with the positions unchanged the second pass writes nothing', () => {
    const doc = stubbed([100, 60], [0, 20])
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(0)
  })

  it('when the first shrinks the displacement is taken back, never owing the previous round', () => {
    const heights: [number, number] = [100, 60]
    const doc = stubbed(heights, [0, 200])
    applyMarginNotes(planMarginNotes(doc))
    const second = doc.querySelector('#o2') as HTMLElement
    // 100 high + 32 gap = 132 < 200: no need to give way at first
    expect(second.style.transform).toBe('')
    // The first's translation arrived and it grew to 300 high: the second has to move to 332
    heights[0] = 300
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(second.style.transform).toBe('translateY(132px)')
    // The retranslation failed, the translation was withdrawn, and the first is short again: the displacement follows
    heights[0] = 100
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(second.style.transform).toBe('')
  })

  it('when no box can be measured (a collapsed note, an environment without layout) nothing is written', () => {
    const doc = docOf(`
      <p class="ltx_p axt-t" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
        ><span class="ltx_note_outer" id="o1"><span class="ltx_note_content">Note.</span></span></span></p>`)
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(0)
    expect(doc.querySelector('#o1')!.getAttribute('style')).toBeNull()
  })

  it('clearMarginNotes wipes the displacements it wrote', () => {
    const doc = stubbed([100, 60], [0, 20])
    applyMarginNotes(planMarginNotes(doc))
    clearMarginNotes(doc)
    expect((doc.querySelector('#o2') as HTMLElement).style.transform).toBe('')
  })
})
