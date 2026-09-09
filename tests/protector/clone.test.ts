import { describe, expect, it } from 'vitest'
import { cloneWithoutIds } from '@/core/protector/clone'

const docOf = (body: string) =>
  new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html')

describe('cloneWithoutIds', () => {
  it('strips IDs from the root and subtree while preserving other attributes', () => {
    const doc = docOf('<span id="s" class="ltx_note" data-keep="1"><a id="a" href="/x">链接</a></span>')
    const clone = cloneWithoutIds(doc, doc.getElementById('s')!, true) as Element
    expect(clone.hasAttribute('id')).toBe(false)
    expect(clone.querySelector('[id]')).toBeNull()
    expect(clone.getAttribute('data-keep')).toBe('1')
    expect(clone.querySelector('a')?.getAttribute('href')).toBe('/x')
  })

  it('strips data-axt-* markers', () => {
    const doc = docOf('<span class="ltx_note" data-axt-id="b1" data-axt-state="translated"><em data-axt-id="b2">x</em></span>')
    const clone = cloneWithoutIds(doc, doc.querySelector('.ltx_note')!, true) as Element
    expect(clone.hasAttribute('data-axt-id')).toBe(false)
    expect(clone.hasAttribute('data-axt-state')).toBe(false)
    expect(clone.querySelector('[data-axt-id]')).toBeNull()
  })

  it('removes existing translated nodes from clones so translating an outer paragraph cannot duplicate a previously translated footnote', () => {
    const doc = docOf(
      '<span class="ltx_note"><span class="ltx_note_content" data-axt-id="n1">Footnote.</span>'
      + '<span class="axt-t" data-axt-for="n1">脚注。</span></span>',
    )
    const clone = cloneWithoutIds(doc, doc.querySelector('.ltx_note')!, true) as Element
    expect(clone.querySelectorAll('.axt-t')).toHaveLength(0)
    expect(clone.textContent).toBe('Footnote.')
    // leaves the original node unchanged
    expect(doc.querySelectorAll('.axt-t')).toHaveLength(1)
  })

  it('shallow clones have no subtree', () => {
    const doc = docOf('<span class="ltx_text" id="s">外<em>内</em></span>')
    const clone = cloneWithoutIds(doc, doc.getElementById('s')!, false) as Element
    expect(clone.childNodes).toHaveLength(0)
    expect(clone.hasAttribute('id')).toBe(false)
  })
})
