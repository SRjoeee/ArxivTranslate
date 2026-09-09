import { describe, expect, it } from 'vitest'
import { sentenceCuts, splitSentences } from '@/core/sentences'

const parts = (text: string, format?: 'tags' | 'markers', isAnnotation?: (id: number) => boolean) => {
  const out: string[] = []
  let at = 0
  for (const len of splitSentences(text, format, isAnnotation)) {
    out.push(text.slice(at, at + len))
    at += len
  }
  return out
}

describe('sentence splitting (#105)', () => {
  it('partitions the text exactly, which is what verifyAlignment requires', () => {
    // A splitter that lost or duplicated a character would be rejected downstream and produce no
    // highlight at all, so the exact partition is the contract, not a nicety.
    for (const text of ['One. Two. Three.', 'No boundary here', '', 'A. Turing proved it. Then more.']) {
      expect([text, splitSentences(text).reduce((a, b) => a + b, 0)]).toEqual([text, text.length])
      expect(parts(text).join('')).toBe(text)
    }
  })

  it('splits on real sentence ends', () => {
    expect(parts('One sentence. Two here. Three.')).toEqual(['One sentence. ', 'Two here. ', 'Three.'])
  })

  it('does not split journal abbreviations, the only failures measured', () => {
    // Both spurious cuts in the 60-block measurement were of this shape: `Sci. Rep. 14 (2024) 2387`.
    expect(sentenceCuts('See Sci. Rep. 14 (2024) 2387 for details.')).toEqual([])
    expect(sentenceCuts('We follow Phys. Rev. D conventions here.')).toEqual([])
  })

  it('does not split initials, e.g. or i.e.', () => {
    expect(sentenceCuts('Written by A. E. Brouwer in 1992.')).toEqual([])
    expect(sentenceCuts('Some methods, e.g. gradient descent, converge.')).toEqual([])
    expect(sentenceCuts('The bound is tight, i.e. it cannot improve.')).toEqual([])
  })

  it('does not split a decimal, because formulas are placeholders by this point', () => {
    // Running on wire text is what makes this safe: `f(x) = 0.5` has already become `@a# = 0.5`,
    // and even the bare decimal is not a boundary.
    expect(sentenceCuts('The error is 0.5 percent overall.')).toEqual([])
    expect(sentenceCuts('Let @a# denote the loss. Then @b# converges.', 'markers')).toEqual(['Let @a# denote the loss. '.length])
  })

  it('keeps placeholders inside the sentence they belong to', () => {
    expect(parts('Let @a# denote the loss. Then @b# converges.', 'markers')).toEqual(['Let @a# denote the loss. ', 'Then @b# converges.'])
  })

  it('sees a sentence end that sits against a paired placeholder', () => {
    // Google's preferred `tags` format wraps run-in headings as `<t id="1">Motivation.</t> …`.
    // Segmenting that markup directly, Intl.Segmenter sees `.` followed by `<` and reports no
    // boundary at all — and 2312.17527.html alone has 18 run-in headings (Codex on #126).
    const wire = '<t id="1">Motivation.</t> Concurrent programs are difficult.'
    // The cut lands after `</t> `, so the pair stays inside the sentence it wraps — cutting at the
    // period itself would leave the opening tag in one sentence and the closing tag in the next.
    expect(parts(wire)).toEqual(['<t id="1">Motivation.</t> ', 'Concurrent programs are difficult.'])
  })

  it('treats void placeholders and markers the same way', () => {
    // The trailing space goes with the sentence it ends, the same convention Microsoft's sentLen uses
    expect(parts('See <x id="1"/>. Next sentence here.')).toEqual(['See <x id="1"/>. ', 'Next sentence here.'])
    expect(parts('Let @a# denote it. Then @b# converges.', 'markers')).toEqual(['Let @a# denote it. ', 'Then @b# converges.'])
  })

  it('sees a sentence that opens on a formula and continues in lowercase', () => {
    // Projecting a void placeholder to whitespace made `@a# is continuous` read as a continuation of
    // the previous sentence, so the boundary vanished entirely — and formula-led sentences are
    // everywhere in paper prose (Codex on #126). Void runs stand for content, so they project to a
    // word; `<t>` tags stand for nothing and stay whitespace.
    expect(parts('The proof is complete. <x id="1"/> is continuous.'))
      .toEqual(['The proof is complete. ', '<x id="1"/> is continuous.'])
    expect(parts('The proof is complete. @a# is continuous.', 'markers'))
      .toEqual(['The proof is complete. ', '@a# is continuous.'])
  })

  it('does not let the void token be read as an initial', () => {
    // A single capital would match the initial rule in ABBR and merge the sentences instead
    expect(parts('It follows from <x id="1"/>. Then we conclude.'))
      .toEqual(['It follows from <x id="1"/>. ', 'Then we conclude.'])
  })

  it('treats an escaped @@ as the literal it is, not as a placeholder', () => {
    // Serialisation escapes a literal `@a#` as `@@a#`. Matching markers first reads the second `@`
    // as a placeholder and cuts ordinary text in half (Codex on #126).
    expect(parts('Done. @@a# is a literal.', 'markers')).toEqual(['Done. @@a# is a literal.'])
  })

  it('keeps a trailing footnote with the sentence it annotates, when told which slots are annotations', () => {
    // The wire text cannot tell these apart: `… method@a#. @b# We require …` is a footnote and
    // `… relation@a#. @b# Let @c# …` is a formula opening a sentence, and both read as
    // "punctuation, placeholder, capitalised word". Guessing from the following word's case failed
    // on both, so the caller answers from classify() instead (Codex on #126).
    const annotations = (id: number) => id === 1 || id === 2
    expect(parts('the method<x id="1"/>. <x id="2"/> We require more.', 'tags', annotations))
      .toEqual(['the method<x id="1"/>. <x id="2"/> ', 'We require more.'])
    // A formula in the same shape opens the sentence, and needs no case check to do so
    expect(parts('the relation <x id="1"/>. <x id="2"/> Let <x id="3"/> denote it.'))
      .toEqual(['the relation <x id="1"/>. ', '<x id="2"/> Let <x id="3"/> denote it.'])
    expect(parts('The proof is complete. <x id="1"/> is continuous.'))
      .toEqual(['The proof is complete. ', '<x id="1"/> is continuous.'])
    // A hyphenated formula opening a sentence needs no special case either
    expect(parts('do not depend on <x id="1"/> or <x id="2"/>. <x id="3"/>-admissible constants follow.'))
      .toEqual(['do not depend on <x id="1"/> or <x id="2"/>. ', '<x id="3"/>-admissible constants follow.'])
  })

  it('keeps an opening tag with the sentence it wraps', () => {
    // A cut landing just past `<t id="N">` leaves the opening tag on the previous sentence and its
    // content plus `</t>` on the next, splitting the pair across two (Codex on #126).
    expect(parts('One. <t id="1">Next</t> sentence.')).toEqual(['One. ', '<t id="1">Next</t> sentence.'])
  })

  it('reads placeholders according to the wire format', () => {
    // `escapeText` leaves a literal `@` alone on the tags path, so text shaped like `@a#` there is
    // ordinary content — reading it as a marker invents a boundary (Codex on #126).
    expect(parts('Done. @a# is a literal.', 'tags')).toEqual(['Done. @a# is a literal.'])
    expect(parts('Done. @@a# is a literal.', 'markers')).toEqual(['Done. @@a# is a literal.'])
    // A real marker on the markers path still opens a sentence
    expect(parts('The proof is complete. @a# is continuous.', 'markers'))
      .toEqual(['The proof is complete. ', '@a# is continuous.'])
  })

  it('keeps leading whitespace inside the pair it belongs to', () => {
    // The segmenter takes both the projected tag space and the content's own leading space as
    // trailing whitespace, landing the cut past the opening tag (Codex on #126).
    expect(parts('One. <t id="1"> Next</t> sentence.')).toEqual(['One. ', '<t id="1"> Next</t> sentence.'])
  })

  it('opens a sentence on a formula whatever punctuation follows it', () => {
    // A comma, a hyphen or anything else between the placeholder and the next word used to decide
    // the outcome, because the rule looked at that word's case (Codex on #126). It no longer does.
    expect(parts('The proof is complete. <x id="1"/>, however, is continuous.'))
      .toEqual(['The proof is complete. ', '<x id="1"/>, however, is continuous.'])
  })

  it('never cuts inside a placeholder, which would break the wire syntax', () => {
    const wire = '<t id="1">Motivation.</t> Concurrent work. See <x id="2"/>. Done here.'
    expect(sentenceCuts(wire).length).toBeGreaterThan(1)
    for (const cut of sentenceCuts(wire)) {
      // A cut must not land strictly inside any placeholder run
      for (const m of wire.matchAll(/<x\s+id="\d+"\/>|<\/?t(?:\s+id="\d+")?>|@[a-z]+#/g)) {
        const start = m.index ?? 0
        expect([cut, cut > start && cut < start + m[0].length]).toEqual([cut, false])
      }
    }
  })

  it('returns one length when there is no interior boundary', () => {
    expect(splitSentences('A single clause with no end')).toEqual([27])
    expect(sentenceCuts('A single clause with no end')).toEqual([])
  })
})
