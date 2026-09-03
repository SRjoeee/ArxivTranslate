import { describe, expect, it } from 'vitest'
import { extract, type TableBlock } from '@/core/extractor'
import { FOR_ATTR, STATE_ATTR, T_CLASS, renderTable } from '@/core/renderer'
import { TABLE_RULES } from '@/core/rules/latexml'
import { docOf, frag } from './helpers'

const table =
  '<figure class="ltx_table" id="F1"><table class="ltx_tabular" id="T1"><tbody>'
  + '<tr><th class="ltx_td ltx_th" id="h1">Model</th><td class="ltx_td">91.2</td></tr>'
  + '<tr><td class="ltx_td">Baseline</td><td class="ltx_td"><math class="ltx_Math" id="m1"><mi>x</mi></math></td></tr>'
  + '</tbody></table><figcaption class="ltx_caption">Table 1</figcaption></figure>'

describe('renderTable', () => {
  it('整表克隆插在原表之后：非数值格替换为译文，数值格与公式格原样，克隆内无 id，原表未动', () => {
    const doc = docOf(table)
    const t = extract(doc).find(b => b.kind === 'table') as TableBlock
    const before = t.el.outerHTML
    const cells = new Map<Element, DocumentFragment>([
      [t.cells[0]!.el, frag(doc, '模型')],
      [t.cells[2]!.el, frag(doc, '基线')],
    ])
    const node = renderTable(t, cells)
    expect(node.tagName).toBe('TABLE')
    expect(node.classList.contains(T_CLASS)).toBe(true)
    expect(node.getAttribute(FOR_ATTR)).toBe('T1')
    expect(node.previousElementSibling).toBe(t.el)
    expect(node.querySelector('[id]')).toBeNull()
    const tds = Array.from(node.querySelectorAll(TABLE_RULES.cell))
    expect(tds.map(td => td.innerHTML)).toEqual(['模型', '91.2', '基线', '<math class="ltx_Math"><mi>x</mi></math>'])
    expect(t.el.outerHTML).toBe(before.replace('<table class="ltx_tabular" id="T1">', `<table class="ltx_tabular" id="T1" ${STATE_ATTR}="translated">`))
  })

  it('重复渲染只保留最新一份', () => {
    const doc = docOf(table)
    const t = extract(doc).find(b => b.kind === 'table') as TableBlock
    renderTable(t, new Map([[t.cells[0]!.el, frag(doc, '一')]]))
    renderTable(t, new Map([[t.cells[0]!.el, frag(doc, '二')]]))
    const clones = Array.from(doc.querySelectorAll(`.${T_CLASS}`))
    expect(clones).toHaveLength(1)
    expect(clones[0]?.querySelector(TABLE_RULES.cell)?.textContent).toBe('二')
  })
})
