import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { SPLIT_ATTR, installAnchorFallback, renderFailed, renderPending, renderText, splitFigures } from '@/core/renderer'
import { docOf, frag } from './helpers'

// happy-dom lacks layout: getClientRects is always empty, making every element appear invisible.
// Model only-mode visibility: translated originals are hidden; everything else remains visible.
function layout(doc: Document, hidden: Element[]) {
  const box = [{ top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10 }] as unknown as DOMRectList
  for (const el of [...doc.querySelectorAll('*')]) {
    el.getClientRects = () => (hidden.includes(el) ? ([] as unknown as DOMRectList) : box)
  }
}

const PAGE = '<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#tgt" id="link">§7</a>.</p></div>'
  + '<div class="ltx_para"><p class="ltx_p" id="tgt">Target paragraph.</p></div>'

/** Build a document with a translated target block and return its anchor and translation */
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

describe('in-page anchors target translations in only mode (issue #44)', () => {
  it('clicking a hidden target scrolls to its translation and prevents default navigation', () => {
    const { doc, link, translation, scrolled } = setup()
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([translation])
    expect(event.defaultPrevented).toBe(true)
    off()
  })

  it('visible targets are untouched, including every click in side and stack modes', () => {
    const { doc, link, scrolled } = setup({ hideTarget: false })
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false)
    off()
  })

  it('uninstall stops intercepting clicks', () => {
    const { doc, link, scrolled } = setup()
    installAnchorFallback(doc)()
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    link.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false)
  })

  it('Ctrl, Cmd, and middle clicks open new tabs and are not intercepted', () => {
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

  it('spinners and failure widgets are not substitutes because scrolling to them would show an empty box', () => {
    const doc = docOf(PAGE)
    const blocks = extract(doc)
    markBlocks(blocks)
    const target = doc.getElementById('tgt')!
    const block = blocks.find(b => b.el === target) as TextBlock
    renderPending(block) // Only a spinner exists; no translation yet.
    layout(doc, [target])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    doc.getElementById('link')!.dispatchEvent(event)
    expect(scrolled).toEqual([])
    expect(event.defaultPrevented).toBe(false) // With no substitute, let the browser handle navigation.
    off()

    // The same applies to failure widgets.
    renderFailed(block, 'Network error', () => {})
    layout(doc, [target])
    const event2 = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })
    const off2 = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(event2)
    expect(scrolled).toEqual([])
    expect(event2.defaultPrevented).toBe(false)
    off2()
  })

  it('targets inside a block resolve to their containing block', () => {
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

  it('links targeting another browsing context are not intercepted, even on ordinary left clicks (Codex #80)', () => {
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

  it('target=_self is handled like an omitted target', () => {
    const { doc, link, translation, scrolled } = setup()
    link.setAttribute('target', '_self')
    const off = installAnchorFallback(doc)
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([translation])
    off()
  })

  it('updates location.hash so hashchange fires normally (Codex #80)', async () => {
    const { doc, link, translation, scrolled } = setup()
    const view = doc.defaultView!
    // docOf documents share the global window; happy-dom dispatches hashchange asynchronously.
    // Earlier tests clicked the same anchor and left events queued; move the hash and drain events first to isolate this click.
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
    // The self-written hash change must not trigger another fallback scroll.
    expect(scrolled).toEqual([translation])
    view.removeEventListener('hashchange', onHash)
    off()
  })

  it('if a nested translation is also hidden, searches outward for a visible block (Codex #80)', () => {
    // A heading nested in acknowledgements inserts its translation inside the outer original, so hiding the outer block hides both.
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#inner" id="link">it</a>.</p></div>'
      + '<div class="ltx_acknowledgements" id="outer">Thanks.<h6 class="ltx_title" id="inner">Acknowledgements</h6></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const outer = doc.getElementById('outer')!
    const inner = doc.getElementById('inner')!
    // Both are blocks, with inner nested inside outer.
    expect(blocks.map(b => b.el)).toContain(outer)
    expect(blocks.map(b => b.el)).toContain(inner)
    for (const b of blocks) renderText(b as TextBlock, frag(doc, '译文'))
    const outerT = outer.nextElementSibling!
    const innerT = inner.nextElementSibling!
    // Only mode hides outer, inner, and the inner translation together; the outer translation remains visible.
    layout(doc, [outer, inner, innerT])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([outerT])
    off()
  })

  it('split figures hidden in only mode resolve to their adjacent visible clone (Codex #80)', () => {
    // After splitFigures runs in side mode and switches to only, CSS hides the entire data-axt-split original.
    // Its following clone is visible, but stripIds removed IDs so caption references cannot target it directly.
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
    expect(clone.id).toBe('') // The clone has no ID and cannot be directly targeted.
    // Only mode hides the original with its caption and translation; the clone is visible.
    layout(doc, [fig, cap, ...[...fig.querySelectorAll('*')]])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([clone])
    off()
  })

  it('anchors to a line inside a figure scroll to the matching cloned line instead of the figure top (Codex #80)', () => {
    // 2312.17141 has 21 such anchors; S3.Ex73–Ex79 are equation rows inside Figure 6.
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
    // The cloned row uses data-axt-split-of to point to the original ID.
    const innerCopy = clone.querySelector('[data-axt-split-of="eq"]')!
    expect(innerCopy).not.toBeNull()
    expect(innerCopy.id).toBe('') // It is not an ID and creates no duplicate.
    layout(doc, [fig, ...[...fig.querySelectorAll('*')]])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    // Scroll to the matching row, not the clone root.
    expect(scrolled).toEqual([innerCopy])
    expect(scrolled).not.toEqual([clone])
    off()
  })

  it('falls back to the figure top when the corresponding original element was removed from the clone because it has a translation', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="src">See <a href="#cap" id="link">caption</a>.</p></div>'
      + '<figure id="fig" class="ltx_figure"><img class="ltx_graphics" src="x.png" alt="">'
      + '<figcaption class="ltx_caption" id="cap">Figure 6.</figcaption></figure>')
    const blocks = extract(doc)
    markBlocks(blocks)
    const cap = doc.getElementById('cap')!
    renderText(blocks.find(b => b.el === cap) as TextBlock, frag(doc, '图 6。'))
    splitFigures(doc)
    const clone = doc.getElementById('fig')!.nextElementSibling!
    // The translated caption replaced its original in the clone, so no matching original remains.
    expect(clone.querySelector('[data-axt-split-of="cap"]')).toBeNull()
    layout(doc, [doc.getElementById('fig')!, ...[...doc.getElementById('fig')!.querySelectorAll('*')]])
    const scrolled: Element[] = []
    for (const el of [...doc.querySelectorAll('*')]) el.scrollIntoView = () => { scrolled.push(el) }
    const off = installAnchorFallback(doc)
    doc.getElementById('link')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }))
    expect(scrolled).toEqual([clone])
    off()
  })

  it('hashchange uses the same fallback for address-bar changes and browser history', () => {
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
