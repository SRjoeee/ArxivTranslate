import { describe, expect, it } from 'vitest'
import { IMG_CLASS, T_CLASS } from '@/core/marks'
import {
  FOR_ATTR, IMG_MODES_ATTR, LANG_ATTR, MIRROR_CLASS, type ImageLabel, clearImage, emWidth, enable, labelStyle, overlayOf, renderImage, restore, setImageModes,
} from '@/core/renderer'
import { docOf } from './helpers'

// 图片叠加层（DESIGN §15.2）：<img> 的下一个兄弟、不带 axt-t、<img> 一个属性都不加、恢复原文整层删掉

const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1" width="476" height="357"><figcaption class="ltx_caption">Figure 1.</figcaption></figure>'
const label = (text: string, source = text, extra: Partial<ImageLabel> = {}): ImageLabel => ({ x: 0.1, y: 0.2, w: 0.3, h: 0.05, lines: 1, source, text, ...extra })

function setup(html = FIGURE) {
  const doc = docOf(html)
  const el = doc.querySelector('img') as HTMLImageElement
  return { doc, target: { id: el.id, el } }
}

describe('renderImage', () => {
  it('叠加层是 <img> 的下一个兄弟，带 data-axt-for，不带 axt-t；<img> 本身一个属性都不多', () => {
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

  it('标签：译文做内容、原文做 title、lang 取 <html data-axt-lang>；内联样式只用百分比与容器单位', () => {
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

  it('紧跟在图后面的镜像先删掉：叠加层必须是图的下一个兄弟（锚点定位靠这个结构）', () => {
    const { doc, target } = setup()
    const mirror = doc.createElement('img')
    mirror.className = `ltx_graphics ${T_CLASS} ${MIRROR_CLASS}`
    target.el.after(mirror)
    const node = renderImage(target, [label('译')])
    expect(target.el.nextElementSibling).toBe(node)
    expect(doc.querySelector(`.${MIRROR_CLASS}`)).toBeNull()
  })

  it('重复渲染替换不叠加；clearImage 删掉它', () => {
    const { doc, target } = setup()
    renderImage(target, [label('一')])
    renderImage(target, [label('二')])
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(1)
    expect(overlayOf(target)!.textContent).toBe('二')
    expect(clearImage(target)).toBe(true)
    expect(overlayOf(target)).toBeNull()
    expect(clearImage(target)).toBe(false)
  })

  it('恢复原文：叠加层与 <html> 上的模式闸一起清掉，DOM 逐字相等（§7.1）', () => {
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

  it('setImageModes 空集合就摘掉属性', () => {
    const { doc } = setup()
    setImageModes(doc, ['only'])
    setImageModes(doc, [])
    expect(doc.documentElement.hasAttribute(IMG_MODES_ATTR)).toBe(false)
  })
})

describe('labelStyle', () => {
  it('字号按框高：一行占框高的 72%，两行各占一半；宽度上限按字数均摊', () => {
    const one = labelStyle(label('静态电荷', 'Static charge', { h: 0.05, w: 0.3, lines: 1 }))
    const two = labelStyle(label('动态 电荷', 'Dynamical charge', { h: 0.05, w: 0.3, lines: 2 }))
    expect(one).toContain('font-size:min(3.60cqh,')
    expect(two).toContain('font-size:min(1.80cqh,')
    // 4 个 CJK 字 = 4 em：宽度上限 92 × 0.3 / 4 = 6.9cqw
    expect(one).toContain('6.90cqw)')
  })

  it('emWidth：CJK 一字一 em，拉丁 0.55，空格 0.3', () => {
    expect(emWidth('静态')).toBeCloseTo(2)
    expect(emWidth('ab')).toBeCloseTo(1.1)
    expect(emWidth('a b')).toBeCloseTo(1.4)
  })
})
