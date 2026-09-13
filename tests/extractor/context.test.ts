// The paper-level context: title + abstract (the "Abstract" heading removed, truncated).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABSTRACT_MAX_CHARS, paperContext } from '@/core/extractor'

const load = (name: string) => new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures/arxiv', name), 'utf8'), 'text/html')

describe('paperContext', () => {
  it('a real paper: the title and the abstract body, the abstract without its "Abstract" heading', () => {
    const ctx = paperContext(load('2312.17141.html'))
    expect(ctx.paperTitle).toContain('Probabilistic Programming')
    expect(ctx.abstract).toBeTruthy()
    expect(ctx.abstract!.toLowerCase().startsWith('abstract')).toBe(false)
    expect(ctx.abstract!.length).toBeLessThanOrEqual(ABSTRACT_MAX_CHARS + 3)
  })

  it('a page without title or abstract returns an empty object, no undefined fields', () => {
    const doc = new DOMParser().parseFromString('<article class="ltx_document"><p class="ltx_p">x</p></article>', 'text/html')
    expect(paperContext(doc)).toEqual({})
  })

  it('an over-long abstract is truncated by words with an ellipsis', () => {
    const long = 'word '.repeat(600)
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6><p class="ltx_p">${long}</p></div></article>`, 'text/html')
    const { abstract } = paperContext(doc)
    expect(abstract!.length).toBeLessThanOrEqual(ABSTRACT_MAX_CHARS + 3)
    expect(abstract!.endsWith('...')).toBe(true)
  })

  it('formulas in the abstract take the presentation text only, without reading the TeX source in <annotation> once more (Codex on #28)', () => {
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6>
      <p class="ltx_p">Let <math><semantics><mi>x</mi><annotation encoding="application/x-tex">\\mathbf{x}</annotation></semantics></math> be.</p></div></article>`, 'text/html')
    expect(paperContext(doc).abstract).toBe('Let x be.')
  })

  it('publication metadata embedded in the title is no title (2507.00150 puts .ltx_pubnotes inside the document title)', () => {
    const doc = load('2507.00150.html')
    const notes = doc.querySelector('.ltx_title_document .ltx_pubnotes')
    expect(notes).not.toBeNull()
    const noteText = (notes!.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
    const { paperTitle } = paperContext(doc)
    expect(paperTitle).toBeTruthy()
    expect(paperTitle).not.toContain(noteText)
  })

  it('extracted again after translation, our injected translation does not leak into the abstract (Codex on #28)', () => {
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6>
      <p class="ltx_p" data-axt-id="a1">We study graphs.</p><p class="ltx_p axt-t" data-axt-for="a1">我们研究图。</p></div></article>`, 'text/html')
    expect(paperContext(doc).abstract).toBe('We study graphs.')
  })
})
