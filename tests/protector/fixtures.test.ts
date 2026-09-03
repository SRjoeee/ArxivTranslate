import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { VOID_DENSE_THRESHOLD, joinRuns, rehydrate, serialize, splitRuns, validate } from '@/core/protector'
import { htmlOf, stripIds } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

describe('fixture 往返', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  for (const f of files) {
    it(f, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      const before = doc.documentElement.outerHTML
      const targets: Element[] = []
      for (const b of extract(doc)) {
        if (b.kind === 'text') targets.push(b.el)
        else for (const c of b.cells) if (!c.numeric) targets.push(c.el)
      }
      const t0 = performance.now()
      let dense = 0
      for (const target of targets) {
        const block = serialize(target)
        if (block.voidCount > VOID_DENSE_THRESHOLD) dense++
        const v = validate(block.text, block)
        expect(v.ok, `${f} 恒等校验失败：${target.id || target.className}`).toBe(true)
        expect(htmlOf(rehydrate(block.text, block, doc)), `${f} 回填不等价：${target.id || target.className}`).toBe(stripIds(target.innerHTML))
        const layout = splitRuns(block)
        joinRuns(layout.runs, layout, block, doc)
      }
      const ms = Math.round(performance.now() - t0)
      console.info(`[protector] ${f}: ${targets.length} 个块/单元格往返，${dense} 个公式密集块，${ms} ms`)
      expect(ms).toBeLessThan(10000)
      expect(doc.documentElement.outerHTML).toBe(before)
    })
  }
})
