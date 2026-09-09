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

describe('哪些块该切句（§8.6）', () => {
  it('参考文献块一律不切', () => {
    // 切句器实测的精度明确不含参考文献：期刊缩写（`Sci. Rep. 14 (2024)`、`Theor. Comput. Sci.`）
    // 会切出假边界，而假边界把高亮打在半句上，比没有高亮更糟。模块文档写着调用方不得在那里
    // 运行它（Codex 在 #137 指出服务层把每个块都切了）
    const all = segmentsOf()
    const bib = all.filter(s => s.unit === 'bibblock' || s.unit === 'bibitem')
    expect(bib.length).toBeGreaterThan(20)
    expect(bib.filter(s => cutsOf(s.segment, 'tags') !== undefined)).toEqual([])
    // 而正文里确实有该切的
    expect(all.filter(s => s.unit === 'para' || s.unit === 'p').some(s => cutsOf(s.segment, 'tags') !== undefined)).toBe(true)
  })

  it('单句块给空数组，不该对齐的才给 undefined', () => {
    // 空数组说的是「这一块只有一句，整段对整段」——那是安全的对齐，而且单句块占正文一大半。
    // 与「这一块不该对齐」混为一谈，等于把它们全部排除在高亮之外（Codex 在 #137 指出）
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

  it('只有 tags 这条路切', () => {
    const one = segmentsOf().find(s => cutsOf(s.segment, 'tags') !== undefined)!
    expect(cutsOf(one.segment, 'runs')).toBeUndefined()
    expect(cutsOf(one.segment, 'markers')).toBeUndefined()
  })

  it('切点带上了块的上下文，而不是裸看线上文本', () => {
    // 服务层只有线上文本，分不清「注解」与「公式」，也看不到占位符后面藏着的句号；
    // 这一层有槽位，能把两者告诉切句器。**对比一下**：不带上下文时结果会变，
    // 否则这条接线等于没接（Codex 在 #137 指出服务层是裸调的）
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
