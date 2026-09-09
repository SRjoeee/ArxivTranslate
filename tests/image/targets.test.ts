import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { collectImageTargets } from '@/core/image'
import { IMG_CLASS, T_CLASS } from '@/core/marks'
import { docOf } from '../renderer/helpers'

// Image targets (DESIGN §15.2): bitmaps inside the translation root, excluding translation blocks and injected nodes.

describe('collectImageTargets', () => {
  it('2507.00150 has six plots whose IDs come from the elements', () => {
    const doc = new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures/arxiv/2507.00150.html'), 'utf8'), 'text/html')
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    expect(targets).toHaveLength(6)
    expect(targets.map(t => t.id)).toEqual(['S2.F1.g1', 'S2.F2.g1', 'S4.F3.g1', 'S4.F4.g1', 'S4.F5.g1', 'S4.F6.g1'])
    expect(targets.every(t => t.el.tagName === 'IMG')).toBe(true)
  })

  it('excludes images inside blocks (cloned through placeholders and hidden with originals in only mode), translations, and overlays', () => {
    const doc = docOf(`<figure class="ltx_figure"><img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption" id="c">Cap</figcaption></figure>`
      + `<div class="ltx_para"><p class="ltx_p" id="p">Inline <img class="ltx_graphics" src="b.png"> here.</p></div>`
      + `<figure class="ltx_figure ${T_CLASS}"><img class="ltx_graphics" src="c.png"></figure>`
      + `<div class="${IMG_CLASS}"><img class="ltx_graphics" src="d.png"></div>`)
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    expect(targets).toHaveLength(1)
    expect(targets[0]!.el.getAttribute('src')).toBe('a.png')
    expect(targets[0]!.id).toBe('axt-img-1') // numbers images without IDs
  })

  it('without block markers, images inside blocks are included; callers must mark blocks before collecting targets', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p">Inline <img class="ltx_graphics" src="b.png"> here.</p></div>')
    expect(collectImageTargets(doc)).toHaveLength(1)
    markBlocks(extract(doc))
    expect(collectImageTargets(doc)).toHaveLength(0)
  })
})
