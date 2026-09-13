import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ID_ATTR, extract } from '@/core/extractor'
import { startTranslation, type Transport } from '@/core/pipeline/run'
import { MIRROR_CLASS } from '@/core/renderer/attrs'
import { createMirrors } from '@/core/renderer/mirror'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'

const idle: Transport = async () => new Promise(() => {})
const load = (id: string) => new DOMParser()
  .parseFromString(readFileSync(join(import.meta.dirname, `../fixtures/arxiv/${id}.html`), 'utf8'), 'text/html')

describe('the block marks are complete before the first side prep pass (issue #67)', () => {
  for (const id of ['2312.17141', '2609.00245']) {
    it(`${id}: as soon as startTranslation returns, every block carries data-axt-id`, () => {
      const doc = load(id)
      const blocks = extract(doc)
      const run = startTranslation({ doc, blocks, target: 'zh-CN', mode: 'side', paper: id, transport: idle, capabilities: { maxBatchChars: 1000, maxBatchItems: 4, renderPath: 'tags' }, preload: DEFAULT_PRELOAD })
      // Deliberately not awaiting run.ready: this is exactly the window side prep would slip into (enterSide is called before startTranslation,
      // and prep is a coalescer with a 150 ms debounce / 1000 ms cap)
      const unmarked = blocks.filter(b => !b.el.hasAttribute(ID_ATTR))
      run.stop()
      expect(unmarked).toHaveLength(0)
    })
  }
})

describe('with the marks incomplete createMirrors necessarily clones whole blocks — that is what the assertion above guards (issue #67)', () => {
  // createMirrors cannot tell “a translation unit not marked yet” from “static content that will never have a translation” on its own:
  // both gates look at data-axt-id. So the safety comes entirely from run.ts writing the marks synchronously, not from here.
  // This test pins the danger down: should anyone want to slice the marking again, or add a guard to createMirrors, it speaks up.
  const doc = () => new DOMParser().parseFromString(
    '<!doctype html><html><body><article class="ltx_document"><section class="ltx_section">'
    + '<div class="ltx_para" id="done"><p class="ltx_p" id="p1">First.</p></div>'
    + '<div class="ltx_para" id="late"><p class="ltx_p" id="p2">Second.</p></div>'
    + '</section></article></body></html>', 'text/html')

  it('the earlier block marked, the later one not yet: the latter goes whole into the right column', () => {
    const d = doc()
    d.getElementById('p1')!.setAttribute(ID_ATTR, 'b1')
    expect(createMirrors(d)).toBe(1)
    const mirror = d.getElementById('late')!.nextElementSibling!
    expect(mirror.classList.contains(MIRROR_CLASS)).toBe(true)
    expect(mirror.textContent).toBe('Second.')
  })

  it('with both blocks marked there is no clone — exactly the state run.ts guarantees', () => {
    const d = doc()
    d.getElementById('p1')!.setAttribute(ID_ATTR, 'b1')
    d.getElementById('p2')!.setAttribute(ID_ATTR, 'b2')
    expect(createMirrors(d)).toBe(0)
  })
})
