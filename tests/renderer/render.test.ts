import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR, IDENTITY_ATTR, INLINE_ATTR, STATE_ATTR } from '@/core/renderer/attrs'
import { shouldInline } from '@/core/renderer/shell'
import { renderText, setState } from '@/core/renderer/translation'
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

describe('文档标题与副标题不作同行候选（Codex 在 #13 指出）', () => {
  const inlineOf = (html: string, selector: string) => {
    const doc = docOf(html)
    const block = extract(doc).find(b => b.el.matches(selector))!
    return { 成块: !!block, 行内: shouldInline(block as TextBlock) }
  }

  it('文档副标题排除在外：压成 inline-block 会从居中变成左贴边', () => {
    // 真实页面实测（2609.00246）：block + text-align:center，占满 800px 栏宽、文本居中在 x≈720；
    // 改成 inline-block 后盒子只剩 176px、落在 l=320，因为 <article> 是 text-align: start
    const html = '<h1 class="ltx_title ltx_title_document">Main</h1><h2 class="ltx_subtitle">(Extended Version)</h2>'
    expect(inlineOf(html, '.ltx_subtitle')).toEqual({ 成块: true, 行内: false })
  })

  it('文档标题同样排除（原有行为）', () => {
    expect(inlineOf('<h1 class="ltx_title ltx_title_document">Main title</h1>', '.ltx_title_document')).toEqual({ 成块: true, 行内: false })
  })

  it('章节的 run-in 短标题照旧同行：副标题的排除不能误伤它们', () => {
    const html = '<h2 class="ltx_title ltx_title_section">Introduction</h2>'
    expect(inlineOf(html, '.ltx_title_section')).toEqual({ 成块: true, 行内: true })
  })
})

describe('译文与原文相同就标出来（Codex 在 #74 指出）', () => {
  const render = (original: string, translated: string) => {
    const doc = docOf(`<p class="ltx_p" id="p">${original}</p>`)
    const block = extract(doc)[0] as TextBlock
    return renderText(block, frag(doc, translated))
  }

  it('逐字相同：打上 data-axt-identity', () => {
    // 默认提示词让模型保留人名，纯人名的引文作者段就是这样原样回来的
    expect(render('Doe, J., and Roe, R.', 'Doe, J., and Roe, R.').hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('只有空白不同也算相同：rehydrate 回填时标签边界的空白与原文未必一一对应', () => {
    expect(render('Doe,  J.\n and Roe, R.', 'Doe, J. and Roe, R.').hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('内层块先翻完，不影响外层的恒等判定（Codex 在 #81 指出）', () => {
    // 块可以嵌套（致谢里含标题、段落里含脚注正文）。run.ts 并发处理批次，内层可能先到，
    // 那时原块的 textContent 里多出一段内层译文，而候选译文那边 stripCloned 已经删掉了它
    const doc = docOf('<div class="ltx_acknowledgements" id="outer">Thanks to <h6 class="ltx_title" id="inner">Acknowledgements</h6></div>')
    const blocks = extract(doc)
    const inner = doc.getElementById('inner')!
    const innerBlock = blocks.find(b => b.el === inner) as TextBlock
    const outerBlock = blocks.find(b => b.el === doc.getElementById('outer')) as TextBlock
    // 内层先完成：它的译文被插进了外层原块内部
    renderText(innerBlock, frag(doc, '致谢'))
    expect(doc.getElementById('outer')!.textContent).toContain('致谢')
    // 外层原样返回（提示词让模型保留专名）——排除注入节点后两边应当一致
    const outerT = renderText(outerBlock, frag(doc, 'Thanks to <h6 class="ltx_title">Acknowledgements</h6>'))
    expect(outerT.hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('真的翻了就不打标记', () => {
    expect(render('The quick brown fox.', '敏捷的棕色狐狸。').hasAttribute(IDENTITY_ATTR)).toBe(false)
  })

  it('只差一个字也不算相同', () => {
    expect(render('Doe, J., and Roe, R.', 'Doe, J., and Roe, S.').hasAttribute(IDENTITY_ATTR)).toBe(false)
  })
})

