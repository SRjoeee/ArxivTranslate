import { describe, expect, it } from 'vitest'
import { extract, type TableBlock, type TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR, INLINE_ATTR, PENDING_CLASS } from '@/core/renderer/attrs'
import { restore } from '@/core/renderer/page'
import { clearAllPending, clearPending, renderPending } from '@/core/renderer/pending'
import { SKELETON_CLASS } from '@/core/renderer/skeleton'
import { clearTranslation, renderText } from '@/core/renderer/translation'
import { docOf, frag } from './helpers'

const page = '<h2 class="ltx_title ltx_title_section" id="s1">Intro</h2><p class="ltx_p" id="p1">Text.</p>'
  + '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

// The waiting node (§7.6): inserted after the original block before the request, a skeleton inside; replaced by the real translation when it arrives
describe('renderPending', () => {
  it('same tag as the original block, its class plus axt-t axt-pending, data-axt-for, a skeleton inside; inserted after the original', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    const node = renderPending(p)
    expect(node.tagName).toBe('P')
    expect(node.className).toBe(`ltx_p ${T_CLASS} ${PENDING_CLASS}`)
    expect(node.getAttribute(FOR_ATTR)).toBe('p1')
    expect(node.previousElementSibling).toBe(p.el)
    expect(node.children).toHaveLength(1)
    expect(node.firstElementChild?.classList.contains(SKELETON_CLASS)).toBe(true)
    expect(node.textContent).toBe('')
  })

  it('idempotent: calling again returns the same node', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    expect(renderPending(p)).toBe(renderPending(p))
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(1)
  })

  it('a table block gets a div placeholder (it is a table only once the whole clone arrives)', () => {
    const doc = docOf(page)
    const t = extract(doc).find(b => b.kind === 'table') as TableBlock
    const node = renderPending(t)
    expect(node.tagName).toBe('DIV')
    expect(node.classList.contains(T_CLASS)).toBe(true)
    expect(node.previousElementSibling).toBe(t.el)
  })

  it('a short heading: the pending node shares the heading\'s line (§7.3), so the layout does not jump when the translation arrives', () => {
    const doc = docOf(page)
    const title = extract(doc).find(b => b.id === 's1') as TextBlock
    const node = renderPending(title)
    expect(title.el.hasAttribute(INLINE_ATTR)).toBe(true)
    expect(node.hasAttribute(INLINE_ATTR)).toBe(true)
  })

  it('the translation arrives: renderText removes pending, only the real translation remains', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    renderPending(p)
    const node = renderText(p, frag(doc, '文本。'))
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    expect(doc.querySelectorAll(`.${SKELETON_CLASS}`)).toHaveLength(0)
    expect(p.el.nextElementSibling).toBe(node)
    expect(node.classList.contains(PENDING_CLASS)).toBe(false)
  })

  it('clearPending / clearTranslation / clearAllPending / restore all clear pending together with the skeleton', () => {
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
    expect(doc.querySelectorAll(`.${T_CLASS}, .${SKELETON_CLASS}`)).toHaveLength(0)
  })
})
