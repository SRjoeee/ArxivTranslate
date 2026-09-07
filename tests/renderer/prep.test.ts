import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { MIRROR_CLASS, SPLIT_ATTR, SPLIT_CLASS, createPrep, renderImage, renderText, resetFitCache, rootsOf, splitFigures } from '@/core/renderer'
import { docOf, frag } from './helpers'

// 增量整理（issue #46）：每趟只碰刚动过 DOM 的块所在的容器，镜像整个会话只跑一次，
// 栏宽在写任何东西之前读、且只在陈旧时读。这里的用例都用能在 happy-dom 里观察到的效果：
// 拆图（.axt-split 兄弟）、镜像（.axt-mirror）、栏宽读取次数

/**
 * 两张带说明的插图，各在自己的章节里（真实论文的形状）。说明是一个块；
 * 它的根是 figure 的父元素——也就是各自的 section——所以只碰一张不会波及另一张
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

  it('touch(B) 只整理 B 所在的容器：另一张没碰的图保持原样', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touch([byId('c1')])
    flush()
    expect(doc.getElementById('f1')!.nextElementSibling?.classList.contains(SPLIT_CLASS)).toBe(true)
    // 没碰的那张**保持陈旧**——这正是"只碰变动区域"的含义；范围一放大到 document 这条就挂
    expect(doc.getElementById('f2')!.nextElementSibling?.classList.contains(SPLIT_CLASS) ?? false).toBe(false)
  })

  it('touch 的根要比 figure 高一层：说明块的父元素就是 figure，而 splitFigures 只扫后代', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    const roots = rootsOf([byId('c1').el])
    // 根不是 figure 自身，而是它的父元素（这里是 section）
    expect(roots).toEqual([doc.getElementById('s1')])
    prep.touch([byId('c1')])
    flush()
    expect(doc.getElementById('f1')!.nextElementSibling?.classList.contains(SPLIT_CLASS)).toBe(true)
  })

  it('touchAll 两张都拆', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
  })

  it('同一轮里 touch 与 touchAll 混着来，按全量跑', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    renderText(byId('c2'), frag(doc, '图 2。'))
    prep.touch([byId('c1')])
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
  })

  it('镜像整个会话只跑一次：第二趟全量不给后插进来的公式造镜像', () => {
    const { doc, prep } = setup(EQUATION)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
    // 模拟"后来又出现一个没镜像的公式"——真实页面上不会发生，正因为不会发生才不用每趟重扫
    const late = doc.getElementById('E1')!.cloneNode(true) as Element
    late.id = 'E2'
    doc.getElementById('E1')!.parentElement!.append(late)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('reset() 之后镜像允许再跑一次', () => {
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

  it('块标记还没写之前不算跑过镜像：那一趟没有镜像，标记写完的下一趟才有', () => {
    const doc = docOf(EQUATION)
    const blocks = extract(doc) // 故意不 markBlocks
    const prep = createPrep(doc, { isSide: () => true, columnWidth: () => 484 })
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
    markBlocks(blocks)
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('不在 side 模式：不拆图、不镜像', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES + EQUATION, { side: false })
    renderText(byId('c1'), frag(doc, '图 1。'))
    prep.touchAll()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(0)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('栏宽只在陈旧时读：连跑两趟读一次，refreshColumn 之后再读一次', () => {
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

  it('栏宽从翻译根量，不是从 <html>：measureColumn 靠 closest(article) 找网格轨道', () => {
    // e2e 抓到的：传 <html> 时 closest 找不到、退路的 parentElement 是 null → 栏宽 0 → 一张表都不缩
    const columnWidth = vi.fn((_root: Element) => 484)
    const { prep, byId, doc } = setup(EQUATION, { columnWidth })
    renderText(byId('p1'), frag(doc, '文。'))
    prep.touch([byId('p1')])
    flush()
    expect(columnWidth).toHaveBeenCalledTimes(1)
    expect(columnWidth.mock.calls[0]![0]).toBe(doc.querySelector('article.ltx_document'))
  })

  it('字体加载完成：栏宽重读、全量整理一趟', () => {
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
    // 全量：另一张也拆了；栏宽重读了一次
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(2)
    expect(columnWidth).toHaveBeenCalledTimes(2)
  })

  it('cancel 撤掉排着的那一趟', () => {
    const { doc, prep, byId } = setup(TWO_FIGURES)
    renderText(byId('c1'), frag(doc, '图 1。'))
    prep.touch([byId('c1')])
    prep.cancel()
    flush()
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(0)
  })
})

describe('createPrep × 图片叠加层（DESIGN §15.2）', () => {
  beforeEach(() => { vi.useFakeTimers(); resetFitCache() })
  afterEach(() => vi.useRealTimers())

  const IMG_FIGURE = '<section class="ltx_section"><figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"><figcaption class="ltx_caption" id="c1">Figure 1.</figcaption></figure></section>'
  const overlayOn = (doc: Document) => {
    const el = doc.querySelector('img') as HTMLImageElement
    const target = { id: el.id, el }
    renderImage(target, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static charge', text: '静态电荷' }])
    return target
  }

  it('touch([图片目标]) 在 side 下拆它所在的插图：根经最外层 figure 的父元素', () => {
    const { doc, prep } = setup(IMG_FIGURE)
    const target = overlayOn(doc)
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS} img`)).not.toBeNull()
  })

  it('side 下插图唯一的译文（叠加层）被摘掉：旧副本要丢掉，不能一直挂着旧标签（Codex 在 #89 指出）', () => {
    const NO_CAPTION = '<section class="ltx_section"><figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"></figure></section>'
    const { doc, prep } = setup(NO_CAPTION)
    const target = overlayOn(doc)
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).not.toBeNull()
    // 新一轮全是恒等译文：叠加层被摘掉，run 通过 onRendered → prep.touch
    doc.querySelector('.axt-img')!.remove()
    prep.touch([target])
    flush()
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
    expect(doc.querySelector(`[${SPLIT_ATTR}]`)).toBeNull()
  })

  it('非 side 下签名过期的副本被丢掉：side → only 之后叠加层才到的情况', () => {
    const doc = docOf(IMG_FIGURE)
    const blocks = extract(doc)
    markBlocks(blocks)
    renderText(blocks.find(b => b.el.id === 'c1') as TextBlock, frag(doc, '图 1。'))
    splitFigures(doc) // 曾经在 side 拆过
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
  it('父元素、各祖先块的父元素、最外层 figure 的父元素；被包含的根去掉', () => {
    const doc = docOf('<div class="ltx_acknowledgements" id="outer">Thanks <h6 class="ltx_title" id="inner">Ack</h6></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const inner = blocks.find(b => b.el.id === 'inner')!
    const roots = rootsOf([inner.el])
    // inner 的父是 outer（一个块），outer 的父是翻译根；翻译根包含 outer，所以只剩翻译根
    expect(roots).toHaveLength(1)
    expect(roots[0]!.classList.contains('ltx_document')).toBe(true)
  })

  it('同一容器里两个块只算一个根', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="a">A.</p><p class="ltx_p" id="b">B.</p></div>')
    const blocks = extract(doc)
    expect(rootsOf(blocks.map(b => b.el))).toHaveLength(1)
  })
})
