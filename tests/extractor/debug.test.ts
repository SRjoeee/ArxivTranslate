import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { enableDebug } from '@/entrypoints/content/debug'

describe('enableDebug', () => {
  it('marks the blocks, turns the debug attribute on <html> on, injects the style once, and is idempotent', () => {
    document.body.innerHTML =
      '<article class="ltx_document"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_tabular" id="T"><tbody><tr><td class="ltx_td">Model</td><td class="ltx_td">1</td></tr></tbody></table></article>'
    const blocks = extract(document)
    enableDebug(blocks)
    expect(document.documentElement.hasAttribute('data-axt-debug')).toBe(true)
    expect(document.querySelectorAll('style[data-axt-sheet="debug"]')).toHaveLength(1)
    expect(document.getElementById('p1')?.getAttribute('data-axt-id')).toBe('p1')
    expect(document.getElementById('T')?.getAttribute('data-axt-id')).toBe('T')

    enableDebug(blocks)
    expect(document.querySelectorAll('style[data-axt-sheet="debug"]')).toHaveLength(1)
  })
})
