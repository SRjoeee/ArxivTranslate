import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { installAnchorFallback } from '@/core/renderer/anchors'
import { SPLIT_ATTR } from '@/core/renderer/attrs'
import { renderFailed } from '@/core/renderer/failed'
import { renderPending } from '@/core/renderer/pending'
import { splitFigures } from '@/core/renderer/split-figures'
import { renderText } from '@/core/renderer/translation'
import { docOf, frag } from './helpers'

// happy-dom has no layout engine: getClientRects is always empty, which would make every element “invisible”.
// Visibility is built here after only mode's semantics — hidden are the original blocks that got a translation, everything else shows.
function layout(doc: Document, hidden: Element[]) {
  const box = [{ top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10 }] as unknown as DOMRectList
  for (const el of [...doc.querySelectorAll('*')]) {
    el.getClientRects = () => (hidden.includes(el) ? ([] as unknown as DOMRectList) : box)
  }
}

const PAGE = '<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#tgt" id="link">§7</a>.</p></div>'
  + '<div class="ltx_para"><p class="ltx_p" id="tgt">Target paragraph.</p></div>'

/** Build a document whose target block is translated; returns the anchor and the translation node */
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

describe('in-page anchors land on the translation in only mode (issue #44)', () => {
  it('with the target hidden a click scrolls to its translation and prevents the default jump', () => {
    const { doc, link, translation, scrolled } = setup()
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([translation])
    expect(event.defaultPrevented).toBe(true)
    off()
  })

  it('with the target visible it never steps in — under side / stack it must not act once', () => {
    const { doc, link, scrolled } = setup({ hideTarget: false })
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    off()
  })

  it('after unmounting it no longer takes over', () => {
    const { doc, link, scrolled } = setup()
    installAnchorFallback(doc)()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('a Ctrl / Cmd / middle click is “open in a new tab” and is not taken over', () => {
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

  it('the skeleton and the failure widget are no stand-in: scrolling there would show an empty box', () => {
    const doc = docOf(PAGE)
    const blocks = extract(doc)
    markBlocks(blocks)
    const target = doc.getElementById('tgt')!
    const block = blocks.find(b => b.el === target) as TextBlock
    renderPending(block) // only the skeleton, no translation yet
    layout(doc, [target])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    doc.getElementById('link')!.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false) // with no stand-in it goes back to the browser
    off()

    // The failure widget likewise
    renderFailed(block, '网络错误', () => {})
    layout(doc, [target])
    const event2 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    const off2 = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(event2)
    expect(scrolled).toEqual([])
    expect(event2.defaultPrevented).toBe(false)
    off2()
  })

  it('a target inside a block resolves to the block it is in', () => {
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

  it('a target pointing at another browsing context is not taken over — a plain left click there is “open in a new tab” too (Codex on #80)', () => {
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

  it('target="_self" behaves like no target and is taken over as usual', () => {
    const { doc, link, translation, scrolled } = setup()
    link.setAttribute('target', '_self')
    const off = installAnchorFallback(doc)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([translation])
    off()
  })

  it('the hash is changed through location.hash so hashchange is dispatched as usual (Codex on #80)', async () => {
    const { doc, link, translation, scrolled } = setup()
    const view = doc.defaultView!
    // The documents docOf builds share the global window, and happy-dom dispatches hashchange **asynchronously**:
    // an earlier case clicked the same anchor and its event is still queued. Move the hash away and drain first, so this case sees only its own
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
    // The write of our own must not make the fallback scroll once more
    expect(scrolled).toEqual([translation])
    view.removeEventListener('hashchange', onHash)
    off()
  })

  it('with a nested unit\'s translation hidden as well, look outward to the enclosing block (Codex on #80)', () => {
    // A heading block nested inside an acknowledgements block: the inner translation sits **inside the outer original**, and goes with it when the outer is hidden
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#inner" id="link">it</a>.</p></div>'
      + '<div class="ltx_acknowledgements" id="outer">Thanks.<h6 class="ltx_title" id="inner">Acknowledgements</h6></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const outer = doc.getElementById('outer')!
    const inner = doc.getElementById('inner')!
    // Both are blocks, and inner is nested in outer
    expect(blocks.map(b => b.el)).toContain(outer)
    expect(blocks.map(b => b.el)).toContain(inner)
    for (const b of blocks) renderText(b as TextBlock, frag(doc, '译文'))
    const outerT = outer.nextElementSibling!
    const innerT = inner.nextElementSibling!
    // only mode: outer, with the inner and the inner's translation, is hidden; outer's own translation shows
    layout(doc, [outer, inner, innerT])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([outerT])
    off()
  })

  it('a split figure: in translation-only mode the original is hidden whole, and the anchor lands on the clone beside it (Codex on #80)', () => {
    // side mode ran splitFigures first, then switched to only — the [data-axt-split] original is now hidden whole by CSS,
    // visible is the clone right after it, and the clone was stripped of its id by stripIds, so the caption reference cannot point at it
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
    expect(clone.id).toBe('') // the clone is stripped of its id: an anchor cannot point at it
    // only mode: the original (with the caption and its translation inside) is hidden whole, the clone shows
    layout(doc, [fig, cap, ...[...fig.querySelectorAll('*')]])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([clone])
    off()
  })

  it('an anchor to one line inside a figure lands on the matching line in the clone, not the top of the figure (Codex on #80)', () => {
    // Measured: 2312.17141 has 21 such anchors: #S3.Ex73–Ex79 are all equation lines inside Figure 6
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#eq" id="link">(7)</a>.</p></div>'
      + '<figure id="fig" class="ltx_figure"><img class="ltx_graphics" src="x.png" alt="">'
      + '<span id="eq" class="ltx_equation">x = 1</span>'
      + '<figcaption class="ltx_caption" id="cap">Figure 6: Rows.</figcaption></figure>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const cap = doc.getElementById('cap')!
    renderText(blocks.find(b => b.el === cap) as TextBlock, frag(doc, '图 6：各行。'))
    expect(splitFigures(doc)).toBe(1)
    const fig = doc.getElementById('fig')!
    const clone = fig.nextElementSibling!
    // That line in the clone carries data-axt-split-of, pointing back at the original id
    const innerCopy = clone.querySelector('[data-axt-split-of="eq"]')!
    expect(innerCopy).not.toBeNull()
    expect(innerCopy.id).toBe('') // not an id, so no duplicate
    layout(doc, [fig, ...[...fig.querySelectorAll('*')]])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    // Lands on the matching line, not the clone's root
    expect(scrolled).toEqual([innerCopy])
    expect(scrolled).not.toEqual([clone])
    off()
  })

  it('when that spot was removed from the clone (it has a translation) it falls back to the top of the figure', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#cap" id="link">caption</a>.</p></div>'
      + '<figure id="fig" class="ltx_figure"><img class="ltx_graphics" src="x.png" alt="">'
      + '<figcaption class="ltx_caption" id="cap">Figure 6.</figcaption></figure>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const cap = doc.getElementById('cap')!
    renderText(blocks.find(b => b.el === cap) as TextBlock, frag(doc, '图 6。'))
    splitFigures(doc)
    const clone = doc.getElementById('fig')!.nextElementSibling!
    // The caption has a translation; its source copy was removed from the clone, so there is no match
    expect(clone.querySelector('[data-axt-split-of="cap"]')).toBeNull()
    layout(doc, [doc.getElementById('fig')!, ...[...doc.getElementById('fig')!.querySelectorAll('*')]])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([clone])
    off()
  })

  it('hashchange goes through the same fallback: typing in the address bar, back and forward all count', () => {
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
