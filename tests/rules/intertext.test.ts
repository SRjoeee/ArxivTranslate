// 方程组里的 `\intertext`（issue #152）：夹在公式之间的说明文字。
// LaTeXML 不把它渲染成 `<p>`，而是组表里整整一行的单元格，所以既要让提取器看见它，
// 又不能因此改变**别的**块发出去的内容——组对外层单元仍然是一个原子。
import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { serialize } from '@/core/protector'
import { EQN_PROSE_ROW, classify, eqnProseCell } from '@/core/rules/latexml'

/** 真实形状（抄自 2609.09360v1）：间隔行、公式行、说明行各一 */
const GROUP = `<table class="ltx_equationgroup ltx_eqn_table"><tbody>
  <tr class="ltx_eqn_row"><td class="ltx_eqn_cell" colspan="5"></td></tr>
  <tr class="ltx_equation ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell ltx_align_right"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr>
  <tr class="ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell ltx_align_left" style="white-space:normal;" colspan="5">In the Helfrich flow of <math class="ltx_Math"><mi>X</mi></math>, again the mean curvature</td></tr>
</tbody></table>`

const docOf = (body: string) =>
  new DOMParser().parseFromString(`<!doctype html><html><body><article class="ltx_document">${body}</article></body></html>`, 'text/html')

describe('说明行的识别', () => {
  it('说明行是块，边界是**行**而不是格', () => {
    const blocks = extract(docOf(`<div class="ltx_para">${GROUP}</div>`)) as TextBlock[]
    const rows = blocks.filter(b => b.unit === 'intertext')
    expect(rows).toHaveLength(1)
    // 行才对：译文作下一个兄弟（§7.1），格的兄弟是同一行的第二个格，两个 colspan 会把表撑出一倍的列
    expect(rows[0]!.el.tagName).toBe('TR')
    expect(rows[0]!.el.className).toContain('ltx_eqn_row')
  })

  it('公式行与间隔行都不成块', () => {
    const blocks = extract(docOf(`<div class="ltx_para">${GROUP}</div>`))
    // 公式行整块跳过；间隔行虽然匹配选择器，但格里没有字母，「有字母才成块」自然挡住
    expect(blocks.filter(b => b.el.tagName === 'TR')).toHaveLength(1)
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const spacer = doc.querySelector('tr.ltx_eqn_row:not(.ltx_align_baseline)')!
    expect(spacer.matches(EQN_PROSE_ROW)).toBe(true)
    expect(classify(spacer)?.kind).toBe('unit')
  })

  it('公式行仍然整块跳过，不下钻', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const eqn = doc.querySelector('tr.ltx_equation')!
    expect(classify(eqn)).toMatchObject({ kind: 'skip', descend: false })
  })

  it('说明行的正文只留下文字，公式与引用是占位符', () => {
    const blocks = extract(docOf(`<div class="ltx_para">${GROUP}</div>`)) as TextBlock[]
    const row = blocks.find(b => b.unit === 'intertext')!
    const wire = serialize(row.el, 'tags').text
    expect(wire).toContain('In the Helfrich flow of')
    expect(wire).toContain('again the mean curvature')
    // 行内公式是 void，不会被送去翻译
    expect(wire).toMatch(/<x id="\d+"\/>/)
    expect(wire).not.toContain('<math')
  })
})

describe('方程组对外层单元仍是一个原子', () => {
  // 12 篇 fixture 的 39 个方程组里有 5 个落在 `.ltx_item` 之类的单元内部。
  // 写成 skip 或漏掉 descend，那 5 个块发出去的内容就会变——把 `<table><tbody><tr>`
  // 当成对标签发给引擎，既多花 token 又给占位符协议添风险
  // 用 `.ltx_item`（<li>）而不是 `.ltx_p`：HTML 解析器不许 `<table>` 待在 `<p>` 里，会把段落提前关掉——
  // 实测那 5 个真实案例的容器正是 `.ltx_item`
  it('组在单元里时序列化成一个 void，而不是一串表格标签', () => {
    const doc = docOf(`<ul class="ltx_itemize"><li class="ltx_item">See the system ${GROUP} for details.</li></ul>`)
    const blocks = extract(doc) as TextBlock[]
    const para = blocks.find(b => b.unit === 'item')!
    const wire = serialize(para.el, 'tags').text
    expect(wire).toContain('See the system')
    expect(wire).toContain('for details.')
    // 整组一个 void：没有成对标签，也没有组里的任何文字
    expect(wire).not.toContain('<t id=')
    expect(wire).not.toContain('Helfrich')
    expect((wire.match(/<x id="\d+"\/>/g) ?? [])).toHaveLength(1)
  })

  // 嵌套的组里，说明行**不**成块：外层已经把整组当成一个 void 原子克隆进自己的译文了，
  // 说明行再单独成块，页面上就会出现两份——外层克隆里一份英文、组里一份中文——而且拆分
  // 还会在原件下面再生成一份（Codex 在 #168 指出）。脚注靠 localizeNotes 归位，方程组没有
  // 对应的一步，所以这里与改动前逐字节一致。实测 13 篇 fixture 的 5 个嵌套组一个都没有说明行
  it('组嵌在别的单元里时，说明行不成块（外层已经整组克隆过去了）', () => {
    const doc = docOf(`<ul class="ltx_itemize"><li class="ltx_item">See the system ${GROUP} for details.</li></ul>`)
    const units = (extract(doc) as TextBlock[]).map(b => b.unit)
    expect(units).toContain('item')
    expect(units).not.toContain('intertext')
  })

  it('组自己成块时照常下钻：说明行是独立的翻译单元', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    expect((extract(doc) as TextBlock[]).map(b => b.unit)).toContain('intertext')
  })

  it('分类是 protect + descend，与脚注同一个形状', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const group = doc.querySelector('table.ltx_equationgroup')!
    expect(classify(group)).toMatchObject({ kind: 'protect', descend: true })
  })
})

describe('eqnProseCell', () => {
  it('给出说明行里装正文的那个格，渲染层拿它的浅克隆当译文行的壳', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const row = doc.querySelector('tr.ltx_eqn_row:not(.ltx_equation).ltx_align_baseline')!
    const cell = eqnProseCell(row)
    expect(cell?.tagName).toBe('TD')
    expect(cell?.getAttribute('colspan')).toBe('5')
  })

  it('不是说明行就没有壳：公式行、段落都返回 null', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}<p class="ltx_p">text</p></div>`)
    expect(eqnProseCell(doc.querySelector('tr.ltx_equation')!)).toBeNull()
    expect(eqnProseCell(doc.querySelector('p.ltx_p')!)).toBeNull()
  })
})
