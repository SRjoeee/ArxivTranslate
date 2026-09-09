import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ID_ATTR, extract } from '@/core/extractor'
import { startTranslation, type Transport } from '@/core/pipeline/run'
import { MIRROR_CLASS, createMirrors } from '@/core/renderer'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'

const idle: Transport = async () => new Promise(() => {})
const load = (id: string) => new DOMParser()
  .parseFromString(readFileSync(join(import.meta.dirname, `../fixtures/arxiv/${id}.html`), 'utf8'), 'text/html')

describe('block markers are complete before the first side preparation pass (issue #67)', () => {
  for (const id of ['2312.17141', '2609.00245']) {
    it(`${id}: every block has data-axt-id as soon as startTranslation returns`, () => {
      const doc = load(id)
      const blocks = extract(doc)
      const run = startTranslation({ doc, blocks, target: 'zh-CN', mode: 'side', paper: id, transport: idle, capabilities: { maxBatchChars: 1000, maxBatchItems: 4, preservesMarkup: true }, preload: DEFAULT_PRELOAD })
      // Deliberately do not await run.ready: side preparation can run in this gap; enterSide precedes startTranslation,
      // and prep coalesces with a 150 ms debounce and 1000 ms maximum delay.
      const unmarked = blocks.filter(b => !b.el.hasAttribute(ID_ATTR))
      run.stop()
      expect(unmarked).toHaveLength(0)
    })
  }
})

describe('incomplete markers necessarily make createMirrors clone entire blocks; the previous assertion prevents this (issue #67)', () => {
  // createMirrors cannot distinguish a translation unit not yet marked from static content that will never translate:
  // both gates inspect data-axt-id. Safety comes entirely from synchronous marking in run.ts.
  // This test captures the hazard if marking is sliced again or createMirrors gains a guard.
  const doc = () => new DOMParser().parseFromString(
    '<!doctype html><html><body><article class="ltx_document"><section class="ltx_section">'
    + '<div class="ltx_para" id="done"><p class="ltx_p" id="p1">First.</p></div>'
    + '<div class="ltx_para" id="late"><p class="ltx_p" id="p2">Second.</p></div>'
    + '</section></article></body></html>', 'text/html')

  it('The first block is marked and the next is not; the latter is cloned into the right column.', () => {
    const d = doc()
    d.getElementById('p1')!.setAttribute(ID_ATTR, 'b1')
    expect(createMirrors(d)).toBe(1)
    const mirror = d.getElementById('late')!.nextElementSibling!
    expect(mirror.classList.contains(MIRROR_CLASS)).toBe(true)
    expect(mirror.textContent).toBe('Second.')
  })

  it('With both blocks marked there are no clones: run.ts guarantees this state.', () => {
    const d = doc()
    d.getElementById('p1')!.setAttribute(ID_ATTR, 'b1')
    d.getElementById('p2')!.setAttribute(ID_ATTR, 'b2')
    expect(createMirrors(d)).toBe(0)
  })
})
