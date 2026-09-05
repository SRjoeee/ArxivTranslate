import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { startTranslation, type Transport } from '@/core/pipeline/run'
import { T_CLASS, restore } from '@/core/renderer'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'

describe('pipeline × fixture', () => {
  it('2410.00260 全篇恒等翻译后恢复，DOM 与原始相等', async () => {
    const doc = new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures/arxiv/2410.00260.html'), 'utf8'), 'text/html')
    const before = doc.documentElement.outerHTML
    const blocks = extract(doc)
    let calls = 0
    const transport: Transport = async req => {
      calls++
      return { ok: true, result: { segments: req.request.segments.map(s => ({ id: s.id, text: s.text })), provider: 'mock' }, cached: 0 }
    }
    const t0 = performance.now()
    const run = startTranslation({ doc, blocks, target: 'zh-CN', mode: 'stack', paper: '2410.00260', transport, capabilities: { maxBatchChars: 1000, maxBatchItems: 4, preservesMarkup: true }, preload: DEFAULT_PRELOAD })
    await run.ready
    // happy-dom 没有布局也没有 IntersectionObserver：手动把整篇交出去，相当于滚到了底
    await run.translate(blocks)
    const progress = run.progress()
    console.info(`[pipeline] 2410.00260: ${blocks.length} 块，${calls} 批，${Math.round(performance.now() - t0)} ms`)
    expect(progress).toMatchObject({ state: 'on', requested: blocks.length, done: blocks.length, failed: 0, inFlight: 0 })
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(blocks.length)
    run.stop()
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
