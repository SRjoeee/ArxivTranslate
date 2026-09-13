// `\intertext` inside equation groups (issue #152): explanatory text between formulas.
// LaTeXML renders it not as a `<p>` but as a full-row cell of the group's table, so the extractor has to see it
// without changing what **other** blocks send out — to the enclosing unit the group is still one atom.
import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { serialize } from '@/core/protector'
import { EQN_PROSE_ROW, classify, eqnProseCell } from '@/core/rules/latexml'
import { serialize as ser } from '@/core/protector'

/** The real shape (copied from 2609.09360v1): one spacer row, one formula row, one intertext row */
const GROUP = `<table class="ltx_equationgroup ltx_eqn_table"><tbody>
  <tr class="ltx_eqn_row"><td class="ltx_eqn_cell" colspan="5"></td></tr>
  <tr class="ltx_equation ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell ltx_align_right"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr>
  <tr class="ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell ltx_align_left" style="white-space:normal;" colspan="5">In the Helfrich flow of <math class="ltx_Math"><mi>X</mi></math>, again the mean curvature</td></tr>
</tbody></table>`

const docOf = (body: string) =>
  new DOMParser().parseFromString(`<!doctype html><html><body><article class="ltx_document">${body}</article></body></html>`, 'text/html')

describe('recognising the intertext row', () => {
  it('the intertext row is a block, and the boundary is the **row**, not the cell', () => {
    const blocks = extract(docOf(`<div class="ltx_para">${GROUP}</div>`)) as TextBlock[]
    const rows = blocks.filter(b => b.unit === 'intertext')
    expect(rows).toHaveLength(1)
    // The row is right: the translation is the next sibling (§7.1), and the cell's sibling would be a second cell in the same row, two colspans stretching the table to twice the columns
    expect(rows[0]!.el.tagName).toBe('TR')
    expect(rows[0]!.el.className).toContain('ltx_eqn_row')
  })

  it('neither the formula row nor the spacer row is a block', () => {
    const blocks = extract(docOf(`<div class="ltx_para">${GROUP}</div>`))
    // The formula row is skipped whole; the spacer row matches the selector, but the cell has no letters, and “a block needs letters” stops it by itself
    expect(blocks.filter(b => b.el.tagName === 'TR')).toHaveLength(1)
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const spacer = doc.querySelector('tr.ltx_eqn_row:not(.ltx_align_baseline)')!
    expect(spacer.matches(EQN_PROSE_ROW)).toBe(true)
    expect(classify(spacer)?.kind).toBe('unit')
  })

  it('the formula row is still skipped whole, without descending', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const eqn = doc.querySelector('tr.ltx_equation')!
    expect(classify(eqn)).toMatchObject({ kind: 'skip', descend: false })
  })

  it('the intertext row\'s text keeps only the words; formulas and references are placeholders', () => {
    const blocks = extract(docOf(`<div class="ltx_para">${GROUP}</div>`)) as TextBlock[]
    const row = blocks.find(b => b.unit === 'intertext')!
    const wire = serialize(row.el, 'tags').text
    expect(wire).toContain('In the Helfrich flow of')
    expect(wire).toContain('again the mean curvature')
    // Inline math is a void and is not sent for translation
    expect(wire).toMatch(/<x id="\d+"\/>/)
    expect(wire).not.toContain('<math')
  })
})

describe('to the enclosing unit the equation group is still one atom', () => {
  // 5 of the 39 equation groups in the 12 fixtures sit inside a unit such as `.ltx_item`.
  // Written as skip, or with descend left out, what those 5 blocks send out changes — `<table><tbody><tr>`
  // sent to the engine as paired tags, costing tokens and adding risk to the placeholder protocol
  // `.ltx_item` (<li>) rather than `.ltx_p`: the HTML parser does not allow a `<table>` inside a `<p>` and closes the paragraph early —
  // measured, the container of those 5 real cases is exactly `.ltx_item`
  it('a group inside a unit serialises to one void, not a string of table tags', () => {
    const doc = docOf(`<ul class="ltx_itemize"><li class="ltx_item">See the system ${GROUP} for details.</li></ul>`)
    const blocks = extract(doc) as TextBlock[]
    const para = blocks.find(b => b.unit === 'item')!
    const wire = serialize(para.el, 'tags').text
    expect(wire).toContain('See the system')
    expect(wire).toContain('for details.')
    // The whole group one void: no paired tags, and none of the group's text
    expect(wire).not.toContain('<t id=')
    expect(wire).not.toContain('Helfrich')
    expect((wire.match(/<x id="\d+"\/>/g) ?? [])).toHaveLength(1)
  })

  // Inside a nested group the intertext row is **not** a block: the enclosing unit has already cloned the whole group as one void atom into its translation,
  // and an intertext row as a block of its own would appear twice on the page — once in English inside the outer clone, once in Chinese in the group — and the split
  // would generate one more copy under the original (Codex on #168). Footnotes go back into place through localizeNotes; equation groups have no
  // such step, so this stays byte for byte as before the change. Measured: none of the 5 nested groups in 13 fixtures has an intertext row
  it('with the group nested in another unit the intertext row is no block (the enclosing unit has cloned the whole group already)', () => {
    const doc = docOf(`<ul class="ltx_itemize"><li class="ltx_item">See the system ${GROUP} for details.</li></ul>`)
    const units = (extract(doc) as TextBlock[]).map(b => b.unit)
    expect(units).toContain('item')
    expect(units).not.toContain('intertext')
  })

  it('with the group a block of its own it descends as usual: the intertext row is a translation unit in its own right', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    expect((extract(doc) as TextBlock[]).map(b => b.unit)).toContain('intertext')
  })

  it('the classification is protect + descend, the same shape as a footnote', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const group = doc.querySelector('table.ltx_equationgroup')!
    expect(classify(group)).toMatchObject({ kind: 'protect', descend: true })
  })
})

describe('eqnProseCell', () => {
  it('gives the cell holding the intertext row\'s text; the renderer uses its shallow clone as the translation row\'s shell', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const row = doc.querySelector('tr.ltx_eqn_row:not(.ltx_equation).ltx_align_baseline')!
    const cell = eqnProseCell(row)
    expect(cell?.tagName).toBe('TD')
    expect(cell?.getAttribute('colspan')).toBe('5')
  })

  it('no shell for anything but an intertext row: formula rows and paragraphs return null', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}<p class="ltx_p">text</p></div>`)
    expect(eqnProseCell(doc.querySelector('tr.ltx_equation')!)).toBeNull()
    expect(eqnProseCell(doc.querySelector('p.ltx_p')!)).toBeNull()
  })
})

// LaTeXML also emits span-shaped equation groups (measured: 2 of the 26 groups in 2312.17141),
// and narrowing to `table.` would lose them their whole-block protection: the enclosing unit would serialise the group as one paired wrapper plus a string of separate voids,
// and since the provider may reorder placeholders, a formula row could change position inside the translation clone (Codex on #168)
describe('a span-shaped equation group is an atom too', () => {
  const SPAN_GROUP = `<span class="ltx_equationgroup ltx_eqn_gather ltx_eqn_table">
    <span class="ltx_equation"><math class="ltx_Math"><mi>a</mi></math></span>
    <span class="ltx_equation"><math class="ltx_Math"><mi>b</mi></math></span>
  </span>`

  it('classified protect, the same rule as the table shape', () => {
    const doc = docOf(`<div class="ltx_para"><p class="ltx_p">See ${SPAN_GROUP} above.</p></div>`)
    const group = doc.querySelector('span.ltx_equationgroup')!
    expect(classify(group)).toMatchObject({ kind: 'protect', descend: true })
  })

  it('inside a paragraph block it serialises to **one** void, not a wrapper plus a string of voids', () => {
    const doc = docOf(`<div class="ltx_para"><p class="ltx_p">See ${SPAN_GROUP} above.</p></div>`)
    const para = (extract(doc) as TextBlock[]).find(b => b.unit === 'p')!
    const wire = ser(para.el, 'tags').text
    expect(wire).toContain('See')
    expect(wire).toContain('above.')
    expect(wire).not.toContain('<t id=')
    expect(wire.match(/<x id="\d+"\/>/g) ?? []).toHaveLength(1)
  })
})

// The criterion is “the enclosing unit really became a block”, not “an ancestor matches the unit selector”: an `.ltx_item` holding only a nested `.ltx_p`
// and an equation group has no ownText, is no block at all, and nobody clones that group (Codex on #168)
describe('the criterion for giving way is the enclosing unit really being a block', () => {
  it('with the enclosing unit no block of its own, the intertext row is translated as usual', () => {
    const doc = docOf(`<ul class="ltx_itemize"><li class="ltx_item"><p class="ltx_p">Prose lives here.</p>${GROUP}</li></ul>`)
    const blocks = extract(doc) as TextBlock[]
    // The `.ltx_item`'s own text is whitespace only, so it is no block; that text belongs to the nested `.ltx_p`
    expect(blocks.map(b => b.unit)).not.toContain('item')
    expect(blocks.map(b => b.unit)).toContain('p')
    // Nobody clones the whole group away, so the intertext row has to be a block of its own, or the passage is not translated
    expect(blocks.map(b => b.unit)).toContain('intertext')
  })

  it('gives way only when the enclosing unit really is a block', () => {
    const doc = docOf(`<ul class="ltx_itemize"><li class="ltx_item">See the system ${GROUP} for details.</li></ul>`)
    const units = (extract(doc) as TextBlock[]).map(b => b.unit)
    expect(units).toContain('item')
    expect(units).not.toContain('intertext')
  })
})
