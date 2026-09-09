// Paper context: title and truncated abstract, excluding the "Abstract" heading.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABSTRACT_MAX_CHARS, paperContext } from '@/core/extractor'

const load = (name: string) => new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures/arxiv', name), 'utf8'), 'text/html')

describe('paperContext', () => {
  it('extracts a real paper title and abstract body without the Abstract heading', () => {
    const ctx = paperContext(load('2312.17141.html'))
    expect(ctx.paperTitle).toContain('Probabilistic Programming')
    expect(ctx.abstract).toBeTruthy()
    expect(ctx.abstract!.toLowerCase().startsWith('abstract')).toBe(false)
    expect(ctx.abstract!.length).toBeLessThanOrEqual(ABSTRACT_MAX_CHARS + 3)
  })

  it('a page without a title or abstract returns an empty object without undefined fields', () => {
    const doc = new DOMParser().parseFromString('<article class="ltx_document"><p class="ltx_p">x</p></article>', 'text/html')
    expect(paperContext(doc)).toEqual({})
  })

  it('truncates long abstracts at word boundaries and adds an ellipsis', () => {
    const long = 'word '.repeat(600)
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6><p class="ltx_p">${long}</p></div></article>`, 'text/html')
    const { abstract } = paperContext(doc)
    expect(abstract!.length).toBeLessThanOrEqual(ABSTRACT_MAX_CHARS + 3)
    expect(abstract!.endsWith('...')).toBe(true)
  })

  it('reads only presentation text from abstract formulas, excluding TeX source in annotation (Codex #28)', () => {
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6>
      <p class="ltx_p">Let <math><semantics><mi>x</mi><annotation encoding="application/x-tex">\\mathbf{x}</annotation></semantics></math> be.</p></div></article>`, 'text/html')
    expect(paperContext(doc).abstract).toBe('Let x be.')
  })

  it('excludes publication metadata embedded in the title (2507.00150 nests ltx_pubnotes there)', () => {
    const doc = load('2507.00150.html')
    const notes = doc.querySelector('.ltx_title_document .ltx_pubnotes')
    expect(notes).not.toBeNull()
    const noteText = (notes!.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
    const { paperTitle } = paperContext(doc)
    expect(paperTitle).toBeTruthy()
    expect(paperTitle).not.toContain(noteText)
  })

  it('extracting after translation excludes injected translations from the abstract (Codex #28)', () => {
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6>
      <p class="ltx_p" data-axt-id="a1">We study graphs.</p><p class="ltx_p axt-t" data-axt-for="a1">我们研究图。</p></div></article>`, 'text/html')
    expect(paperContext(doc).abstract).toBe('We study graphs.')
  })
})
