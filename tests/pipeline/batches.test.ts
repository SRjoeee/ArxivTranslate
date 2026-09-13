import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { planBatches } from '@/core/pipeline/batches'

const docOf = (body: string) =>
  new DOMParser().parseFromString(`<!doctype html><html><body><article class="ltx_document">${body}</article></body></html>`, 'text/html')
const para = (id: string, text: string) => `<p class="ltx_p" id="${id}">${text}</p>`

describe('planBatches', () => {
  it('batches by character budget, keeping document order', () => {
    const doc = docOf(para('a', 'A'.repeat(50)) + para('b', 'B'.repeat(50)) + para('c', 'C'.repeat(50)))
    const batches = planBatches(extract(doc), { maxBatchChars: 110, maxBatchItems: 10 })
    expect(batches.map(b => b.segments.map(s => s.id))).toEqual([['a', 'b'], ['c']])
    expect(batches[0]?.kind).toBe('text')
    expect(batches[0]?.segments[0]?.text).toBe('A'.repeat(50))
  })

  it('a heading block updates the sectionTitle of the batches that follow', () => {
    const doc = docOf(`${para('a', 'Abstract text.')}<h2 class="ltx_title" id="s1">1 Introduction</h2>${para('b', 'Body one.')}${para('c', 'Body two.')}`)
    const batches = planBatches(extract(doc), { maxBatchChars: 30, maxBatchItems: 10 })
    const titles = batches.map(b => [b.segments.map(s => s.id).join(','), b.sectionTitle])
    // A heading block opens a new batch (§8.2 cuts by section); under a 30-character budget s1 + b share a batch, c starts another
    expect(titles).toEqual([['a', undefined], ['s1,b', '1 Introduction'], ['c', '1 Introduction']])
  })

  it('a formula-dense block is a batch of its own', () => {
    const dense = `<p class="ltx_p" id="d">${'x <math class="ltx_Math"><mi>y</mi></math> '.repeat(45)}end</p>`
    const doc = docOf(para('a', 'Short.') + dense + para('b', 'Short.'))
    const batches = planBatches(extract(doc), { maxBatchChars: 100_000, maxBatchItems: 10 })
    expect(batches.map(b => b.segments.map(s => s.id))).toEqual([['a'], ['d'], ['b']])
  })

  it('a table block is one batch whole, cell ids carry the original index, numeric cells stay out', () => {
    const table = '<table class="ltx_tabular" id="T1"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td><td class="ltx_td">Baseline</td></tr></tbody></table>'
    const doc = docOf(para('a', 'Before.') + table + para('b', 'After.'))
    const batches = planBatches(extract(doc), { maxBatchChars: 100_000, maxBatchItems: 10 })
    expect(batches.map(b => b.kind)).toEqual(['text', 'table', 'text'])
    expect(batches[1]?.segments.map(s => s.id)).toEqual(['T1#c0', 'T1#c2'])
    expect(batches[1]?.block?.id).toBe('T1')
    expect(batches[1]?.segments[0]?.cell?.el.textContent).toBe('Model')
  })

  it('batches by the segment cap (Read Frog\'s default of 4 segments per batch)', () => {
    const doc = docOf(['a', 'b', 'c', 'd', 'e', 'f'].map(id => para(id, 'Short.')).join(''))
    const batches = planBatches(extract(doc), { maxBatchChars: 100_000, maxBatchItems: 4 })
    expect(batches.map(b => b.segments.map(s => s.id))).toEqual([['a', 'b', 'c', 'd'], ['e', 'f']])
  })

  it('no blocks, zero batches', () => {
    expect(planBatches([], { maxBatchChars: 100, maxBatchItems: 10 })).toEqual([])
  })
})
