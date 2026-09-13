import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// The translation of an intertext row (issue #152): the block is a `<tr>`, so the translation has to be a `<tr>` too (§7.1),
// and the row's content must sit inside a cell — hung directly under `<tr>`, table layout does not lay it out at all.
import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { rehydrate, serialize } from '@/core/protector'
import { T_CLASS } from '@/core/marks'
import { ERROR_CLASS, FOR_ATTR, PENDING_CLASS, SPLIT_ATTR, SPLIT_CLASS } from '@/core/renderer/attrs'
import { renderFailed } from '@/core/renderer/failed'
import { renderPending } from '@/core/renderer/pending'
import { splitFigures } from '@/core/renderer/split-figures'
import { renderText } from '@/core/renderer/translation'
import { docOf, frag } from './helpers'

const GROUP = `<table class="ltx_equationgroup ltx_eqn_table" id="E1"><tbody>
  <tr class="ltx_equation ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell ltx_align_right"><math class="ltx_Math"><mi>x</mi></math></td><td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr>
  <tr class="ltx_eqn_row ltx_align_baseline" id="r1"><td class="ltx_eqn_cell ltx_align_left" style="white-space:normal;" colspan="5">where the mean curvature is</td></tr>
</tbody></table>`

const rowOf = (doc: Document) => (extract(doc) as TextBlock[]).find(b => b.unit === 'intertext')!

describe('the translation of an intertext row', () => {
  it('the translation is a row with the content inside a shallow clone of the original cell: colspan and alignment follow', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const node = renderText(rowOf(doc), frag(doc, '其中平均曲率为'))
    expect(node.tagName).toBe('TR')
    // Text directly under <tr> is invalid: content must be in a cell
    expect(node.children).toHaveLength(1)
    const cell = node.firstElementChild!
    expect(cell.tagName).toBe('TD')
    expect(cell.getAttribute('colspan')).toBe('5')
    expect(cell.className).toContain('ltx_align_left')
    expect(cell.textContent).toBe('其中平均曲率为')
  })

  it('the original row\'s next sibling as §7.1 says, with the original\'s class plus axt-t', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const block = rowOf(doc)
    const before = doc.querySelector('table')!.querySelectorAll('tr').length
    const node = renderText(block, frag(doc, '其中平均曲率为'))
    expect(node.previousElementSibling).toBe(block.el)
    expect(node.classList.contains(T_CLASS)).toBe(true)
    expect(node.classList.contains('ltx_eqn_row')).toBe(true)
    expect(node.getAttribute(FOR_ATTR)).toBe(block.id)
    // What is added is a row, not a column
    expect(doc.querySelector('table')!.querySelectorAll('tr')).toHaveLength(before + 1)
    expect(block.el.children).toHaveLength(1)
  })

  // On the placeholder path the whole cell is one paired placeholder, and the top level rehydrated **is already** a `<td>`; wrapping it again gives
  // `<tr><td><td>…</td></td></tr>`. The first version of the test used a bare text fragment, so it did not catch that (Codex on #168)
  it('a real round trip: when rehydration already gives a cell it is not wrapped again, and the row has a single td', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const block = rowOf(doc)
    const wire = serialize(block.el, 'tags')
    // The engine returns it as it was: the rehydrated top level is that cell
    const node = renderText(block, rehydrate(wire.text, wire, doc))
    expect(node.tagName).toBe('TR')
    expect(Array.from(node.children).map(c => c.tagName)).toEqual(['TD'])
    expect(node.querySelector('td td')).toBeNull()
    expect(node.textContent).toContain('where the mean curvature is')
  })

  it('the runs fallback path rehydrates to plain text, and then the wrapper is still needed', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const node = renderText(rowOf(doc), frag(doc, '其中平均曲率为'))
    expect(Array.from(node.children).map(c => c.tagName)).toEqual(['TD'])
    expect(node.firstElementChild!.textContent).toBe('其中平均曲率为')
  })

  it('an ordinary paragraph is unaffected: no cell appears in its translation from nowhere', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div>')
    const block = (extract(doc) as TextBlock[])[0]!
    const node = renderText(block, frag(doc, '文本。'))
    expect(node.tagName).toBe('P')
    expect(node.querySelector('td')).toBeNull()
    expect(node.textContent).toBe('文本。')
  })
})

describe('an equation group with an intertext row is split in two whole', () => {
  // The existing layout is “the formula once in each column” (the group is mirrored whole). Once the intertext row has a translation the mirror stops,
  // and letting the whole group span both columns would show the reader the formula going from two copies to one — so it takes the same path as figures:
  // clone once, remove the source member of each pair; the original group in the left column, the same group with the Chinese intertext in the right
  const translated = () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const block = rowOf(doc)
    markBlocks([block])
    renderText(block, frag(doc, '其中平均曲率为'))
    return doc
  }

  it('a translation-only copy is produced, with the source row removed inside it', () => {
    const doc = translated()
    expect(splitFigures(doc)).toBe(1)
    const clone = doc.querySelector(`.${SPLIT_CLASS}`)!
    expect(clone.tagName).toBe('TABLE')
    expect(clone.previousElementSibling).toBe(doc.getElementById('E1'))
    // The formula is still in the copy (it has no translation), the English intertext is gone, the Chinese one is there
    expect(clone.querySelector('math')).not.toBeNull()
    expect(clone.textContent).not.toContain('where the mean curvature is')
    expect(clone.textContent).toContain('其中平均曲率为')
    // The original is marked, and side mode hides the translation inside it by that mark
    expect(doc.getElementById('E1')!.hasAttribute(SPLIT_ATTR)).toBe(true)
  })

  it('the copy carries no id, so it duplicates none of the original\'s anchors', () => {
    const doc = translated()
    splitFigures(doc)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)!.querySelector('[id]')).toBeNull()
  })

  it('an equation group without an intertext row is not split: it has no translation and stays with the mirror', () => {
    const doc = docOf(`<div class="ltx_para"><table class="ltx_equationgroup ltx_eqn_table"><tbody>
      <tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell"><math class="ltx_Math"><mi>x</mi></math></td></tr>
    </tbody></table></div>`)
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
  })

  it('idempotent: with the translation unchanged the copy is not rebuilt', () => {
    const doc = translated()
    expect(splitFigures(doc)).toBe(1)
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
  })
})

// The ring and the failure widget take two other paths: with a special case for translations only, the waiting ring would hang directly under the `<tr>`
// and the failure widget would become a `<span>` child of `<tbody>`, neither fitting the table content model (Codex on #168)
describe('the waiting and failed states of an intertext row', () => {
  it('the ring sits inside a cell rather than directly under the row', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const node = renderPending(rowOf(doc))
    expect(node.tagName).toBe('TR')
    expect(node.classList.contains(PENDING_CLASS)).toBe(true)
    const cell = node.firstElementChild!
    expect(cell.tagName).toBe('TD')
    expect(cell.getAttribute('colspan')).toBe('5')
    // The skeleton is inside the cell, and the row has no other direct child
    expect(node.children).toHaveLength(1)
    expect(cell.children.length).toBeGreaterThan(0)
  })

  it('the failure widget is wrapped as one row with one cell, the pairing mark on the row', () => {
    const doc = docOf(`<div class="ltx_para">${GROUP}</div>`)
    const block = rowOf(doc)
    markBlocks([block])
    const node = renderFailed(block, 'network: offline', () => {})
    expect(node.tagName).toBe('TR')
    expect(node.previousElementSibling).toBe(block.el)
    expect(node.classList.contains(T_CLASS)).toBe(true)
    expect(node.classList.contains(ERROR_CLASS)).toBe(true)
    expect(node.getAttribute(FOR_ATTR)).toBe(block.id)
    const cell = node.firstElementChild!
    expect(cell.tagName).toBe('TD')
    // The widget itself is in the cell and no longer carries the pairing mark (moved to the row)
    const widget = cell.firstElementChild!
    expect(widget.tagName).toBe('SPAN')
    expect(widget.classList.contains(T_CLASS)).toBe(false)
    expect(widget.hasAttribute(FOR_ATTR)).toBe(false)
    // No span is allowed under `<tbody>`
    expect(doc.querySelector('tbody > span')).toBeNull()
  })

  it('the ring and the failure widget of an ordinary paragraph are unaffected', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p></div>')
    const block = (extract(doc) as TextBlock[])[0]!
    markBlocks([block])
    expect(renderPending(block).querySelector('td')).toBeNull()
    const failed = renderFailed(block, 'network: offline', () => {})
    expect(failed.tagName).toBe('SPAN')
    expect(failed.getAttribute(FOR_ATTR)).toBe(block.id)
  })
})

// Partial failure: with one row of the group succeeding and another failing the split still happens, and the copy strips the failure widget
// (it is our own node, and `cloneNode` copies neither the shadow root nor the listeners, so what stays would be an empty shell).
// The original copy is then hidden by side's styles, and the reader sees the retry button in neither column — that block is stuck failed for good (Codex on #168)
describe('the retry button stays clickable on a partial failure', () => {
  it('side mode does not hide the failure widget inside the original', () => {
    const RULES = readFileSync(join(import.meta.dirname, '../../src/styles/modes.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
    // The translation inside the original is hidden as before (the copy stands in), but the failure widget has to stay
    expect(RULES).toMatch(/html\[data-axt-mode="side"\] \[data-axt-split\] \.axt-t:not\(\.axt-error\) \{\s*display: none/)
  })

  it('the copy strips the failure widget and keeps that row\'s source; the retry stays on the original\'s side', () => {
    const doc = docOf(`<div class="ltx_para"><table class="ltx_equationgroup ltx_eqn_table" id="E2"><tbody>
      <tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell"><math class="ltx_Math"><mi>x</mi></math></td></tr>
      <tr class="ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell" style="white-space:normal;" colspan="5">where the first is</td></tr>
      <tr class="ltx_eqn_row ltx_align_baseline"><td class="ltx_eqn_cell" style="white-space:normal;" colspan="5">and the second is</td></tr>
    </tbody></table></div>`)
    const rows = (extract(doc) as TextBlock[]).filter(b => b.unit === 'intertext')
    expect(rows).toHaveLength(2)
    markBlocks(rows)
    renderText(rows[0]!, frag(doc, '第一段'))
    renderFailed(rows[1]!, 'network: offline', () => {})
    expect(splitFigures(doc)).toBe(1)
    const clone = doc.querySelector(`.${SPLIT_CLASS}`)!
    // The copy: the succeeded row is Chinese, the failed row keeps its English and has no widget
    expect(clone.textContent).toContain('第一段')
    expect(clone.textContent).toContain('and the second is')
    expect(clone.querySelector(`.${ERROR_CLASS}`)).toBeNull()
    // The **live** widget inside the original is still there, and the style no longer hides it. An intertext row's failure widget is wrapped as `<tr><td><span>`:
    // the outer row carries the pairing mark, and the span is what really carries the shadow root (button and listeners inside)
    const failedRow = doc.querySelector(`[data-axt-split] tr.${ERROR_CLASS}`)
    expect(failedRow).not.toBeNull()
    const widget = failedRow!.querySelector(`span.${ERROR_CLASS}`)
    expect(widget).not.toBeNull()
    expect(widget!.shadowRoot).not.toBeNull()
    expect(widget!.shadowRoot!.querySelector('button')).not.toBeNull()
  })
})
