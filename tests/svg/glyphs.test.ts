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

  it('keeps a run at any angle, with its own length and thickness', () => {
    // v1 drew 0 and ±90° only and dropped every other angle whole — 1.16% of the corpus's glyphs spread over 42 angles,
    // and `reheating` (6°) and `radiation domination` (5°) of 2609.10326v1 are two of them (the owner's report of 2026-09-11).
    // The reason for dropping them was that the overlay described a label by “axis-aligned bounding box + quadrant” only, and that box coincides with the text only at multiples of 90°;
    // now a label carries its own length and thickness (both as fractions of the image width), and any angle fits
    const at = (a: number, b: number) => `<use data-text="A" transform="matrix(${a},${b},0,0,50,50)"/>`
    const parse = (markup: string) =>
      new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${markup}</svg>`, 'image/svg+xml').documentElement
    const line = (a: number, b: number) => linesOf(parse(at(a, b)))[0]!

    // Horizontal: no angle, the same shape the OCR backend gives, and therefore mergeable with the line above
    expect(line(10, 0).angle).toBeUndefined()
    expect(line(10, 0).len).toBeUndefined()
    // Tilted, vertical and upside down all stay, each with its own box
    for (const [a, b, degrees] of [[0, -10, -90], [0, 10, 90], [-10, 0, 180], [10 * Math.cos(-Math.PI / 6), 10 * Math.sin(-Math.PI / 6), -30]] as const) {
      const l = line(a, b)
      expect([degrees, Math.round(((l.angle ?? 0) * 180) / Math.PI)]).toEqual([degrees, degrees])
      // One glyph: length = one nominal glyph width of 0.7em, thickness = the font size, both normalised to an image width of 100
      expect([degrees, l.len, l.thick]).toEqual([degrees, 0.07, 0.1])
    }
    // runsOf reads as it always did
    expect(runsOf(parse(at(10 * Math.cos(-Math.PI / 6), 10 * Math.sin(-Math.PI / 6))))).toHaveLength(1)
  })

  it('snaps near-horizontal residuals to zero and leaves other angles as they are', () => {
    // The horizontal step must be an **exact 0**: every consumer only asks whether angle is truthy — `linesToBoxes` does not merge lines with an angle,
    // and `labelStyle` takes the rotation branch too. A horizontal label a thousandth of a degree off was once drawn as a tall thin strip because of it (Codex on #134).
    // The corpus really has 17 near-horizontal but non-zero lines, two of which (`ym`, `xm` of 2609.08661v1/fig2.svg) need translating.
    // ±90° on the other hand needs no snapping any more: the rotation branch rotates by the real angle, and a few microdegrees are invisible
    const at = (degrees: number) => {
      const radians = (degrees * Math.PI) / 180
      return `<use data-text="A" transform="matrix(${10 * Math.cos(radians)},${10 * Math.sin(radians)},0,0,50,50)"/>`
    }
    const parse = (markup: string) =>
      new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${markup}</svg>`, 'image/svg+xml').documentElement
    const angleOf = (degrees: number) => linesOf(parse(at(degrees)))[0]!.angle

    for (const degrees of [0, 0.5, -0.5, 1.7, -1.7]) expect([degrees, angleOf(degrees)]).toEqual([degrees, undefined])
    expect('angle' in linesOf(parse(at(0.5)))[0]!).toBe(false)
    // From 1.8° up it is a tilted label
    expect(Math.round(((angleOf(2) ?? 0) * 180) / Math.PI)).toBe(2)
    for (const degrees of [90, 89.5, -90, -90.5]) {
      expect([degrees, Math.round((((angleOf(degrees) ?? 0) * 180) / Math.PI) * 10) / 10]).toEqual([degrees, degrees])
    }
  })

  it('skips glyphs whose ancestor carries a transform of its own', () => {
    // A glyph's matrix is relative to its parent's coordinate system, so a transformed ancestor
    // makes the baseline, angle, size and position all wrong — the label would land somewhere
    // arbitrary on the figure. Measured over every fetchable file (276 files, 54344 glyphs): not
    // one glyph has one, though grouping itself is common (21.1% sit below the root, up to four
    // deep). Skipping keeps the geometry contract true by construction (Codex asked on #133).
    const glyph = (ch: string, x: number) => `<use data-text="${ch}" transform="matrix(10,0,0,-10,${x},50)"/>`
    const svg = (inner: string) =>
      new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100">${inner}</svg>`, 'image/svg+xml').documentElement
    const run = `${glyph('a', 20)}${glyph('b', 26)}`

    // Plain nesting is fine — the converter groups without transforming
    expect(runsOf(svg(`<g><g>${run}</g></g>`)).map(r => r.text)).toEqual(['ab'])
    // A transform anywhere above it is not
    expect(runsOf(svg(`<g transform="translate(30 40)">${run}</g>`))).toEqual([])
    expect(runsOf(svg(`<g transform="translate(30 40)"><g>${run}</g></g>`))).toEqual([])
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
