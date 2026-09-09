import { describe, expect, it } from 'vitest'
import { IMG_CLASS, T_CLASS } from '@/core/marks'
import {
  FOR_ATTR, IMG_MODES_ATTR, LANG_ATTR, MIRROR_CLASS, type ImageLabel, clearImage, emWidth, enable, labelStyle, overlayOf, renderImage, restore, setImageModes,
} from '@/core/renderer'
import { docOf } from './helpers'

// Image overlays (DESIGN §15.2): next sibling of img, no axt-t, no added img attributes, and fully removed on restore.

const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1" width="476" height="357"><figcaption class="ltx_caption">Figure 1.</figcaption></figure>'
const label = (text: string, source = text, extra: Partial<ImageLabel> = {}): ImageLabel => ({ x: 0.1, y: 0.2, w: 0.3, h: 0.05, lines: 1, source, text, ...extra })

function setup(html = FIGURE) {
  const doc = docOf(html)
  const el = doc.querySelector('img') as HTMLImageElement
  return { doc, target: { id: el.id, el } }
}

describe('renderImage', () => {
  it('overlays immediately follow img with data-axt-for and no axt-t, leaving img attributes unchanged', () => {
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

  it('labels use translated content, original title, html data-axt-lang, and only percentage or container-unit inline styles', () => {
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

  it('removes an adjacent mirror first because anchor positioning requires the overlay to immediately follow the image', () => {
    const { doc, target } = setup()
    const mirror = doc.createElement('img')
    mirror.className = `ltx_graphics ${T_CLASS} ${MIRROR_CLASS}`
    target.el.after(mirror)
    const node = renderImage(target, [label('译')])
    expect(target.el.nextElementSibling).toBe(node)
    expect(doc.querySelector(`.${MIRROR_CLASS}`)).toBeNull()
  })

  it('repeated rendering replaces rather than duplicates; clearImage removes the overlay', () => {
    const { doc, target } = setup()
    renderImage(target, [label('一')])
    renderImage(target, [label('二')])
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(1)
    expect(overlayOf(target)!.textContent).toBe('二')
    expect(clearImage(target)).toBe(true)
    expect(overlayOf(target)).toBeNull()
    expect(clearImage(target)).toBe(false)
  })

  it('restore removes overlays and html mode gates, recovering the exact DOM (§7.1)', () => {
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

  it('setImageModes removes the attribute for an empty set', () => {
    const { doc } = setup()
    setImageModes(doc, ['only'])
    setImageModes(doc, [])
    expect(doc.documentElement.hasAttribute(IMG_MODES_ATTR)).toBe(false)
  })
})

describe('labelStyle', () => {
  it('font size follows box height: one line uses 72%, two lines split it, and character count limits width', () => {
    const one = labelStyle(label('静态电荷', 'Static charge', { h: 0.05, w: 0.3, lines: 1 }))
    const two = labelStyle(label('动态 电荷', 'Dynamical charge', { h: 0.05, w: 0.3, lines: 2 }))
    expect(one).toContain('font-size:min(3.60cqh,')
    expect(two).toContain('font-size:min(1.80cqh,')
    // Four CJK characters = 4 em: width cap 92 × 0.3 / 4 = 6.9cqw.
    expect(one).toContain('6.90cqw)')
  })

  it('emWidth assigns 1 em per CJK character, 0.55 per Latin character, and 0.3 per space', () => {
    expect(emWidth('静态')).toBeCloseTo(2)
    expect(emWidth('ab')).toBeCloseTo(1.1)
    expect(emWidth('a b')).toBeCloseTo(1.4)
  })
})
