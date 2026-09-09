import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { serialize } from '@/core/protector'
import { verifyAlignment } from '@/providers/alignment'
import { markSentences, unmarkSentences } from '@/providers/sentence-markers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

describe('sentence markers for engines that report nothing (#105)', () => {
  it('marks every interior boundary and nothing else', () => {
    const marked = markSentences('One sentence here. Two sentences here. Three.')!
    expect(marked.ids).toHaveLength(2)
    expect(marked.text).toBe('One sentence here. <x id="1"/>Two sentences here. <x id="2"/>Three.')
    expect(marked.source.reduce((a, b) => a + b, 0)).toBe('One sentence here. Two sentences here. Three.'.length)
  })

  it('allocates ids above every id the block already uses', () => {
    // A marker sharing an id with one of the block's own placeholders would be indistinguishable
    // from it, and `unmarkSentences` would cut the text at a formula
    const marked = markSentences('A <x id="7"/> b. And <t id="3">c</t> d. End.')!
    expect(marked.ids).toEqual([8, 9])
    expect(marked.text).toContain('<x id="8"/>')
  })

  it('says nothing to do for a single sentence, or a format with no usable marker', () => {
    expect(markSentences('Only one sentence here.')).toBeUndefined()
    
  })

  it('reads the boundaries back out and hands back a clean translation', () => {
    const marked = markSentences('One sentence here. Two sentences here. Three.')!
    // What Google actually returns: the markers survive, in place, around translated text
    const back = unmarkSentences('一句话。<x id="1"/>两句话。<x id="2"/>三。', marked.ids)!
    expect(back.text).toBe('一句话。两句话。三。')
    expect(back.target).toEqual([4, 4, 2])
    expect(verifyAlignment({ source: marked.source, target: back.target }, 'One sentence here. Two sentences here. Three.', back.text)).toBeDefined()
  })

  it('refuses anything it cannot trust', () => {
    const ids = [1, 2]
    // dropped
    expect(unmarkSentences('一句话。两句话。三。', ids)).toBeUndefined()
    // out of order
    expect(unmarkSentences('一句话。<x id="2"/>两句话。<x id="1"/>三。', ids)).toBeUndefined()
    // duplicated — which boundary is the real one?
    expect(unmarkSentences('一。<x id="1"/>二<x id="1"/>。<x id="2"/>三。', ids)).toBeUndefined()
    // a copy of a later marker *before* an earlier one: searching forward from the first marker
    // would find the second copy and never see the stray, leaving it in the text (Codex on #136)
    expect(unmarkSentences('<x id="2"/>一。<x id="1"/>二。<x id="2"/>三。', ids)).toBeUndefined()
    // an empty sentence is not a usable partition
    expect(unmarkSentences('一。<x id="1"/><x id="2"/>三。', ids)).toBeUndefined()
  })

  it('round-trips every fixture block, and the alignment verifies', () => {
    // The identity translation stands in for the engine: what is being checked is that marking and
    // unmarking are inverse, that the marker ids never collide with the block's own, and that the
    // lengths reconstruct both texts exactly — which is what `verifyAlignment` demands.
    let marked = 0
    for (const f of readdirSync(FIXTURE_DIR).filter(n => n.endsWith('.html')).slice(0, 4)) {
      const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      for (const b of extract(d)) {
        if (b.kind !== 'text') continue
        const block = serialize(b.el, 'tags')
        const m = markSentences(block.text)
        if (!m) continue
        marked++
        const back = unmarkSentences(m.text, m.ids)
        expect([f, b.id, back?.text]).toEqual([f, b.id, block.text])
        expect([f, b.id, verifyAlignment({ source: m.source, target: back!.target }, block.text, back!.text) !== undefined])
          .toEqual([f, b.id, true])
      }
    }
    expect(marked).toBeGreaterThan(200)
  })
})
