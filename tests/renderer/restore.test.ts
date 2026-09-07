import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type TableBlock, type TextBlock } from '@/core/extractor'
import { MODE_ATTR, ON_ATTR, enable, renderImage, renderTable, renderText, restore, setImageModes, setMode } from '@/core/renderer'
import { enableDebug } from '@/entrypoints/content/debug'
import { frag } from './helpers'

const page =
  '<article class="ltx_document"><h6 class="ltx_title ltx_title_abstract" id="a">Abstract</h6>'
  + '<div class="ltx_para"><p class="ltx_p" id="p1">One.</p><p class="ltx_p" id="p2">Two.</p></div>'
  + '<table class="ltx_tabular" id="T"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table></article>'

describe('enable / setMode', () => {
  it('在 <html> 上写状态，样式只注入一份，幂等', () => {
    document.body.innerHTML = page
    enable(document, 'stack')
    enable(document, 'stack')
    expect(document.documentElement.hasAttribute(ON_ATTR)).toBe(true)
    expect(document.documentElement.getAttribute(MODE_ATTR)).toBe('stack')
    expect(document.querySelectorAll('style[data-axt-sheet="modes"]')).toHaveLength(1)
    setMode(document, 'side')
    expect(document.documentElement.getAttribute(MODE_ATTR)).toBe('side')
    restore(document)
  })
})

describe('restore', () => {
  it('翻译 + 调试描边后恢复，DOM 与最初逐字相等', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = page
    const before = document.documentElement.outerHTML
    const blocks = extract(document)
    enable(document, 'stack')
    markBlocks(blocks)
    enableDebug(blocks)
    for (const b of blocks) {
      if (b.kind === 'text') renderText(b as TextBlock, frag(document, '译'))
      else renderTable(b as TableBlock, new Map([[(b as TableBlock).cells[0]!.el, frag(document, '模型')]]))
    }
    expect(document.querySelectorAll('.axt-t')).toHaveLength(4)
    expect(document.querySelectorAll('[data-axt-inline]')).toHaveLength(2)
    const result = restore(document)
    expect(document.documentElement.outerHTML).toBe(before)
    expect(result.removedNodes).toBe(4)
    // data-axt-id ×4 + data-axt-state ×4 + 原标题的 data-axt-inline + data-axt-on + data-axt-mode + data-axt-debug
    expect(result.strippedAttrs).toBe(12)
  })

  it('图片叠加层与模式闸一起恢复（§7.1 第 4 条、§15.2）', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = '<article class="ltx_document"><figure class="ltx_figure"><img class="ltx_graphics" src="a.png" id="g1"><figcaption class="ltx_caption" id="c">Cap</figcaption></figure></article>'
    const before = document.documentElement.outerHTML
    enable(document, 'stack')
    setImageModes(document, ['stack', 'only'])
    const el = document.getElementById('g1') as HTMLImageElement
    renderImage({ id: 'g1', el }, [{ x: 0, y: 0, w: 0.2, h: 0.05, lines: 1, source: 'Cap', text: '说明' }])
    const result = restore(document)
    expect(document.documentElement.outerHTML).toBe(before)
    expect(result.removedNodes).toBe(1)
    // data-axt-on + data-axt-mode + data-axt-img-modes
    expect(result.strippedAttrs).toBe(3)
  })
})
