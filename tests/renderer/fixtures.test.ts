import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type TableBlock, type TextBlock } from '@/core/extractor'
import { rehydrate, serialize } from '@/core/protector'
import { FOR_ATTR, STATE_ATTR, T_CLASS, enable, renderTable, renderText, restore } from '@/core/renderer'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

describe('renderer × fixture：DOM 不变量', () => {
  const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort()

  for (const f of files) {
    it(f, () => {
      const doc = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      const before = doc.documentElement.outerHTML
      const blocks = extract(doc)
      const t0 = performance.now()
      enable(doc, 'stack')
      markBlocks(blocks)
      for (const b of blocks) {
        if (b.kind === 'text') {
          const p = serialize(b.el)
          renderText(b as TextBlock, rehydrate(p.text, p, doc))
        } else {
          const cells = new Map<Element, DocumentFragment>()
          for (const c of (b as TableBlock).cells) {
            if (c.numeric) continue
            const p = serialize(c.el)
            cells.set(c.el, rehydrate(p.text, p, doc))
          }
          renderTable(b as TableBlock, cells)
        }
      }
      const rendered = Array.from(doc.querySelectorAll(`.${T_CLASS}`))
      expect(rendered).toHaveLength(blocks.length)
      const byId = new Map(blocks.map(b => [b.id, b.el]))
      for (const node of rendered) {
        const original = byId.get(node.getAttribute(FOR_ATTR) ?? '')
        expect(node.previousElementSibling, node.getAttribute(FOR_ATTR) ?? '').toBe(original)
        expect(original?.getAttribute(STATE_ATTR)).toBe('translated')
      }
      const result = restore(doc)
      const ms = Math.round(performance.now() - t0)
      console.info(`[renderer] ${f}: ${blocks.length} 块渲染 + 恢复，${ms} ms，移除 ${result.removedNodes} 节点 / ${result.strippedAttrs} 属性`)
      expect(result.removedNodes).toBe(blocks.length)
      expect(doc.documentElement.outerHTML).toBe(before)
    })
  }
})
