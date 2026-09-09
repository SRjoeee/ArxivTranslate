import { describe, expect, it } from 'vitest'
import { extract, type TableBlock, type TextBlock } from '@/core/extractor'
import {
  FOR_ATTR, INLINE_ATTR, PENDING_CLASS, SPINNER_CLASS, T_CLASS, clearAllPending, clearPending, clearTranslation, renderPending, renderText,
  restore,
} from '@/core/renderer'
import { docOf, frag } from './helpers'

const page = '<h2 class="ltx_title ltx_title_section" id="s1">Intro</h2><p class="ltx_p" id="p1">Text.</p>'
  + '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

// Pending nodes (§7.6): one spinner after the original before requests, replaced by the real translation on arrival.
describe('renderPending', () => {
  it('matches the original tag and classes, adds axt-t, axt-pending, and data-axt-for, and inserts only a spinner after the original', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    const node = renderPending(p)
    expect(node.tagName).toBe('P')
    expect(node.className).toBe(`ltx_p ${T_CLASS} ${PENDING_CLASS}`)
    expect(node.getAttribute(FOR_ATTR)).toBe('p1')
    expect(node.previousElementSibling).toBe(p.el)
    expect(node.children).toHaveLength(1)
    expect(node.firstElementChild?.classList.contains(SPINNER_CLASS)).toBe(true)
    expect(node.textContent).toBe('')
  })

  it('repeated calls return the same node', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    expect(renderPending(p)).toBe(renderPending(p))
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(1)
  })

  it('table blocks use div placeholders until the translated table clone arrives', () => {
    const doc = docOf(page)
    const t = extract(doc).find(b => b.kind === 'table') as TableBlock
    const node = renderPending(t)
    expect(node.tagName).toBe('DIV')
    expect(node.classList.contains(T_CLASS)).toBe(true)
    expect(node.previousElementSibling).toBe(t.el)
  })

  it('short-heading pending nodes stay inline (§7.3) to avoid layout jumps when translations arrive', () => {
    const doc = docOf(page)
    const title = extract(doc).find(b => b.id === 's1') as TextBlock
    const node = renderPending(title)
    expect(title.el.hasAttribute(INLINE_ATTR)).toBe(true)
    expect(node.hasAttribute(INLINE_ATTR)).toBe(true)
  })

  it('renderText removes pending so only the real translation remains', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    renderPending(p)
    const node = renderText(p, frag(doc, '文本。'))
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    expect(doc.querySelectorAll(`.${SPINNER_CLASS}`)).toHaveLength(0)
    expect(p.el.nextElementSibling).toBe(node)
    expect(node.classList.contains(PENDING_CLASS)).toBe(false)
  })

  it('clearPending, clearTranslation, clearAllPending, and restore remove pending nodes and spinners', () => {
    const doc = docOf(page)
    const blocks = extract(doc)
    const [s1, p1] = blocks as [TextBlock, TextBlock]
    renderPending(s1)
    renderPending(p1)
    expect(clearPending(s1)).toBe(true)
    expect(clearPending(s1)).toBe(false)
    clearTranslation(p1)
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    for (const b of blocks) renderPending(b)
    expect(clearAllPending(doc)).toBe(3)
    for (const b of blocks) renderPending(b)
    restore(doc)
    expect(doc.querySelectorAll(`.${T_CLASS}, .${SPINNER_CLASS}`)).toHaveLength(0)
  })
})
