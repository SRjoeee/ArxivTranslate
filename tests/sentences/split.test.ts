import { describe, expect, it } from 'vitest'
import { sentenceCuts, splitSentences } from '@/core/sentences'

const parts = (text: string) => {
  const out: string[] = []
  let at = 0
  for (const len of splitSentences(text)) {
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
    expect(sentenceCuts('Let @a# denote the loss. Then @b# converges.')).toEqual(['Let @a# denote the loss. '.length])
  })

  it('keeps placeholders inside the sentence they belong to', () => {
    expect(parts('Let @a# denote the loss. Then @b# converges.')).toEqual(['Let @a# denote the loss. ', 'Then @b# converges.'])
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
    expect(parts('Let @a# denote it. Then @b# converges.')).toEqual(['Let @a# denote it. ', 'Then @b# converges.'])
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
