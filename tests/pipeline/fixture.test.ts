import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { runTranslation, type Transport } from '@/core/pipeline/run'
import { T_CLASS, restore } from '@/core/renderer'

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
    const progress = await runTranslation({ doc, blocks, target: 'zh-CN', mode: 'stack', paper: '2410.00260', transport, capabilities: { maxBatchChars: 6000, preservesMarkup: true } })
    console.info(`[pipeline] 2410.00260: ${blocks.length} 块，${calls} 批，${Math.round(performance.now() - t0)} ms`)
    expect(progress.state).toBe('done')
    expect(progress.done).toBe(blocks.length)
    expect(progress.failed).toBe(0)
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(blocks.length)
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
