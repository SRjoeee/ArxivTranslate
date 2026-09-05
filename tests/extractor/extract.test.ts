import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type Block } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { classify } from '@/core/rules/latexml'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
type TableBlock = Extract<Block, { kind: 'table' }>

/** 把片段放进翻译根里解析 */
function docOf(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body><article class="ltx_document">${body}</article></body></html>`,
    'text/html',
  )
}

describe('extract：文本块', () => {
  it('单段落成一块，id 用元素自带 id', () => {
    const blocks = extract(docOf('<div class="ltx_para" id="S1.p1"><p class="ltx_p" id="S1.p1.1">Hello world.</p></div>'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'S1.p1.1', kind: 'text', unit: 'p' })
  })

  it('只含公式、数字或编号的段落不成块', () => {
    expect(extract(docOf('<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math> = 1</p>'))).toHaveLength(0)
    expect(extract(docOf('<p class="ltx_p">(12)</p>'))).toHaveLength(0)
  })

  it('段落内脚注：段落在前、脚注正文在后；脚注无 id 时按块序编号', () => {
    const blocks = extract(docOf(
      '<p class="ltx_p" id="p1">Text<span class="ltx_note ltx_role_footnote" id="footnote1"><sup class="ltx_note_mark">1</sup>'
      + '<span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Note body.</span></span></span> more.</p>',
    ))
    expect(blocks.map(b => [b.id, b.unit])).toEqual([['p1', 'p'], ['axt-b2', 'footnote']])
  })

  it('致谢块内的标题是嵌套单元：两块各自独立', () => {
    const blocks = extract(docOf('<div class="ltx_acknowledgements" id="ack"><h6 class="ltx_title">Acknowledgements</h6>We thank everyone.</div>'))
    expect(blocks.map(b => b.unit)).toEqual(['ack', 'title'])
  })

  it('外层单元没有自有文本时只有内层成块', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="outer"><span class="ltx_inline-block"><span class="ltx_p" id="inner">Inner text.</span></span></p>'))
    expect(blocks.map(b => b.id)).toEqual(['inner'])
  })

  it('代码块内的段落不成块', () => {
    expect(extract(docOf('<div class="ltx_listing"><p class="ltx_p">not a block</p></div>'))).toHaveLength(0)
  })

  it('段落内的转换错误不影响段落成块', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="p1">Some <span class="ltx_ERROR undefined">\\foo</span> text.</p>'))
    expect(blocks.map(b => b.id)).toEqual(['p1'])
  })

  it('找不到翻译根返回空数组', () => {
    const doc = new DOMParser().parseFromString('<html><body><p class="ltx_p">x</p></body></html>', 'text/html')
    expect(extract(doc)).toEqual([])
  })
})

describe('extract：表格块', () => {
  const table =
    '<table class="ltx_tabular" id="T1"><thead><tr><th class="ltx_td ltx_th">Model</th><th class="ltx_td ltx_th">Acc (%)</th></tr></thead>'
    + '<tbody><tr><td class="ltx_td">Baseline</td><td class="ltx_td">91.2 ± 0.3</td></tr>'
    + '<tr><td class="ltx_td"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_td">✓</td></tr>'
    + '<tr><td class="ltx_td"><p class="ltx_p" id="cellp">A sentence in a cell.</p></td><td class="ltx_td"></td></tr></tbody></table>'

  it('整张表是一个块，单元格带数值标记，表内段落不成块', () => {
    const blocks = extract(docOf(table))
    expect(blocks).toHaveLength(1)
    const t = blocks[0] as TableBlock
    expect(t).toMatchObject({ id: 'T1', kind: 'table', unit: 'table' })
    expect(t.cells.map(c => c.numeric)).toEqual([false, false, false, true, true, true, false, true])
  })

  it('没有任何含字母单元格的表（空排版表、纯公式表）不成块', () => {
    expect(extract(docOf('<div class="ltx_para"><table class="ltx_tabular"><tbody><tr><td class="ltx_td"></td></tr></tbody></table></div>'))).toHaveLength(0)
    expect(extract(docOf(
      '<table class="ltx_tabular"><tbody><tr><td class="ltx_td"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_td">1.5</td></tr></tbody></table>',
    ))).toHaveLength(0)
    expect(extract(docOf('<table class="ltx_tabular"><tbody><tr><td class="ltx_td">?</td><td class="ltx_td">1</td></tr></tbody></table>'))).toHaveLength(0)
  })

  it('嵌套 tabular 只产出最外层块，内层单元格也是外层块的格（§5.3）', () => {
    const nested =
      '<table class="ltx_tabular" id="outer"><tbody><tr><td class="ltx_td">Outer cell'
      + '<table class="ltx_tabular" id="inner"><tbody><tr><td class="ltx_td">Alpha</td><td class="ltx_td">2</td></tr></tbody></table>'
      + '</td></tr></tbody></table>'
    const blocks = extract(docOf(nested))
    expect(blocks.map(b => b.id)).toEqual(['outer'])
    const cells = (blocks[0] as TableBlock).cells
    expect(cells.map(c => c.el.className)).toEqual(['ltx_td', 'ltx_td', 'ltx_td'])
    expect(cells.map(c => c.numeric)).toEqual([false, false, true])
  })

  it('只装着嵌套表的外层格没有自有文本，按数值格原样复制；内层格的文字才是要翻的（实测 2410.00260 表 3）', () => {
    const nested =
      '<table class="ltx_tabular" id="outer"><tbody><tr><td class="ltx_td">'
      + '<table class="ltx_tabular" id="inner"><tbody><tr><td class="ltx_td">Alpha</td></tr></tbody></table>'
      + '</td></tr></tbody></table>'
    const cells = (extract(docOf(nested))[0] as TableBlock).cells
    expect(cells.map(c => c.numeric)).toEqual([true, false])
  })

  it('再次提取时原块内已有的译文 / 镜像不算原文（Codex 在 #8 指出）', () => {
    const blocks = extract(docOf('<li class="ltx_item"><span class="ltx_tag">1.</span><span class="axt-t axt-mirror">mirror text</span><p class="ltx_p">Inner.</p><p class="ltx_p axt-t">译文</p></li>'))
    // 列表项的自有文本只有镜像里的字，剔除后没有字母，不成块；段落照常成块
    expect(blocks.map(b => b.unit)).toEqual(['p'])
  })
})

describe('extract：id', () => {
  it('无 id 的块按块序编号', () => {
    const blocks = extract(docOf('<h2 class="ltx_title">Intro</h2><p class="ltx_p" id="p1">Text.</p><figcaption class="ltx_caption">Figure caption</figcaption>'))
    expect(blocks.map(b => b.id)).toEqual(['axt-b1', 'p1', 'axt-b3'])
  })

  it('重复 id 加后缀', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="dup">A.</p><p class="ltx_p" id="dup">B.</p><p class="ltx_p" id="dup">C.</p>'))
    expect(blocks.map(b => b.id)).toEqual(['dup', 'dup-2', 'dup-3'])
  })
})

describe('DOM 不变量', () => {
  const html =
    '<p class="ltx_p" id="p1">Text <a class="ltx_ref" href="#x">1</a>.</p>'
    + '<table class="ltx_tabular" id="T"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

  it('extract 不修改 DOM', () => {
    const doc = docOf(html)
    const before = doc.documentElement.outerHTML
    extract(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('markBlocks 只追加 data-axt-id', () => {
    const doc = docOf(html)
    const before = doc.documentElement.outerHTML
    markBlocks(extract(doc))
    expect(doc.querySelector('#p1')?.getAttribute('data-axt-id')).toBe('p1')
    expect(doc.querySelector('#T')?.getAttribute('data-axt-id')).toBe('T')
    expect(doc.documentElement.outerHTML.replace(/ data-axt-id="[^"]*"/g, '')).toBe(before)
  })
})

describe('fixture', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  for (const f of files) {
    it(f, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      const t0 = performance.now()
      const blocks = extract(doc)
      const ms = Math.round(performance.now() - t0)
      console.info(`[extract] ${f}: ${blocks.length} 块，${ms} ms`)
      expect(ms).toBeLessThan(5000)
      expect(blocks.length).toBeGreaterThan(0)

      const ids = blocks.map(b => b.id)
      expect(new Set(ids).size).toBe(ids.length)

      const tables = new Set(blocks.filter(b => b.kind === 'table').map(b => b.el))
      for (const b of blocks) {
        for (let el = b.el.parentElement; el; el = el.parentElement) {
          expect(classify(el)?.kind, `${b.id} 位于 skip 子树内`).not.toBe('skip')
          expect(tables.has(el), `${b.id} 位于表格块内`).toBe(false)
        }
      }

      expect({ ...statsOf(blocks), firstIds: ids.slice(0, 3), lastIds: ids.slice(-3) }).toMatchSnapshot()
    })
  }
})
