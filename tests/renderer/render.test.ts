import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR, IDENTITY_ATTR, INLINE_ATTR, STATE_ATTR } from '@/core/renderer/attrs'
import { shouldInline } from '@/core/renderer/shell'
import { renderText, setState } from '@/core/renderer/translation'
import { docOf, frag } from './helpers'

describe('renderText', () => {
  it('inserted as the next sibling: same tag, axt-t, data-axt-for; the original node gains data-axt-state only', () => {
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

  it('the tag name follows the original block: span.ltx_p → span, li.ltx_bibitem → li, figcaption.ltx_caption → figcaption', () => {
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

  it('the translation node copies the original block\'s class plus axt-t, inheriting the site style', () => {
    const doc = docOf('<h1 class="ltx_title ltx_title_document" id="t">Attention</h1>')
    const [b] = extract(doc) as TextBlock[]
    const node = renderText(b!, frag(doc, '注意力'))
    expect(node.className).toBe(`ltx_title ltx_title_document ${T_CLASS}`)
    expect(b!.el.className).toBe('ltx_title ltx_title_document')
  })

  it('a short heading shares the line: the original heading and the translation both get data-axt-inline; the document title, a long heading and an ordinary paragraph do not', () => {
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

  it('elements cloned into the translation carry no data-axt-*, and the translation node itself has no data-axt-id', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    setState(b!, 'pending')
    const node = renderText(b!, frag(doc, '你好<span class="ltx_note" data-axt-id="n1" data-axt-state="pending">x</span>'))
    expect(node.querySelector('[data-axt-id], [data-axt-state]')).toBeNull()
    expect(node.hasAttribute('data-axt-id')).toBe(false)
    expect(node.hasAttribute(STATE_ATTR)).toBe(false)
  })

  it('rendering the same block again keeps only the newest', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    renderText(b!, frag(doc, '第一版'))
    renderText(b!, frag(doc, '第二版'))
    const nodes = Array.from(doc.querySelectorAll(`.${T_CLASS}`))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.textContent).toBe('第二版')
    expect(nodes[0]?.previousElementSibling).toBe(b!.el)
  })

  it('setState writes on the original node', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    setState(b!, 'pending')
    expect(b!.el.getAttribute(STATE_ATTR)).toBe('pending')
    setState(b!, 'failed')
    expect(b!.el.getAttribute(STATE_ATTR)).toBe('failed')
  })
})

describe('the document title and subtitle are no inline candidates (Codex on #13)', () => {
  const inlineOf = (html: string, selector: string) => {
    const doc = docOf(html)
    const block = extract(doc).find(b => b.el.matches(selector))!
    return { block: !!block, inline: shouldInline(block as TextBlock) }
  }

  it('the document subtitle is excluded: squeezed into an inline-block it goes from centred to left-aligned', () => {
    // Measured on a real page (2609.00246): block + text-align:center, filling the 800px column, the text centred at x≈720;
    // as inline-block the box shrinks to 176px and lands at l=320, because <article> is text-align: start
    const html = '<h1 class="ltx_title ltx_title_document">Main</h1><h2 class="ltx_subtitle">(Extended Version)</h2>'
    expect(inlineOf(html, '.ltx_subtitle')).toEqual({ block: true, inline: false })
  })

  it('the document title is excluded likewise (existing behaviour)', () => {
    expect(inlineOf('<h1 class="ltx_title ltx_title_document">Main title</h1>', '.ltx_title_document')).toEqual({ block: true, inline: false })
  })

  it('a section\'s short run-in heading still shares the line: the subtitle\'s exclusion must not hit them', () => {
    const html = '<h2 class="ltx_title ltx_title_section">Introduction</h2>'
    expect(inlineOf(html, '.ltx_title_section')).toEqual({ block: true, inline: true })
  })
})

describe('a translation equal to its source is marked (Codex on #74)', () => {
  const render = (original: string, translated: string) => {
    const doc = docOf(`<p class="ltx_p" id="p">${original}</p>`)
    const block = extract(doc)[0] as TextBlock
    return renderText(block, frag(doc, translated))
  }

  it('equal byte for byte: marked data-axt-identity', () => {
    // The default prompt has the model keep names, and a reference's author paragraph of names alone comes back exactly like this
    expect(render('Doe, J., and Roe, R.', 'Doe, J., and Roe, R.').hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('differing only in whitespace counts as equal: the whitespace at tag boundaries after rehydration need not match the source one for one', () => {
    expect(render('Doe,  J.\n and Roe, R.', 'Doe, J. and Roe, R.').hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('an inner block finishing first does not affect the outer identity verdict (Codex on #81)', () => {
    // Blocks nest (a heading inside acknowledgements, a footnote body inside a paragraph). run.ts processes batches concurrently, and the inner one may arrive first;
    // the original block's textContent then holds an extra inner translation, while stripCloned already removed it from the candidate translation
    const doc = docOf('<div class="ltx_acknowledgements" id="outer">Thanks to <h6 class="ltx_title" id="inner">Acknowledgements</h6></div>')
    const blocks = extract(doc)
    const inner = doc.getElementById('inner')!
    const innerBlock = blocks.find(b => b.el === inner) as TextBlock
    const outerBlock = blocks.find(b => b.el === doc.getElementById('outer')) as TextBlock
    // The inner one finished first: its translation was inserted inside the outer original
    renderText(innerBlock, frag(doc, '致谢'))
    expect(doc.getElementById('outer')!.textContent).toContain('致谢')
    // The outer comes back as it was (the prompt has the model keep proper names) — with injected nodes excluded the two sides should agree
    const outerT = renderText(outerBlock, frag(doc, 'Thanks to <h6 class="ltx_title">Acknowledgements</h6>'))
    expect(outerT.hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('really translated: no mark', () => {
    expect(render('The quick brown fox.', '敏捷的棕色狐狸。').hasAttribute(IDENTITY_ATTR)).toBe(false)
  })

  it('one character apart is not equal either', () => {
    expect(render('Doe, J., and Roe, R.', 'Doe, J., and Roe, S.').hasAttribute(IDENTITY_ATTR)).toBe(false)
  })
})

