import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { cutsOf } from '@/core/pipeline/sentences'
import { serialize } from '@/core/protector'
import { sentenceCuts } from '@/core/sentences'
import type { Segment } from '@/core/pipeline/batches'
import { docOf } from '../renderer/helpers'

const FIXTURE = join(import.meta.dirname, '../fixtures/arxiv/2609.00246.html')

function segmentsOf(): { segment: Segment; unit: string }[] {
  const doc = new DOMParser().parseFromString(readFileSync(FIXTURE, 'utf8'), 'text/html')
  const blocks = extract(doc)
  markBlocks(blocks)
  const out: { segment: Segment; unit: string }[] = []
  for (const block of blocks) {
    if (block.kind !== 'text') continue
    const p = serialize(block.el, 'tags')
    out.push({ segment: { id: block.id, text: p.text, block, protected: p }, unit: (block as TextBlock).unit })
  }
  return out
}

describe('which blocks get sentence-cut (§8.6)', () => {
  it('reference blocks are never cut', () => {
    // The measured precision of the sentence cutter explicitly excludes references: journal abbreviations (`Sci. Rep. 14 (2024)`, `Theor. Comput. Sci.`)
    // cut false boundaries, and a false boundary puts the highlight on half a sentence, worse than no highlight. The module documentation says callers must not
    // run it there (Codex on #137: the service layer was cutting every block)
    const all = segmentsOf()
    const bib = all.filter(s => s.unit === 'bibblock' || s.unit === 'bibitem')
    expect(bib.length).toBeGreaterThan(20)
    expect(bib.filter(s => cutsOf(s.segment, 'tags') !== undefined)).toEqual([])
    // While the body text does have what should be cut
    expect(all.filter(s => s.unit === 'para' || s.unit === 'p').some(s => cutsOf(s.segment, 'tags') !== undefined)).toBe(true)
  })

  it('a single-sentence block gives an empty array; only what must not be aligned gives undefined', () => {
    // The empty array says “this block has one sentence, whole against whole” — a safe alignment, and single-sentence blocks are most of the body text.
    // Conflated with “this block must not be aligned”, they would all be excluded from the highlight (Codex on #137)
    const all = segmentsOf()
    const single = all.filter(s => s.unit !== 'bibblock' && s.unit !== 'bibitem' && cutsOf(s.segment, 'tags')?.length === 0)
    expect(single.length).toBeGreaterThan(20)
    const bib = all.find(s => s.unit === 'bibblock' || s.unit === 'bibitem')!
    expect(cutsOf(bib.segment, 'tags')).toBeUndefined()
  })

  it('a citation is content, not an annotation — it can be the subject of its sentence', () => {
    // Treating `.ltx_cite` as an annotation blanks it out, and the boundary in front of it goes with
    // it. Measured over 3430 fixture blocks: doing that loses 14 real boundaries and removes no
    // wrong ones. Both citation styles are represented — `\citet` writes the authors into the
    // sentence ("Schwarz and Erhard [25] show that …", 7 of the 14) and a plain `\cite` can open one
    // just as well ("Liao et al. (2023) proposed …", `[Str25a, Theorem 1.2] shows …`, 3 more) — which
    // is why the classification cannot be narrowed to `.ltx_citemacro_citet` either (Codex on #137
    // asked for both directions in turn).
    const cuts = (html: string) => {
      const doc = docOf(`<div class="ltx_para"><p class="ltx_p" id="x">${html}</p></div>`)
      const blocks = extract(doc)
      markBlocks(blocks)
      const block = blocks.find(b => b.kind === 'text' && b.el.id === 'x') as TextBlock
      const p = serialize(block.el, 'tags')
      return cutsOf({ id: block.id, text: p.text, block, protected: p }, 'tags')
    }
    expect(cuts('We prove it. <cite class="ltx_cite ltx_citemacro_citet">Smith et al.</cite> extend the result.')).toHaveLength(1)
    expect(cuts('They are unbound. <cite class="ltx_cite ltx_citemacro_cite">Liao et al. (2023)</cite> proposed a close encounter.')).toHaveLength(1)
    // …while a citation inside a sentence must not cut it in half
    expect(cuts('shown by Gopalan et\u00a0al. <cite class="ltx_cite ltx_citemacro_cite">[GHSY12]</cite>, which reduces to the bound.')).toHaveLength(0)
  })

  it('only the tags path cuts', () => {
    const one = segmentsOf().find(s => cutsOf(s.segment, 'tags') !== undefined)!
    expect(cutsOf(one.segment, 'runs')).toBeUndefined()
    expect(cutsOf(one.segment, 'markers')).toBeUndefined()
  })

  it('the cut points carry the block\'s context rather than looking at the bare wire text', () => {
    // The service layer has only the wire text, cannot tell an “annotation” from a “formula”, and cannot see the full stop hidden behind a placeholder;
    // this layer has the slots and can tell the cutter both. **Compare**: without the context the result changes,
    // or this wiring would amount to nothing (Codex on #137: the service layer was calling it bare)
    let differ = 0
    let compared = 0
    for (const { segment, unit } of segmentsOf()) {
      if (unit === 'bibblock' || unit === 'bibitem') continue
      const withContext = cutsOf(segment, 'tags')?.join(',') ?? ''
      const bare = sentenceCuts(segment.protected.text, 'tags').join(',')
      compared++
      if (withContext !== bare) differ++
    }
    expect(compared).toBeGreaterThan(50)
    expect(differ).toBeGreaterThan(0)
  })
})
