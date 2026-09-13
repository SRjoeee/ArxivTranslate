import { describe, expect, it } from 'vitest'
import { cloneWithoutIds } from '@/core/protector/clone'

const docOf = (body: string) =>
  new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html')

describe('cloneWithoutIds', () => {
  it('strips its own id and the subtree\'s, other attributes kept', () => {
    const doc = docOf('<span id="s" class="ltx_note" data-keep="1"><a id="a" href="/x">链接</a></span>')
    const clone = cloneWithoutIds(doc, doc.getElementById('s')!, true) as Element
    expect(clone.hasAttribute('id')).toBe(false)
    expect(clone.querySelector('[id]')).toBeNull()
    expect(clone.getAttribute('data-keep')).toBe('1')
    expect(clone.querySelector('a')?.getAttribute('href')).toBe('/x')
  })

  it('strips the data-axt-* marks', () => {
    const doc = docOf('<span class="ltx_note" data-axt-id="b1" data-axt-state="translated"><em data-axt-id="b2">x</em></span>')
    const clone = cloneWithoutIds(doc, doc.querySelector('.ltx_note')!, true) as Element
    expect(clone.hasAttribute('data-axt-id')).toBe(false)
    expect(clone.hasAttribute('data-axt-state')).toBe(false)
    expect(clone.querySelector('[data-axt-id]')).toBeNull()
  })

  it('deletes translation nodes already in the clone: translating the footnote before the outer paragraph does not copy the footnote translation in', () => {
    const doc = docOf(
      '<span class="ltx_note"><span class="ltx_note_content" data-axt-id="n1">Footnote.</span>'
      + '<span class="axt-t" data-axt-for="n1">脚注。</span></span>',
    )
    const clone = cloneWithoutIds(doc, doc.querySelector('.ltx_note')!, true) as Element
    expect(clone.querySelectorAll('.axt-t')).toHaveLength(0)
    expect(clone.textContent).toBe('Footnote.')
    // The original node is unaffected
    expect(doc.querySelectorAll('.axt-t')).toHaveLength(1)
  })

  it('SVG local references stay in the clone, the definitions on the original — valid only because both share one coordinate system (§15.6, independent audit B16)', () => {
    // LaTeXML's TikZ figures clip with `<clipPath id>` + `clip-path="url(#id)"` (dozens per paper).
    // With the clone's ids stripped the references look dangling, but they are not: `url(#…)` resolves **document-wide**, the clone's
    // references land on the original's definitions, and both share one user coordinate system, so the result is the same. This test guards exactly that premise —
    // the day the original gets its ids stripped too, or the clone is moved into another document, it goes red first
    const doc = docOf('<p class="ltx_p">图 <svg id="fig"><defs><clipPath id="clip"><rect width="10" height="10"/></clipPath>'
      + '<path id="glyph" d="M0 0H8V8H0Z"/></defs><use href="#glyph"/><rect clip-path="url(#clip)" width="20" height="20"/></svg> 在此。</p>')
    const svg = doc.getElementById('fig')!
    const clone = cloneWithoutIds(doc, svg, true) as Element
    // The clone: the references are still there, the definitions' ids are gone
    expect(clone.querySelector('use')!.getAttribute('href')).toBe('#glyph')
    expect(clone.querySelector('rect[clip-path]')!.getAttribute('clip-path')).toBe('url(#clip)')
    expect(clone.querySelector('[id]')).toBeNull()
    // The original: not one id missing, so the clone's references have somewhere to land
    expect(doc.getElementById('clip')).not.toBeNull()
    expect(doc.getElementById('glyph')).not.toBeNull()
  })

  it('a shallow clone carries no subtree', () => {
    const doc = docOf('<span class="ltx_text" id="s">外<em>内</em></span>')
    const clone = cloneWithoutIds(doc, doc.getElementById('s')!, false) as Element
    expect(clone.childNodes).toHaveLength(0)
    expect(clone.hasAttribute('id')).toBe(false)
  })
})
