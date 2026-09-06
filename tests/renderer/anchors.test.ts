import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { SPLIT_ATTR, installAnchorFallback, renderFailed, renderPending, renderText, splitFigures } from '@/core/renderer'
import { docOf, frag } from './helpers'

// happy-dom 没有布局引擎：getClientRects 一律为空，那样所有元素都"不可见"。
// 这里按 only 模式的语义造可见性——被隐藏的是拿到译文的原块，其余都看得见。
function layout(doc: Document, hidden: Element[]) {
  const box = [{ top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10 }] as unknown as DOMRectList
  for (const el of [...doc.querySelectorAll('*')]) {
    el.getClientRects = () => (hidden.includes(el) ? ([] as unknown as DOMRectList) : box)
  }
}

const PAGE = '<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#tgt" id="link">§7</a>.</p></div>'
  + '<div class="ltx_para"><p class="ltx_p" id="tgt">Target paragraph.</p></div>'

/** 造一个「目标块已翻译」的文档，返回锚点与译文节点 */
function setup(opts: { hideTarget?: boolean } = {}) {
  const doc = docOf(PAGE)
  const blocks = extract(doc)
  markBlocks(blocks)
  const target = doc.getElementById('tgt')!
  const block = blocks.find(b => b.el === target) as TextBlock
  renderText(block, frag(doc, '目标段落。'))
  const translation = target.nextElementSibling!
  layout(doc, opts.hideTarget === false ? [] : [target])
  const scrolled: Element[] = []
  for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
  return { doc, link: doc.getElementById('link')!, target, translation, scrolled, blocks }
}

describe('页内锚点在 only 模式下落到译文上（issue #44）', () => {
  it('目标被隐藏时，点击滚到它的译文，并阻止默认跳转', () => {
    const { doc, link, translation, scrolled } = setup()
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([translation])
    expect(event.defaultPrevented).toBe(true)
    off()
  })

  it('目标看得见就完全不介入——side / stack 下一次都不该动手', () => {
    const { doc, link, scrolled } = setup({ hideTarget: false })
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    off()
  })

  it('卸载之后不再接管', () => {
    const { doc, link, scrolled } = setup()
    installAnchorFallback(doc)()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('Ctrl / Cmd / 中键点击是"新标签打开"，不接管', () => {
    for (const mod of [{ ctrlKey: true }, { metaKey: true }, { button: 1 }]) {
      const { doc, link, scrolled } = setup()
      const off = installAnchorFallback(doc)
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...mod })
      link.dispatchEvent(event)
      expect(scrolled).toEqual([])
      expect(event.defaultPrevented).toBe(false)
      off()
    }
  })

  it('圆环与失败小部件不当替身：滚过去只会看到一个空盒子', () => {
    const doc = docOf(PAGE)
    const blocks = extract(doc)
    markBlocks(blocks)
    const target = doc.getElementById('tgt')!
    const block = blocks.find(b => b.el === target) as TextBlock
    renderPending(block) // 只有圆环，还没有译文
    layout(doc, [target])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    doc.getElementById('link')!.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false) // 没有替身就交回浏览器
    off()

    // 失败小部件同理
    renderFailed(block, '网络错误', () => {})
    layout(doc, [target])
    const event2 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    const off2 = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(event2)
    expect(scrolled).toEqual([])
    expect(event2.defaultPrevented).toBe(false)
    off2()
  })

  it('目标是块内部的元素时，认它所在的块', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#deep" id="link">it</a>.</p></div>'
      + '<div class="ltx_para"><p class="ltx_p" id="tgt">Head <span id="deep">middle</span> tail.</p></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const target = doc.getElementById('tgt')!
    renderText(blocks.find(b => b.el === target) as TextBlock, frag(doc, '译文。'))
    const translation = target.nextElementSibling!
    layout(doc, [target, doc.getElementById('deep')!])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([translation])
    off()
  })

  it('target 指向别的浏览上下文时不接管——普通左键点击那也是"新标签打开"（Codex 在 #80 指出）', () => {
    for (const target of ['_blank', '_parent', 'someframe']) {
      const { doc, link, scrolled } = setup()
      link.setAttribute('target', target)
      const off = installAnchorFallback(doc)
      const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
      link.dispatchEvent(event)
      expect(scrolled).toEqual([])
      expect(event.defaultPrevented).toBe(false)
      off()
    }
  })

  it('target="_self" 与不写 target 一样，照常接管', () => {
    const { doc, link, translation, scrolled } = setup()
    link.setAttribute('target', '_self')
    const off = installAnchorFallback(doc)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([translation])
    off()
  })

  it('改 hash 走 location.hash，让 hashchange 照常派发（Codex 在 #80 指出）', async () => {
    const { doc, link, translation, scrolled } = setup()
    const view = doc.defaultView!
    // docOf 造的文档共享全局 window，而 happy-dom 的 hashchange 是**异步**派发的：
    // 前面的用例点过同一个锚点，事件还排在队列里。先把 hash 挪开并排空，这条才测得到自己那一次
    view.location.hash = 'elsewhere'
    await new Promise(r => setTimeout(r, 0))
    const fired: string[] = []
    const onHash = () => { fired.push(view.location.hash) }
    view.addEventListener('hashchange', onHash)
    const off = installAnchorFallback(doc)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([translation])
    await new Promise(r => setTimeout(r, 0))
    expect(fired).toEqual(['#tgt'])
    // 自己写的那次不该让兜底再滚一遍
    expect(scrolled).toEqual([translation])
    view.removeEventListener('hashchange', onHash)
    off()
  })

  it('嵌套单元的译文也被藏了，就往外层块找（Codex 在 #80 指出）', () => {
    // 致谢块里嵌一个标题块：内层的译文插在**外层原块内部**，外层一藏，它跟着没
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#inner" id="link">it</a>.</p></div>'
      + '<div class="ltx_acknowledgements" id="outer">Thanks.<h6 class="ltx_title" id="inner">Acknowledgements</h6></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const outer = doc.getElementById('outer')!
    const inner = doc.getElementById('inner')!
    // 两个都是块，且 inner 嵌在 outer 里
    expect(blocks.map(b => b.el)).toContain(outer)
    expect(blocks.map(b => b.el)).toContain(inner)
    for (const b of blocks) renderText(b as TextBlock, frag(doc, '译文'))
    const outerT = outer.nextElementSibling!
    const innerT = inner.nextElementSibling!
    // only 模式：outer 连同它内部的 inner 与 inner 的译文一起隐藏；outer 自己的译文可见
    layout(doc, [outer, inner, innerT])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([outerT])
    off()
  })

  it('拆开的插图：只译文模式下原件整个被藏，落到它旁边的克隆上（Codex 在 #80 指出）', () => {
    // side 模式先跑过 splitFigures，再切 only —— 这时 [data-axt-split] 的原件被 CSS 整个藏起来，
    // 可见的是紧跟其后的克隆，而克隆被 stripIds 剥了 id，图注引用指不到它
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#fig" id="link">Fig 2</a>.</p></div>'
      + '<figure id="fig" class="ltx_figure"><img class="ltx_graphics" src="x.png" alt="">'
      + '<figcaption class="ltx_caption" id="cap">Figure 2: A picture.</figcaption></figure>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const cap = doc.getElementById('cap')!
    renderText(blocks.find(b => b.el === cap) as TextBlock, frag(doc, '图 2：一张图。'))
    expect(splitFigures(doc)).toBe(1)
    const fig = doc.getElementById('fig')!
    expect(fig.hasAttribute(SPLIT_ATTR)).toBe(true)
    const clone = fig.nextElementSibling!
    expect(clone.classList.contains('axt-split')).toBe(true)
    expect(clone.id).toBe('') // 克隆剥了 id：锚点指不到它
    // only 模式：原件（连同里面的图注与它的译文）整个隐藏，克隆可见
    layout(doc, [fig, cap, ...[...fig.querySelectorAll('*')]])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([clone])
    off()
  })

  it('hashchange 也走同一条兜底：地址栏输入、前进后退都算', () => {
    const { doc, translation, scrolled } = setup()
    const off = installAnchorFallback(doc)
    const view = doc.defaultView!
    vi.spyOn(view, 'location', 'get').mockReturnValue({ hash: '#tgt' } as Location)
    view.dispatchEvent(new Event('hashchange'))
    expect(scrolled).toEqual([translation])
    off()
    vi.restoreAllMocks()
  })
})
