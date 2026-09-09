import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { linesOf, runsOf, viewBoxOf } from '@/core/svg'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/svg')

function svgOf(name: string): Element {
  const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, name), 'utf8'), 'image/svg+xml')
  return doc.documentElement
}

const PLOT = '2609.03768-fig_closure.svg'
const LISTING = '2608.29808-bounter-case.svg'

const deg = (radians: number) => Math.round((radians * 180) / Math.PI)

describe('SVG glyph extraction (#121)', () => {
  it('recovers whole labels from a real figure, ticks kept apart from titles', () => {
    // The converter emits every glyph as a direct child of <svg> with no grouping, so a figure is
    // one flat list — `closure` and `dense` and the axis title and every tick, in document order.
    // Everything here has to come from geometry.
    const runs = runsOf(svgOf(PLOT))
    const texts = runs.map(r => r.text)

    expect(texts).toContain('wall time per epoch [ms]')
    expect(texts).toContain('closure')
    expect(texts).toContain('dense')
    // Numeric ticks are their own runs, not glued to the label beside them
    expect(texts).toContain('0')
    expect(texts.filter(t => t === 'wall time per epoch [ms]')).toHaveLength(1)
  })

  it('keeps the spaces the figure actually draws', () => {
    // Spaces are glyphs of their own, so document order is exact and no word segmentation is
    // needed for the common case (RESEARCH §6.11).
    const runs = runsOf(svgOf(PLOT))
    const label = runs.find(r => r.text.startsWith('wall time'))
    expect(label?.text).toBe('wall time per epoch [ms]')
    expect(label?.glyphs).toBe('wall time per epoch [ms]'.length)
  })

  it('reads rotated labels at their true angle and size', () => {
    // The size is hypot(a,b) and the angle atan2(b,a). Reading `a` as the size — the obvious wrong
    // move — gives a rotated glyph size 0 and no orientation at all.
    const runs = runsOf(svgOf(PLOT))
    const rotated = runs.filter(r => deg(r.angle) !== 0)
    expect(rotated.length).toBeGreaterThan(0)
    // The corpus has exactly two orientations, 0 and -90 (RESEARCH §6.11)
    expect([...new Set(runs.map(r => deg(r.angle)))].sort((a, b) => a - b)).toEqual([-90, 0])
    for (const r of rotated) expect([r.text, r.size > 0]).toEqual([r.text, true])
  })

  it('decodes entities in data-text', () => {
    // `&#x00d7;` in the attribute is a multiplication sign by the time the parser is done with it
    const runs = runsOf(svgOf(PLOT))
    expect(runs.some(r => r.text.includes('×'))).toBe(true)
  })

  it('splits a listing into its lines, not into one blob', () => {
    const runs = runsOf(svgOf(LISTING))
    const texts = runs.map(r => r.text)
    // A whole source line comes back as one run, string literal included
    expect(texts.some(t => t.includes('"Depth must be in the range 1-16"'))).toBe(true)
    expect(texts).toContain('1   iflog_counting == 8:')
    // Line numbers down the gutter stay separate from the code beside them
    expect(texts).toContain('10')
    expect(runs.length).toBeGreaterThan(30)
  })

  it('normalises to the viewBox, and every corner lands inside the figure', () => {
    for (const name of [PLOT, LISTING]) {
      const svg = svgOf(name)
      const box = viewBoxOf(svg)
      expect([name, box !== undefined]).toEqual([name, true])
      const lines = linesOf(svg)
      expect([name, lines.length > 0]).toEqual([name, true])
      const outside = lines.filter(l => l.quad.some(([x, y]) => x < -0.05 || x > 1.05 || y < -0.05 || y > 1.05))
      expect([name, outside.map(l => l.text)]).toEqual([name, []])
      expect([name, lines.every(l => l.conf === 1)]).toEqual([name, true])
    }
  })

  it('a rotated run gets a rotated box, not a wide horizontal strip', () => {
    // This is what keeps a vertical axis label from claiming a band across the plot. Its quad is
    // taller than it is wide once normalised back to the figure.
    const svg = svgOf(PLOT)
    const runs = runsOf(svg)
    const lines = linesOf(svg)
    const i = runs.findIndex(r => deg(r.angle) === -90 && r.text.length > 3)
    expect(i).toBeGreaterThanOrEqual(0)
    const quad = lines[i]!.quad
    const w = Math.max(...quad.map(([x]) => x)) - Math.min(...quad.map(([x]) => x))
    const h = Math.max(...quad.map(([, y]) => y)) - Math.min(...quad.map(([, y]) => y))
    expect([runs[i]!.text, h > w]).toEqual([runs[i]!.text, true])
  })

  it('normalises against the viewBox origin, not just its size', () => {
    // Both real fixtures start at 0 0, so the origin term is a no-op there and nothing would notice
    // it being dropped. A shifted viewBox is what pins it.
    const at = (x: number, y: number) => `<use data-text="A" transform="matrix(10,0,0,-10,${x},${y})"/>`
    const parse = (viewBox: string) =>
      new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${at(150, 250)}</svg>`, 'image/svg+xml').documentElement

    const origin = linesOf(parse('0 0 200 400'))[0]!.quad[0]!
    const shifted = linesOf(parse('100 200 200 400'))[0]!.quad[0]!
    expect(shifted[0]).toBeCloseTo(origin[0] - 100 / 200, 6)
    expect(shifted[1]).toBeCloseTo(origin[1] - 200 / 400, 6)
  })

  it('drops runs that are neither upright nor square to the axis', () => {
    // Their box is described downstream as an AABB plus an angle, which is only the label's own box
    // at multiples of 90°. Over the whole corpus 1.27% of glyphs sit at one of 38 other angles, the
    // commonest -30°; approximating those would put an overlay across the plot.
    const at = (a: number, b: number) => `<use data-text="A" transform="matrix(${a},${b},0,0,50,50)"/>`
    const parse = (markup: string) =>
      new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${markup}</svg>`, 'image/svg+xml').documentElement
    // 0°, -90°, +90° are placeable; -30° is not
    expect(linesOf(parse(at(10, 0)))).toHaveLength(1)
    expect(linesOf(parse(at(0, -10)))).toHaveLength(1)
    expect(linesOf(parse(at(0, 10)))).toHaveLength(1)
    expect(linesOf(parse(at(10 * Math.cos(-Math.PI / 6), 10 * Math.sin(-Math.PI / 6))))).toEqual([])
    // 180° is dropped as well: its box is right but the overlay's rotated geometry swaps the axes,
    // which a half turn does not (Codex on #134). It does not occur in the corpus either.
    expect(linesOf(parse(at(-10, 0)))).toEqual([])
    // runsOf still reports it — the angle is read correctly, it is the overlay that cannot place it
    expect(runsOf(parse(at(10 * Math.cos(-Math.PI / 6), 10 * Math.sin(-Math.PI / 6))))).toHaveLength(1)
  })

  it('reports nothing for a figure with no glyphs', () => {
    const doc = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0H10V10H0Z"/></svg>', 'image/svg+xml')
    expect(runsOf(doc.documentElement)).toEqual([])
    expect(linesOf(doc.documentElement)).toEqual([])
  })

  it('falls back to width and height when there is no viewBox, and gives up without either', () => {
    const parse = (markup: string) => new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement
    expect(viewBoxOf(parse('<svg xmlns="http://www.w3.org/2000/svg" width="200pt" height="100pt"/>'))).toEqual({ x: 0, y: 0, w: 200, h: 100 })
    expect(viewBoxOf(parse('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeUndefined()
    // A malformed viewBox is not silently treated as 0×0
    expect(viewBoxOf(parse('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 0" width="8" height="4"/>'))).toEqual({ x: 0, y: 0, w: 8, h: 4 })
  })
})
