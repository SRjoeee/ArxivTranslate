import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { FOR_ATTR, INLINE_ATTR, STATE_ATTR, T_CLASS, renderText, setState } from '@/core/renderer'
import { docOf, frag } from './helpers'

describe('renderText', () => {
  it('作为下一个兄弟插入：同标签、axt-t、data-axt-for；原节点只多 data-axt-state', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Hello <em>x</em>.</p><p class="ltx_p" id="p2">Next.</p></div>')
    const [b1] = extract(doc) as TextBlock[]
    const before = b1!.el.innerHTML
    const node = renderText(b1!, frag(doc, '你好 <em>x</em>。'))
    expect(node.tagName).toBe('P')
    expect(node.className).toBe(`ltx_p ${T_CLASS}`)
    expect(node.getAttribute(FOR_ATTR)).toBe('p1')
    expect(node.hasAttribute('id')).toBe(false)
    expect(node.previousElementSibling).toBe(b1!.el)
    expect(node.nextElementSibling?.id).toBe('p2')
    expect(node.innerHTML).toBe('你好 <em>x</em>。')
    expect(b1!.el.innerHTML).toBe(before)
    expect(b1!.el.getAttribute(STATE_ATTR)).toBe('translated')
  })

  it('标签名跟随原块：span.ltx_p → span，li.ltx_bibitem → li，figcaption.ltx_caption → figcaption', () => {
    const doc = docOf(
      '<p class="ltx_p" id="p"><span class="ltx_inline-block"><span class="ltx_p" id="s">Inner.</span></span></p>'
      + '<ul class="ltx_biblist"><li class="ltx_bibitem" id="b">Ref.</li></ul>'
      + '<figure class="ltx_figure"><figcaption class="ltx_caption" id="c">Caption.</figcaption></figure>',
    )
    const blocks = extract(doc) as TextBlock[]
    const tags = blocks.map(b => renderText(b, frag(doc, '译')).tagName)
    expect(tags).toEqual(['SPAN', 'LI', 'FIGCAPTION'])
    expect(doc.querySelector('ul')?.children).toHaveLength(2)
  })

  it('译文节点复制原块的 class 再加 axt-t，沿用站点样式', () => {
    const doc = docOf('<h1 class="ltx_title ltx_title_document" id="t">Attention</h1>')
    const [b] = extract(doc) as TextBlock[]
    const node = renderText(b!, frag(doc, '注意力'))
    expect(node.className).toBe(`ltx_title ltx_title_document ${T_CLASS}`)
    expect(b!.el.className).toBe('ltx_title ltx_title_document')
  })

  it('短标题同行：原标题与译文都加 data-axt-inline；文档主标题、长标题、普通段落不加', () => {
    const doc = docOf(
      '<h6 class="ltx_title ltx_title_abstract" id="a">Abstract</h6>'
      + '<h2 class="ltx_title ltx_title_section" id="s"><span class="ltx_tag ltx_tag_section">1 </span>Introduction</h2>'
      + '<h1 class="ltx_title ltx_title_document" id="d">Short</h1>'
      + `<h2 class="ltx_title ltx_title_section" id="l">${'Long title '.repeat(8)}</h2>`
      + '<p class="ltx_p" id="p">Short.</p>',
    )
    const blocks = extract(doc) as TextBlock[]
    const inline = Object.fromEntries(blocks.map(b => {
      const node = renderText(b, frag(doc, '译'))
      return [b.id, `${b.el.hasAttribute(INLINE_ATTR)}/${node.hasAttribute(INLINE_ATTR)}`]
    }))
    expect(inline).toEqual({ a: 'true/true', s: 'true/true', d: 'false/false', l: 'false/false', p: 'false/false' })
  })

  it('译文里克隆来的元素不带 data-axt-*，译文节点本身也没有 data-axt-id', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    setState(b!, 'pending')
    const node = renderText(b!, frag(doc, '你好<span class="ltx_note" data-axt-id="n1" data-axt-state="pending">x</span>'))
    expect(node.querySelector('[data-axt-id], [data-axt-state]')).toBeNull()
    expect(node.hasAttribute('data-axt-id')).toBe(false)
    expect(node.hasAttribute(STATE_ATTR)).toBe(false)
  })

  it('重复渲染同一块只保留最新一份', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    renderText(b!, frag(doc, '第一版'))
    renderText(b!, frag(doc, '第二版'))
    const nodes = Array.from(doc.querySelectorAll(`.${T_CLASS}`))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.textContent).toBe('第二版')
    expect(nodes[0]?.previousElementSibling).toBe(b!.el)
  })

  it('setState 写在原节点上', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    setState(b!, 'pending')
    expect(b!.el.getAttribute(STATE_ATTR)).toBe('pending')
    setState(b!, 'failed')
    expect(b!.el.getAttribute(STATE_ATTR)).toBe('failed')
  })
})
