import { describe, expect, it } from 'vitest'
import { IMG_CLASS, T_CLASS } from '@/core/marks'
import { FOR_ATTR, LANG_ATTR, MIRROR_CLASS } from '@/core/renderer/attrs'
import { IMG_MODES_ATTR, clearImage, clearImageEverywhere, emWidth, labelStyle, overlayOf, renderImage, setImageModes, type ImageLabel } from '@/core/renderer/image'
import { enable, restore } from '@/core/renderer/page'
import { splitFigures } from '@/core/renderer/split-figures'
import { docOf } from './helpers'

// 图片叠加层（DESIGN §15.2）：<img> 的下一个兄弟、不带 axt-t、<img> 一个属性都不加、恢复原文整层删掉

const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1" width="476" height="357"><figcaption class="ltx_caption">Figure 1.</figcaption></figure>'
const label = (text: string, source = text, extra: Partial<ImageLabel> = {}): ImageLabel => ({ x: 0.1, y: 0.2, w: 0.3, h: 0.05, lines: 1, source, text, ...extra })

function setup(html = FIGURE) {
  const doc = docOf(html)
  const el = doc.querySelector('img') as HTMLImageElement
  return { doc, target: { id: el.id, el, kind: 'raster' as const } }
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

describe('rotated labels (§15.5)', () => {
  // 斜标签自带长与厚（都按图**宽**的比例）：轴对齐外接框只在 90° 的倍数上与文字重合，
  // 5° 时比文字大一圈，照着画会把白框斜铺到图上
  const label = (over: Partial<ImageLabel> = {}): ImageLabel => ({ x: 0.1, y: 0.2, w: 0.05, h: 0.4, lines: 1, source: 'wall time', text: '每轮耗时', ...over })
  const rotated = (degrees: number, over: Partial<ImageLabel> = {}) =>
    labelStyle(label({ angle: (degrees * Math.PI) / 180, len: 0.4, thick: 0.05, ...over }))

  it('沿文字自己的轴摆：长与厚都用同一个单位，绕中心转过去', () => {
    // `width: X%` 是容器**宽**的百分比，转 90° 之后那条边在屏幕上是竖的，容器不是正方形时长度就错了。
    // cqw 是长度单位（图宽的 1%），一个数在哪个方向上都是同一段实际长度
    const style = rotated(-90)
    expect(style).toContain('width:40.000cqw')
    expect(style).toContain('height:5.000cqw')
    expect(style).toContain('transform:translate(-50%,-50%) rotate(-90.00deg)')
    // 位置是中心，尺寸不带百分比（那会悄悄变成「宽的百分比」）
    expect(style).toContain('left:12.500%;top:40.000%')
    expect(style).not.toMatch(/(width|height):[\d.]+%/)
  })

  it('任意角度都摆得下（2609.10326v1 的 reheating 是 6°）', () => {
    const style = rotated(6)
    expect(style).toContain('transform:translate(-50%,-50%) rotate(6.00deg)')
    expect(style).toContain('width:40.000cqw')
  })

  it('字号按厚度算，不按长度', () => {
    // 72 * thick 是一行的高度上限
    expect(rotated(-90)).toContain('font-size:min(3.60cqw,')
  })

  it('没有自己的盒子就退回轴对齐那一支，不会照着错的尺寸画', () => {
    // OCR 后端不会给 len / thick；真出现带角度却没有盒子的行时，按外接框画总好过乱转
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

describe('clearImageEverywhere（§15.5）', () => {
  it('连 side 模式拆图副本里的那一份也摘掉', () => {
    // `clearImage` 只看图自己的兄弟位置。副本里那份在 only 模式下是**唯一可见的**——
    // 原件被藏起来了——所以「不再翻这张图」时它必须一起走，否则读者看到的是上一轮的译文
    const doc = docOf('<figure class="ltx_figure"><img class="ltx_graphics" id="g1"><figcaption class="ltx_caption" data-axt-id="c1">Fig 1.</figcaption><figcaption class="axt-t" data-axt-for="c1">图 1。</figcaption></figure>')
    const img = doc.getElementById('g1') as HTMLImageElement
    const target = { id: 'g1', el: img, kind: 'raster' as const }
    renderImage(target, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static', text: '静态' }])
    // 副本必须由 `splitFigures` 真的拆出来：手搓一个 clone 会把 `data-axt-for` 留在叠加层上，
    // 而真的拆图会被 `stripIds` 抹掉——按 `data-axt-for` 找副本的写法在手搓的副本上照样通过
    //（Codex 在 #134 指出）
    expect(splitFigures(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(2)
    expect(doc.querySelector(`.axt-split .${IMG_CLASS}`)?.getAttribute(FOR_ATTR)).toBeNull()

    expect(clearImage(target)).toBe(true)
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(1) // 副本里那份还在

    renderImage(target, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static', text: '静态' }])
    expect(clearImageEverywhere(target)).toBe(2)
    expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(0)
  })
})
