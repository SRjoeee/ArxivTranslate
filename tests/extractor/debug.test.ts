import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { enableDebug } from '@/entrypoints/content/debug'

describe('enableDebug', () => {
  it('标记块、在 <html> 上打开调试属性、注入唯一的样式，且幂等', () => {
    document.body.innerHTML =
      '<article class="ltx_document"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_tabular" id="T"><tbody><tr><td class="ltx_td">1</td></tr></tbody></table></article>'
    const blocks = extract(document)
    enableDebug(blocks)
    expect(document.documentElement.hasAttribute('data-axt-debug')).toBe(true)
    expect(document.querySelectorAll('style[data-axt="debug"]')).toHaveLength(1)
    expect(document.getElementById('p1')?.getAttribute('data-axt-id')).toBe('p1')
    expect(document.getElementById('T')?.getAttribute('data-axt-id')).toBe('T')

    enableDebug(blocks)
    expect(document.querySelectorAll('style[data-axt="debug"]')).toHaveLength(1)
  })
})
