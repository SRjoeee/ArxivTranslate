import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type Block } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { classify } from '@/core/rules/latexml'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
type TableBlock = Extract<Block, { kind: 'table' }>

/** Parse a fragment inside the translation root */
function docOf(body: string): Document {
  return new DOMParser().parseFromString(
    `<!doctype html><html><body><article class="ltx_document">${body}</article></body></html>`,
    'text/html',
  )
}

describe('extract: text blocks', () => {
  it('a paragraph produces one block using its element ID', () => {
    const blocks = extract(docOf('<div class="ltx_para" id="S1.p1"><p class="ltx_p" id="S1.p1.1">Hello world.</p></div>'))
    expect(blocks).toHaveLength(1)
    expect(blocks[0]).toMatchObject({ id: 'S1.p1.1', kind: 'text', unit: 'p' })
  })

  it('paragraphs containing only formulas, numbers, or labels produce no blocks', () => {
    expect(extract(docOf('<p class="ltx_p"><math class="ltx_Math"><mi>x</mi></math> = 1</p>'))).toHaveLength(0)
    expect(extract(docOf('<p class="ltx_p">(12)</p>'))).toHaveLength(0)
  })

  it('paragraphs precede their nested footnote bodies; footnotes without IDs use block-order numbering', () => {
    const blocks = extract(docOf(
      '<p class="ltx_p" id="p1">Text<span class="ltx_note ltx_role_footnote" id="footnote1"><sup class="ltx_note_mark">1</sup>'
      + '<span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>Note body.</span></span></span> more.</p>',
    ))
    expect(blocks.map(b => [b.id, b.unit])).toEqual([['p1', 'p'], ['axt-b2', 'footnote']])
  })

  it('a heading nested inside acknowledgements forms an independent block', () => {
    const blocks = extract(docOf('<div class="ltx_acknowledgements" id="ack"><h6 class="ltx_title">Acknowledgements</h6>We thank everyone.</div>'))
    expect(blocks.map(b => b.unit)).toEqual(['ack', 'title'])
  })

  it('only the inner unit forms a block when the outer unit has no text of its own', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="outer"><span class="ltx_inline-block"><span class="ltx_p" id="inner">Inner text.</span></span></p>'))
    expect(blocks.map(b => b.id)).toEqual(['inner'])
  })

  it('paragraphs inside code blocks produce no blocks', () => {
    expect(extract(docOf('<div class="ltx_listing"><p class="ltx_p">not a block</p></div>'))).toHaveLength(0)
  })

  it('conversion errors inside a paragraph do not prevent block extraction', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="p1">Some <span class="ltx_ERROR undefined">\\foo</span> text.</p>'))
    expect(blocks.map(b => b.id)).toEqual(['p1'])
  })

  it('returns an empty array when no translation root exists', () => {
    const doc = new DOMParser().parseFromString('<html><body><p class="ltx_p">x</p></body></html>', 'text/html')
    expect(extract(doc)).toEqual([])
  })
})

describe('extract: table blocks', () => {
  const table =
    '<table class="ltx_tabular" id="T1"><thead><tr><th class="ltx_td ltx_th">Model</th><th class="ltx_td ltx_th">Acc (%)</th></tr></thead>'
    + '<tbody><tr><td class="ltx_td">Baseline</td><td class="ltx_td">91.2 ± 0.3</td></tr>'
    + '<tr><td class="ltx_td"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_td">✓</td></tr>'
    + '<tr><td class="ltx_td"><p class="ltx_p" id="cellp">A sentence in a cell.</p></td><td class="ltx_td"></td></tr></tbody></table>'

  it('a whole table forms one block, cells carry numeric flags, and internal paragraphs form no blocks', () => {
    const blocks = extract(docOf(table))
    expect(blocks).toHaveLength(1)
    const t = blocks[0] as TableBlock
    expect(t).toMatchObject({ id: 'T1', kind: 'table', unit: 'table' })
    expect(t.cells.map(c => c.numeric)).toEqual([false, false, false, true, true, true, false, true])
  })

  it('tables without any cells containing letters (empty layout or formula-only tables) produce no blocks', () => {
    expect(extract(docOf('<div class="ltx_para"><table class="ltx_tabular"><tbody><tr><td class="ltx_td"></td></tr></tbody></table></div>'))).toHaveLength(0)
    expect(extract(docOf(
      '<table class="ltx_tabular"><tbody><tr><td class="ltx_td"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_td">1.5</td></tr></tbody></table>',
    ))).toHaveLength(0)
    expect(extract(docOf('<table class="ltx_tabular"><tbody><tr><td class="ltx_td">?</td><td class="ltx_td">1</td></tr></tbody></table>'))).toHaveLength(0)
  })

  it('nested tabular elements produce only the outermost block, including inner cells (§5.3)', () => {
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

  it('outer cells containing only a nested table have no own text and copy as numeric cells; inner text cells translate (2410.00260, Table 3)', () => {
    const nested =
      '<table class="ltx_tabular" id="outer"><tbody><tr><td class="ltx_td">'
      + '<table class="ltx_tabular" id="inner"><tbody><tr><td class="ltx_td">Alpha</td></tr></tbody></table>'
      + '</td></tr></tbody></table>'
    const cells = (extract(docOf(nested))[0] as TableBlock).cells
    expect(cells.map(c => c.numeric)).toEqual([true, false])
  })

  it('re-extraction excludes existing translations and mirrors from original text (Codex #8)', () => {
    const blocks = extract(docOf('<li class="ltx_item"><span class="ltx_tag">1.</span><span class="axt-t axt-mirror">mirror text</span><p class="ltx_p">Inner.</p><p class="ltx_p axt-t">译文</p></li>'))
    // A list item whose only own text is in a mirror has no letters after exclusion and forms no block; the paragraph still does.
    expect(blocks.map(b => b.unit)).toEqual(['p'])
  })
})

describe('extract: id', () => {
  it('numbers blocks without IDs in block order', () => {
    const blocks = extract(docOf('<h2 class="ltx_title">Intro</h2><p class="ltx_p" id="p1">Text.</p><figcaption class="ltx_caption">Figure caption</figcaption>'))
    expect(blocks.map(b => b.id)).toEqual(['axt-b1', 'p1', 'axt-b3'])
  })

  it('suffixes duplicate IDs', () => {
    const blocks = extract(docOf('<p class="ltx_p" id="dup">A.</p><p class="ltx_p" id="dup">B.</p><p class="ltx_p" id="dup">C.</p>'))
    expect(blocks.map(b => b.id)).toEqual(['dup', 'dup-2', 'dup-3'])
  })
})

describe('DOM invariants', () => {
  const html =
    '<p class="ltx_p" id="p1">Text <a class="ltx_ref" href="#x">1</a>.</p>'
    + '<table class="ltx_tabular" id="T"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table>'

  it('extract does not mutate the DOM', () => {
    const doc = docOf(html)
    const before = doc.documentElement.outerHTML
    extract(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('markBlocks only adds data-axt-id', () => {
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
      console.info(`[extract] ${f}: ${blocks.length} blocks, ${ms} ms`)
      expect(ms).toBeLessThan(5000)
      expect(blocks.length).toBeGreaterThan(0)

      const ids = blocks.map(b => b.id)
      expect(new Set(ids).size).toBe(ids.length)

      const tables = new Set(blocks.filter(b => b.kind === 'table').map(b => b.el))
      for (const b of blocks) {
        for (let el = b.el.parentElement; el; el = el.parentElement) {
          expect(classify(el)?.kind, `${b.id} lies inside a skipped subtree`).not.toBe('skip')
          expect(tables.has(el), `${b.id} lies inside a table block`).toBe(false)
        }
      }

      expect({ ...statsOf(blocks), firstIds: ids.slice(0, 3), lastIds: ids.slice(-3) }).toMatchSnapshot()
    })
  }
})
