import { describe, expect, it } from 'vitest'
import { extract, type TableBlock, type TextBlock } from '@/core/extractor'
import {
  FOR_ATTR, INLINE_ATTR, PENDING_CLASS, SPINNER_CLASS, T_CLASS, clearAllPending, clearPending, clearTranslation, renderPending, renderText,
  restore,
} from '@/core/renderer'
import { docOf, frag } from './helpers'

const page = '<h2 class="ltx_title ltx_title_section" id="s1">Intro</h2><p class="ltx_p" id="p1">Text.</p>'
  + '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

// 等待态节点（§7.6）：请求前插在原块后，只有一个圆环；译文到达被真译文替换
describe('renderPending', () => {
  it('与原块同标签、沿用 class 加 axt-t axt-pending、带 data-axt-for，里面只有圆环；插在原块后面', () => {
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

  it('幂等：再调一次返回同一个节点', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    expect(renderPending(p)).toBe(renderPending(p))
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(1)
  })

  it('表格块用 div 占位（整表克隆到了才是 table）', () => {
    const doc = docOf(page)
    const t = extract(doc).find(b => b.kind === 'table') as TableBlock
    const node = renderPending(t)
    expect(node.tagName).toBe('DIV')
    expect(node.classList.contains(T_CLASS)).toBe(true)
    expect(node.previousElementSibling).toBe(t.el)
  })

  it('短标题：pending 节点与标题同行（§7.3），译文到达时版式不跳', () => {
    const doc = docOf(page)
    const title = extract(doc).find(b => b.id === 's1') as TextBlock
    const node = renderPending(title)
    expect(title.el.hasAttribute(INLINE_ATTR)).toBe(true)
    expect(node.hasAttribute(INLINE_ATTR)).toBe(true)
  })

  it('译文到达：renderText 删掉 pending，只剩真译文', () => {
    const doc = docOf(page)
    const p = extract(doc).find(b => b.id === 'p1') as TextBlock
    renderPending(p)
    const node = renderText(p, frag(doc, '文本。'))
    expect(doc.querySelectorAll(`.${PENDING_CLASS}`)).toHaveLength(0)
    expect(doc.querySelectorAll(`.${SPINNER_CLASS}`)).toHaveLength(0)
    expect(p.el.nextElementSibling).toBe(node)
    expect(node.classList.contains(PENDING_CLASS)).toBe(false)
  })

  it('clearPending / clearTranslation / clearAllPending / restore 都能把 pending 连圆环一起清掉', () => {
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
