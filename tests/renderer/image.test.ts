import { describe, expect, it } from 'vitest'
import { IMG_CLASS, T_CLASS } from '@/core/marks'
import { FOR_ATTR, LANG_ATTR, MIRROR_CLASS } from '@/core/renderer/attrs'
import { IMG_MODES_ATTR, clearImage, clearImageEverywhere, emWidth, labelStyle, overlayOf, renderImage, setImageModes, type ImageLabel } from '@/core/renderer/image'
import { enable, restore } from '@/core/renderer/page'
import { splitFigures } from '@/core/renderer/split-figures'
import { docOf } from './helpers'

// The image overlay (DESIGN §15.2): the <img>'s next sibling, without axt-t, not one attribute added to the <img>, and the whole layer removed on restore

const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1" width="476" height="357"><figcaption class="ltx_caption">Figure 1.</figcaption></figure>'
const label = (text: string, source = text, extra: Partial<ImageLabel> = {}): ImageLabel => ({ x: 0.1, y: 0.2, w: 0.3, h: 0.05, lines: 1, source, text, ...extra })

function setup(html = FIGURE) {
  const doc = docOf(html)
  const el = doc.querySelector('img') as HTMLImageElement
  return { doc, target: { id: el.id, el, kind: 'raster' as const } }
}

describe('renderImage', () => {
  it('the overlay is the <img>\'s next sibling with data-axt-for and without axt-t; the <img> itself gains not one attribute', () => {
    const { doc, target } = setup()
    const before = target.el.outerHTML
    const node = renderImage(target, [label('静态电荷', 'Static charge')])
    expect(target.el.nextElementSibling).toBe(node)
    expect(node.classList.contains(IMG_CLASS)).toBe(true)
    expect(node.classList.contains(T_CLASS)).toBe(false)
    expect(node.getAttribute(FOR_ATTR)).toBe('F1.g1')
    expect(target.el.outerHTML).toBe(before)
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(1)
  })

  it('a label: the translation as content, the source as title, lang from <html data-axt-lang>; the inline style uses percentages and container units only', () => {
    const { doc, target } = setup()
    doc.documentElement.setAttribute(LANG_ATTR, 'zh-CN')
    const node = renderImage(target, [label('静态电荷', 'Static charge'), label('过程', 'Processes', { x: 0.6, y: 0.03, w: 0.26, h: 0.035 })])
    const spans = Array.from(node.children) as HTMLElement[]
    expect(spans).toHaveLength(2)
    expect(spans[0]!.textContent).toBe('静态电荷')
    expect(spans[0]!.title).toBe('Static charge')
    expect(spans[0]!.getAttribute('lang')).toBe('zh-CN')
    for (const span of spans) {
      const style = span.getAttribute('style') ?? ''
      expect(style).toMatch(/^left:[\d.]+%;top:[\d.]+%;width:[\d.]+%;height:[\d.]+%;font-size:min\([\d.]+cqh,[\d.]+cqw\)$/)
      expect(style).not.toMatch(/px/)
    }
  })

  it('a mirror right after the image is removed first: the overlay has to be the image\'s next sibling (anchor positioning relies on that structure)', () => {
    const { doc, target } = setup()
    const mirror = doc.createElement('img')
    mirror.className = `ltx_graphics ${T_CLASS} ${MIRROR_CLASS}`
    target.el.after(mirror)
    const node = renderImage(target, [label('译')])
    expect(target.el.nextElementSibling).toBe(node)
    expect(doc.querySelector(`.${MIRROR_CLASS}`)).toBeNull()
  })

  it('rendering again replaces rather than stacks; clearImage removes it', () => {
    const { doc, target } = setup()
    renderImage(target, [label('一')])
    renderImage(target, [label('二')])
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(1)
    expect(overlayOf(target)!.textContent).toBe('二')
    expect(clearImage(target)).toBe(true)
    expect(overlayOf(target)).toBeNull()
    expect(clearImage(target)).toBe(false)
  })

  it('restoring the original: the overlay and the mode gate on <html> are cleared together, the DOM equal byte for byte (§7.1)', () => {
    const { doc, target } = setup()
    const before = doc.documentElement.outerHTML
    enable(doc, 'stack')
    setImageModes(doc, ['side', 'stack'])
    expect(doc.documentElement.getAttribute(IMG_MODES_ATTR)).toBe('side stack')
    renderImage(target, [label('译')])
    const result = restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
    expect(result.removedNodes).toBe(1)
  })

  it('setImageModes with an empty set removes the attribute', () => {
    const { doc } = setup()
    setImageModes(doc, ['only'])
    setImageModes(doc, [])
    expect(doc.documentElement.hasAttribute(IMG_MODES_ATTR)).toBe(false)
  })
})

describe('labelStyle', () => {
  it('font size by box height: one line takes 72% of the box height, two lines half each; the width cap is shared by character count', () => {
    const one = labelStyle(label('静态电荷', 'Static charge', { h: 0.05, w: 0.3, lines: 1 }))
    const two = labelStyle(label('动态 电荷', 'Dynamical charge', { h: 0.05, w: 0.3, lines: 2 }))
    expect(one).toContain('font-size:min(3.60cqh,')
    expect(two).toContain('font-size:min(1.80cqh,')
    // 4 CJK characters = 4 em: width cap 92 × 0.3 / 4 = 6.9cqw
    expect(one).toContain('6.90cqw)')
  })

  it('emWidth: one em per CJK character, 0.55 for Latin, 0.3 for a space', () => {
    expect(emWidth('静态')).toBeCloseTo(2)
    expect(emWidth('ab')).toBeCloseTo(1.1)
    expect(emWidth('a b')).toBeCloseTo(1.4)
  })
})

describe('rotated labels (§15.5)', () => {
  // A tilted label carries its own length and thickness (both as fractions of the image **width**): the axis-aligned bounding box coincides with the text only at multiples of 90°,
  // at 5° it is a ring larger than the text, and drawing by it would spread the white box diagonally over the image
  const label = (over: Partial<ImageLabel> = {}): ImageLabel => ({ x: 0.1, y: 0.2, w: 0.05, h: 0.4, lines: 1, source: 'wall time', text: '每轮耗时', ...over })
  const rotated = (degrees: number, over: Partial<ImageLabel> = {}) =>
    labelStyle(label({ angle: (degrees * Math.PI) / 180, len: 0.4, thick: 0.05, ...over }))

  it('laid along the text\'s own axis: length and thickness in the same unit, rotated about the centre', () => {
    // `width: X%` is a percentage of the container **width**; rotated 90° that edge is vertical on screen, and with a non-square container the length is wrong.
    // cqw is a length unit (1% of the image width); one number is the same real length in every direction
    const style = rotated(-90)
    expect(style).toContain('width:40.000cqw')
    expect(style).toContain('height:5.000cqw')
    expect(style).toContain('transform:translate(-50%,-50%) rotate(-90.00deg)')
    // The position is the centre; the size carries no percentage (that would quietly become “percent of the width”)
    expect(style).toContain('left:12.500%;top:40.000%')
    expect(style).not.toMatch(/(width|height):[\d.]+%/)
  })

  it('any angle fits (the reheating label of 2609.10326v1 is at 6°)', () => {
    const style = rotated(6)
    expect(style).toContain('transform:translate(-50%,-50%) rotate(6.00deg)')
    expect(style).toContain('width:40.000cqw')
  })

  it('font size is computed from the thickness, not the length', () => {
    // 72 * thick is the cap on one line's height
    expect(rotated(-90)).toContain('font-size:min(3.60cqw,')
  })

  it('without a box of its own it falls back to the axis-aligned branch and does not draw by wrong dimensions', () => {
    // The OCR backend gives no len / thick; should a line with an angle but no box appear, drawing by the bounding box beats a wild rotation
    const style = labelStyle(label({ angle: -Math.PI / 2 }))
    expect(style).not.toContain('rotate')
    expect(style).toContain('left:10.000%;top:20.000%')
  })

  it('leaves upright labels exactly as they were', () => {
    const style = labelStyle(label())
    expect(style).toBe('left:10.000%;top:20.000%;width:5.000%;height:40.000%;font-size:min(28.80cqh,1.15cqw)')
    expect(style).not.toContain('transform')
  })
})

describe('clearImageEverywhere (§15.5)', () => {
  it('removes even the copy inside the side-mode split clone', () => {
    // `clearImage` looks only at the image's own sibling position. The copy inside the clone is **the only visible one** in only mode —
    // the original is hidden — so “no longer translating this image” has to take it too, or the reader sees the previous round's translation
    const doc = docOf('<figure class="ltx_figure"><img class="ltx_graphics" id="g1"><figcaption class="ltx_caption" data-axt-id="c1">Fig 1.</figcaption><figcaption class="axt-t" data-axt-for="c1">图 1。</figcaption></figure>')
    const img = doc.getElementById('g1') as HTMLImageElement
    const target = { id: 'g1', el: img, kind: 'raster' as const }
    renderImage(target, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static', text: '静态' }])
    // The copy must really come from `splitFigures`: a hand-made clone would leave `data-axt-for` on the overlay,
    // while a real split wipes it through `stripIds` — code that finds the copy by `data-axt-for` would pass on a hand-made copy all the same
    // (Codex on #134)
    expect(splitFigures(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(2)
    expect(doc.querySelector(`.axt-split .${IMG_CLASS}`)?.getAttribute(FOR_ATTR)).toBeNull()

    expect(clearImage(target)).toBe(true)
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(1) // // the copy inside the clone is still there

    renderImage(target, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static', text: '静态' }])
    expect(clearImageEverywhere(target)).toBe(2)
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(0)
  })
})
