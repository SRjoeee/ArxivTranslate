// 说明行的译文（issue #152）：块是 `<tr>`，所以译文也得是 `<tr>`（§7.1），
// 而行里的内容必须装在单元格里——直接挂在 `<tr>` 下表格布局根本不排它。
import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { FOR_ATTR, SPLIT_ATTR, SPLIT_CLASS, T_CLASS, renderText, splitFigures } from '@/core/renderer'
import { docOf, frag } from './helpers'

const GROUP = `<table class="ltx_equationgroup ltx_eqn_table" id="E1"><tbody>
  <tr class="ltx_equation ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell ltx_align_right"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr>
  <tr class="ltx_eqn_row ltx_align_baseline" id="r1"><td class="ltx_eqn_cell ltx_align_left" style="white-space:normal;" colspan="5">where the mean curvature is</td></tr>
</tbody></table>`

const rowOf = (doc: Document) => (extract(doc) as TextBlock[]).find(b => b.unit === 'intertext')!

describe('说明行的译文', () => {
  it('译文是一行，内容装在原格的浅克隆里：colspan 与对齐都跟着走', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const node = renderText(rowOf(doc), frag(doc, '其中平均曲率为'))
    expect(node.tagName).toBe('TR')
    // 直接挂文本在 <tr> 下是无效的：内容必须在单元格里
    expect(node.children).toHaveLength(1)
    const cell = node.firstElementChild!
    expect(cell.tagName).toBe('TD')
    expect(cell.getAttribute('colspan')).toBe('5')
    expect(cell.className).toContain('ltx_align_left')
    expect(cell.textContent).toBe('其中平均曲率为')
  })

  it('照 §7.1 作原行的下一个兄弟，class 是原行的加 axt-t', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const block = rowOf(doc)
    const before = doc.querySelector('table')!.querySelectorAll('tr').length
    const node = renderText(block, frag(doc, '其中平均曲率为'))
    expect(node.previousElementSibling).toBe(block.el)
    expect(node.classList.contains(T_CLASS)).toBe(true)
    expect(node.classList.contains('ltx_eqn_row')).toBe(true)
    expect(node.getAttribute(FOR_ATTR)).toBe(block.id)
    // 多的是一行，不是一列
    expect(doc.querySelector('table')!.querySelectorAll('tr')).toHaveLength(before + 1)
    expect(block.el.children).toHaveLength(1)
  })

  it('普通段落不受影响：译文里没有凭空多出来的单元格', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div>')
    const block = (extract(doc) as TextBlock[])[0]!
    const node = renderText(block, frag(doc, '文本。'))
    expect(node.tagName).toBe('P')
    expect(node.querySelector('td')).toBeNull()
    expect(node.textContent).toBe('文本。')
  })
})

describe('含说明行的方程组整块拆两份', () => {
  // 现有版式是「公式在两栏各一份」（组被整块镜像）。说明行有了译文之后镜像就停了，
  // 若让整组通栏，读者会看见公式从两份变一份——所以走与插图同一条路：
  // 克隆一份、删掉每对的原文成员，左栏原组、右栏同一组配中文说明
  const translated = () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const block = rowOf(doc)
    markBlocks([block])
    renderText(block, frag(doc, '其中平均曲率为'))
    return doc
  }

  it('生成只有译文的副本，副本里原文那一行被摘掉', () => {
    const doc = translated()
    expect(splitFigures(doc)).toBe(1)
    const clone = doc.querySelector(`.${SPLIT_CLASS}`)!
    expect(clone.tagName).toBe('TABLE')
    expect(clone.previousElementSibling).toBe(doc.getElementById('E1'))
    // 副本里公式还在（它没有译文），英文说明没了，中文说明在
    expect(clone.querySelector('math')).not.toBeNull()
    expect(clone.textContent).not.toContain('where the mean curvature is')
    expect(clone.textContent).toContain('其中平均曲率为')
    // 原件打上标记，side 模式据此隐藏它内部的译文
    expect(doc.getElementById('E1')!.hasAttribute(SPLIT_ATTR)).toBe(true)
  })

  it('副本不带 id，不会与原件重复锚点', () => {
    const doc = translated()
    splitFigures(doc)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)!.querySelector('[id]')).toBeNull()
  })

  it('没有说明行的方程组不拆：它没有译文，照旧交给镜像', () => {
    const doc = docOf(`<div class="ltx_para"><table class="ltx_equationgroup ltx_eqn_table"><tbody>
      <tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell"><math class="ltx_Math"><mi>x</mi></math></td></tr>
    </tbody></table></div>`)
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
  })

  it('幂等：译文没变就不重建副本', () => {
    const doc = translated()
    expect(splitFigures(doc)).toBe(1)
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
  })
})
