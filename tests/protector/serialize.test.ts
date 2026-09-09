import { describe, expect, it } from 'vitest'
import { VOID_DENSE_THRESHOLD, serialize } from '@/core/protector'
import { el } from './helpers'

describe('serialize', () => {
  it('paragraphs mixing void slots, paired slots, and text', () => {
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph ltx_font_italic">bold</em> per <a class="ltx_ref" href="#S2">Section 2</a>.</p>')
    const b = serialize(p)
    expect(b.text).toBe('Let <x id="1"/> be <t id="2">bold</t> per <x id="3"/>.')
    expect([...b.paired]).toEqual([2])
    expect(b.voidCount).toBe(2)
    expect(b.slots.get(1)).toBe(p.querySelector('math'))
    expect(b.slots.get(2)).toBe(p.querySelector('em'))
    expect(b.slots.get(3)).toBe(p.querySelector('a'))
  })

  it('supports nested paired slots', () => {
    const p = el('<p class="ltx_p"><span class="ltx_text ltx_font_bold">A <span class="ltx_text ltx_font_italic">B</span> C</span></p>')
    expect(serialize(p).text).toBe('<t id="1">A <t id="2">B</t> C</t>')
  })

  it('escapes & < > while preserving thin spaces and nonbreaking spaces', () => {
    const p = el('<p class="ltx_p">a &lt; b &amp; c <math class="ltx_Math"><mi>x</mi></math> d e &gt; f</p>')
    expect(serialize(p).text).toBe('a &lt; b &amp; c <x id="1"/> d e &gt; f')
  })

  it('nested units and footnote containers are void even inside paired slots', () => {
    const p = el(
      '<p class="ltx_p">Text<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup>'
      + '<span class="ltx_note_outer"><span class="ltx_note_content">Note.</span></span></span>'
      + ' and <span class="ltx_inline-block"><span class="ltx_p">inner</span></span>.</p>',
    )
    const b = serialize(p)
    expect(b.text).toBe('Text<x id="1"/> and <t id="2"><x id="3"/></t>.')
    expect(b.voidCount).toBe(2)
    expect([...b.paired]).toEqual([2])
  })

  it('textless elements are void', () => {
    const p = el('<p class="ltx_p">a<span class="ltx_rule"></span>b<img class="ltx_graphics" alt="">c<br>d</p>')
    expect(serialize(p).text).toBe('a<x id="1"/>b<x id="2"/>c<x id="3"/>d')
  })

  it('cite, tag, monospace text, and conversion errors are void', () => {
    const p = el('<p class="ltx_p"><cite class="ltx_cite">[1]</cite> <span class="ltx_tag">(a)</span> <span class="ltx_text ltx_font_typewriter">x</span> <span class="ltx_ERROR">\\foo</span></p>')
    expect(serialize(p).text).toBe('<x id="1"/> <x id="2"/> <x id="3"/> <x id="4"/>')
  })

  it('does not mutate the DOM', () => {
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em>b</em>.</p>')
    const before = p.outerHTML
    serialize(p)
    expect(p.outerHTML).toBe(before)
  })

  it('formula-density threshold', () => {
    expect(VOID_DENSE_THRESHOLD).toBe(40)
  })

  it('table cells are block segments: their ltx_p children are traversed as paired slots, not void (2410.00260 Table 1, Codex #5)', () => {
    const td = el('<table><tbody><tr><td class="ltx_td"><span class="ltx_inline-block"><span class="ltx_p">Choices <math class="ltx_Math"><mi>x</mi></math></span></span></td></tr></tbody></table>').querySelector('.ltx_td')!
    const b = serialize(td)
    expect(b.text).toBe('<t id="1"><t id="2">Choices <x id="3"/></t></t>')
    expect([...b.paired]).toEqual([1, 2])
  })

  it('nested tables remain void because inner cells are separate segments; empty ltx_p elements are also void', () => {
    const td = el('<table><tbody><tr><td class="ltx_td">Outer<table class="ltx_tabular"><tbody><tr><td class="ltx_td">Alpha</td></tr></tbody></table><span class="ltx_p"></span></td></tr></tbody></table>').querySelector('td')!
    expect(serialize(td).text).toBe('Outer<x id="1"/><x id="2"/>')
  })

  it('skips existing translations and mirrors in originals without allocating slots (Codex #8)', () => {
    const li = el('<li class="ltx_item">Lead <p class="ltx_p">inner</p><p class="ltx_p axt-t">译文</p><span class="axt-t axt-mirror">mirror text</span></li>')
    const b = serialize(li)
    expect(b.text).toBe('Lead <x id="1"/>')
    expect(b.slots.size).toBe(1)
  })
})
