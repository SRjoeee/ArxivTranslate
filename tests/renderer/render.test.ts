import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { FOR_ATTR, IDENTITY_ATTR, INLINE_ATTR, STATE_ATTR, T_CLASS, renderText, setState, shouldInline } from '@/core/renderer'
import { docOf, frag } from './helpers'

describe('renderText', () => {
  it('inserts a same-tag next sibling with axt-t and data-axt-for; the original gains only data-axt-state', () => {
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

  it('follows original tag names for paragraphs, bibliography items, and captions', () => {
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

  it('copies original classes and adds axt-t to inherit site styles', () => {
    const doc = docOf('<h1 class="ltx_title ltx_title_document" id="t">Attention</h1>')
    const [b] = extract(doc) as TextBlock[]
    const node = renderText(b!, frag(doc, '注意力'))
    expect(node.className).toBe(`ltx_title ltx_title_document ${T_CLASS}`)
    expect(b!.el.className).toBe('ltx_title ltx_title_document')
  })

  it('short headings mark original and translation inline; document titles, long headings, and ordinary paragraphs do not', () => {
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

  it('cloned translation descendants have no data-axt-* attributes and the translation itself has no data-axt-id', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    setState(b!, 'pending')
    const node = renderText(b!, frag(doc, '你好<span class="ltx_note" data-axt-id="n1" data-axt-state="pending">x</span>'))
    expect(node.querySelector('[data-axt-id], [data-axt-state]')).toBeNull()
    expect(node.hasAttribute('data-axt-id')).toBe(false)
    expect(node.hasAttribute(STATE_ATTR)).toBe(false)
  })

  it('repeated rendering of a block keeps only the latest translation', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    renderText(b!, frag(doc, '第一版'))
    renderText(b!, frag(doc, '第二版'))
    const nodes = Array.from(doc.querySelectorAll(`.${T_CLASS}`))
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.textContent).toBe('第二版')
    expect(nodes[0]?.previousElementSibling).toBe(b!.el)
  })

  it('setState writes to the original node', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [b] = extract(doc) as TextBlock[]
    setState(b!, 'pending')
    expect(b!.el.getAttribute(STATE_ATTR)).toBe('pending')
    setState(b!, 'failed')
    expect(b!.el.getAttribute(STATE_ATTR)).toBe('failed')
  })
})

describe('document titles and subtitles are not inline candidates (Codex #13)', () => {
  const inlineOf = (html: string, selector: string) => {
    const doc = docOf(html)
    const block = extract(doc).find(b => b.el.matches(selector))!
    return { isBlock: !!block, inline: shouldInline(block as TextBlock) }
  }

  it('excludes document subtitles because inline-block would shift centered text to the left edge', () => {
    // Measured on 2609.00246: block with text-align:center fills the 800px column and centers text at x≈720;
    // inline-block shrinks to 176px at left=320 because article uses text-align:start.
    const html = '<h1 class="ltx_title ltx_title_document">Main</h1><h2 class="ltx_subtitle">(Extended Version)</h2>'
    expect(inlineOf(html, '.ltx_subtitle')).toEqual({ isBlock: true, inline: false })
  })

  it('also excludes document titles, preserving existing behavior', () => {
    expect(inlineOf('<h1 class="ltx_title ltx_title_document">Main title</h1>', '.ltx_title_document')).toEqual({ isBlock: true, inline: false })
  })

  it('short section run-in headings remain inline despite the subtitle exclusion', () => {
    const html = '<h2 class="ltx_title ltx_title_section">Introduction</h2>'
    expect(inlineOf(html, '.ltx_title_section')).toEqual({ isBlock: true, inline: true })
  })
})

describe('marks translations identical to originals (Codex #74)', () => {
  const render = (original: string, translated: string) => {
    const doc = docOf(`<p class="ltx_p" id="p">${original}</p>`)
    const block = extract(doc)[0] as TextBlock
    return renderText(block, frag(doc, translated))
  }

  it('exact identity sets data-axt-identity', () => {
    // The default prompt preserves names, so bibliography author blocks containing only names can return unchanged.
    expect(render('Doe, J., and Roe, R.', 'Doe, J., and Roe, R.').hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('whitespace-only differences still count as identity because rehydration can change spacing at tag boundaries', () => {
    expect(render('Doe,  J.\n and Roe, R.', 'Doe, J. and Roe, R.').hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('inner blocks completing first do not affect outer identity detection (Codex #81)', () => {
    // Blocks can nest, such as headings in acknowledgements or footnotes in paragraphs. Concurrent batches may finish inner blocks first,
    // adding translated text to the original textContent while stripCloned has already removed it from the candidate translation.
    const doc = docOf('<div class="ltx_acknowledgements" id="outer">Thanks to <h6 class="ltx_title" id="inner">Acknowledgements</h6></div>')
    const blocks = extract(doc)
    const inner = doc.getElementById('inner')!
    const innerBlock = blocks.find(b => b.el === inner) as TextBlock
    const outerBlock = blocks.find(b => b.el === doc.getElementById('outer')) as TextBlock
    // The inner block finishes first and inserts its translation inside the outer original.
    renderText(innerBlock, frag(doc, '致谢'))
    expect(doc.getElementById('outer')!.textContent).toContain('致谢')
    // The outer result preserves proper names; both sides should match once injected nodes are excluded.
    const outerT = renderText(outerBlock, frag(doc, 'Thanks to <h6 class="ltx_title">Acknowledgements</h6>'))
    expect(outerT.hasAttribute(IDENTITY_ATTR)).toBe(true)
  })

  it('real translations do not get the identity marker', () => {
    expect(render('The quick brown fox.', '敏捷的棕色狐狸。').hasAttribute(IDENTITY_ATTR)).toBe(false)
  })

  it('a one-character difference is not identity', () => {
    expect(render('Doe, J., and Roe, R.', 'Doe, J., and Roe, S.').hasAttribute(IDENTITY_ATTR)).toBe(false)
  })
})

