// Send only the terms this passage uses (DESIGN §8.2). The pitfalls copy Read Frog's matcher lesson by lesson —
// they shipped two fixes for it, and the failure mode was always “the term is clearly configured yet quietly does nothing”.
import { describe, expect, it } from 'vitest'
import { createGlossaryMatcher, type GlossaryEntry } from '@/providers/glossary'

const entries = (...pairs: [string, string][]): GlossaryEntry[] => pairs.map(([term, translation]) => ({ term, translation }))
const terms = (list: GlossaryEntry[], text: string) => createGlossaryMatcher(list).match(text).map(e => e.term)

describe('createGlossaryMatcher', () => {
  it('picks out only the terms that really occur in the text', () => {
    const list = entries(['attention', '注意力'], ['kernel', '核'], ['manifold', '流形'])
    expect(terms(list, 'We revisit the attention mechanism over a learned kernel.')).toEqual(['attention', 'kernel'])
    expect(terms(list, 'Nothing relevant here.')).toEqual([])
  })

  it('the order follows the glossary, not the position of occurrence: the same set of terms must render to the same prompt, or the cache key fragments', () => {
    const list = entries(['attention', '注意力'], ['kernel', '核'])
    expect(terms(list, 'kernel then attention')).toEqual(['attention', 'kernel'])
    expect(terms(list, 'attention then kernel')).toEqual(['attention', 'kernel'])
  })

  it('word boundaries: net does not enter network, but network itself still matches', () => {
    const list = entries(['net', '网'], ['network', '网络'])
    expect(terms(list, 'a neural network layer')).toEqual(['network'])
    expect(terms(list, 'the net effect')).toEqual(['net'])
  })

  it('when a hit\'s boundary is wrong it keeps looking, not missing the real one further on (the lesson of Read Frog #2175)', () => {
    const list = entries(['net', '网'])
    // The first occurrence is inside network and must be skipped; the second is the real one
    expect(terms(list, 'network and then the net')).toEqual(['net'])
  })

  it('whitespace inside a term stands for any whitespace: a soft line break, two spaces and a no-break space on the page all count', () => {
    const list = entries(['neural network', '神经网络'])
    for (const text of ['a neural network', 'a neural  network', 'a neural\nnetwork', 'a neural network']) {
      expect([text, terms(list, text)]).toEqual([text, ['neural network']])
    }
    // A term typed with extra spaces has to work too (they were bitten: the term entered the index but never matched)
    expect(terms(entries(['neural   network', '神经网络']), 'a neural network')).toEqual(['neural   network'])
  })

  it('case-insensitive; both sides are NFC first, so combining and precomposed characters are the same word', () => {
    expect(terms(entries(['Transformer', '变换器']), 'a transformer block')).toEqual(['Transformer'])
    // The term in decomposed form (e + U+0301), the text in precomposed form (U+00E9): they look the same, and unnormalised they compare unequal
    const decomposed = 'cafe\u0301'
    expect(decomposed.normalize('NFC')).not.toBe(decomposed)
    expect(terms(entries([decomposed, '咖啡馆']), 'at the caf\u00e9 tonight')).toEqual([decomposed])
  })

  it('unspaced scripts need no word boundary: there are no spaces between Chinese characters anyway', () => {
    expect(terms(entries(['流形', 'manifold']), '这是一个流形结构')).toEqual(['流形'])
  })

  // Codex on #163: the target language table has a few more scriptio continua scripts, and without them a term never matches
  it('Khmer, Lao, Burmese and Tibetan are unspaced too and likewise need no word boundary', () => {
    // Each pair: the term + the term embedded in text of the same script
    const cases: [string, string][] = [
      ['ការបកប្រែ', 'នេះជាការបកប្រែដ៏ល្អ'], // // Khmer “translation”
      ['ການແປ', 'ນີ້ແມ່ນການແປທີ່ດີ'], // // Lao
      ['ဘာသာပြန်', 'ဤသည်ဘာသာပြန်ကောင်းသည်'], // // Burmese
      ['སྒྱུར', 'འདིསྒྱུརབཟང'], // // Tibetan
    ]
    for (const [term, text] of cases) {
      expect([term, terms(entries([term, 'x']), text)]).toEqual([term, [term]])
    }
  })

  it('a term ending in a symbol still matches: C++ followed by a full stop is no word-boundary problem', () => {
    expect(terms(entries(['C++', 'C++']), 'written in C++.')).toEqual(['C++'])
    expect(terms(entries(['(a)', '（a）']), 'panel (a) shows')).toEqual(['(a)'])
  })

  it('regex metacharacters match literally, not as a pattern', () => {
    expect(terms(entries(['O(n^2)', 'O(n²)']), 'costs O(n^2) time')).toEqual(['O(n^2)'])
  })

  it('an empty glossary and an empty term produce no match and throw nothing', () => {
    expect(createGlossaryMatcher([]).match('anything')).toEqual([])
    expect(createGlossaryMatcher(entries(['  ', 'x'])).size).toBe(0)
    expect(terms(entries(['attention', '注意力']), '')).toEqual([])
  })
})
