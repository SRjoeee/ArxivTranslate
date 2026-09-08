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

describe('块标记在第一趟 side prep 之前就是完整的（issue #67）', () => {
  for (const id of ['2312.17141', '2609.00245']) {
    it(`${id}：startTranslation 一返回，每个块都带 data-axt-id`, () => {
      const doc = load(id)
      const blocks = extract(doc)
      const run = startTranslation({ doc, blocks, target: 'zh-CN', mode: 'side', paper: id, transport: idle, capabilities: { maxBatchChars: 1000, maxBatchItems: 4, renderPath: 'markup' }, preload: DEFAULT_PRELOAD })
      // 故意不 await run.ready：这正是 side prep 会插进来的窗口（enterSide 在 startTranslation 之前调用，
      // prep 是 150 ms 去抖 / 1000 ms 上限的合并器）
      const unmarked = blocks.filter(b => !b.el.hasAttribute(ID_ATTR))
      run.stop()
      expect(unmarked).toHaveLength(0)
    })
  }
})

describe('标记不完整时 createMirrors 必然整块克隆——上面那条断言守的就是这个（issue #67）', () => {
  // createMirrors 自己无法分辨"还没轮到标记的翻译单元"与"永远不会有译文的静态内容"：
  // 两道闸看的都是 data-axt-id。所以安全完全来自 run.ts 同步写完标记，不来自这里。
  // 这条测试把危险钉住：哪天有人想把标记改回切片，或给 createMirrors 加防护，它会说话。
  const doc = () => new DOMParser().parseFromString(
    '<!doctype html><html><body><article class="ltx_document"><section class="ltx_section">'
    + '<div class="ltx_para" id="done"><p class="ltx_p" id="p1">First.</p></div>'
    + '<div class="ltx_para" id="late"><p class="ltx_p" id="p2">Second.</p></div>'
    + '</section></article></body></html>', 'text/html')

  it('前一个块已标记、后一个还没：后者整块进右栏', () => {
    const d = doc()
    d.getElementById('p1')!.setAttribute(ID_ATTR, 'b1')
    expect(createMirrors(d)).toBe(1)
    const mirror = d.getElementById('late')!.nextElementSibling!
    expect(mirror.classList.contains(MIRROR_CLASS)).toBe(true)
    expect(mirror.textContent).toBe('Second.')
  })

  it('两个块都标记好了就没有克隆——run.ts 保证的正是这个状态', () => {
    const d = doc()
    d.getElementById('p1')!.setAttribute(ID_ATTR, 'b1')
    d.getElementById('p2')!.setAttribute(ID_ATTR, 'b2')
    expect(createMirrors(d)).toBe(0)
  })
})
