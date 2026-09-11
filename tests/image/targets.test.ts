import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { collectImageTargets } from '@/core/image'
import { IMG_CLASS, T_CLASS } from '@/core/marks'
import { docOf } from '../renderer/helpers'

// 图片翻译的目标（DESIGN §15.2）：翻译根内的位图，块内的与我们自己节点里的不算

describe('collectImageTargets', () => {
  it('2507.00150：6 张曲线图，id 取元素 id', () => {
    const doc = new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures/arxiv/2507.00150.html'), 'utf8'), 'text/html')
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    expect(targets).toHaveLength(6)
    expect(targets.map(t => t.id)).toEqual(['S2.F1.g1', 'S2.F2.g1', 'S4.F3.g1', 'S4.F4.g1', 'S4.F5.g1', 'S4.F6.g1'])
    expect(targets.every(t => t.el.tagName === 'IMG')).toBe(true)
  })

  it('块内的图不翻（它会随占位符克隆进译文、only 模式下原块整个隐藏），译文与叠加层里的也不算', () => {
    const doc = docOf(`<figure class="ltx_figure"><img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption" id="c">Cap</figcaption></figure>`
      + `<div class="ltx_para"><p class="ltx_p" id="p">Inline <img class="ltx_graphics" src="b.png"> here.</p></div>`
      + `<figure class="ltx_figure ${T_CLASS}"><img class="ltx_graphics" src="c.png"></figure>`
      + `<div class="${IMG_CLASS}"><img class="ltx_graphics" src="d.png"></div>`)
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    expect(targets).toHaveLength(1)
    expect(targets[0]!.el.getAttribute('src')).toBe('a.png')
    expect(targets[0]!.id).toBe('axt-img-1') // 没有 id 的图编号
  })

  it('内联 TikZ 图（§15.6）：带词的收，纯公式的不收，块内的照旧不收', () => {
    const node = (inner: string) =>
      `<foreignObject><span class="ltx_foreignobject_container"><span class="ltx_foreignobject_content">${inner}</span></span></foreignObject>`
    const math = '<math class="ltx_Math"><semantics><mrow>E1</mrow><annotation encoding="application/x-tex">E_1</annotation></semantics></math>'
    const doc = docOf(
      `<figure class="ltx_figure"><span class="ltx_inline-block"><svg id="words" class="ltx_picture">${node('Shared Expert')}</svg></span></figure>`
      + `<figure class="ltx_figure"><span class="ltx_inline-block"><svg id="formula" class="ltx_picture">${node(math)}</svg></span></figure>`
      + `<div class="ltx_para"><p class="ltx_p" id="p">Text <svg id="inline" class="ltx_picture">${node('Shared Expert')}</svg> more text.</p></div>`,
    )
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    expect(targets.map(t => t.id)).toEqual(['words'])
    expect(targets[0]!.kind).toBe('picture')
  })

  it('没有块标记时块内的图也会被收进来：调用方必须在标记写完之后再收', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p">Inline <img class="ltx_graphics" src="b.png"> here.</p></div>')
    expect(collectImageTargets(doc)).toHaveLength(1)
    markBlocks(extract(doc))
    expect(collectImageTargets(doc)).toHaveLength(0)
  })
})
