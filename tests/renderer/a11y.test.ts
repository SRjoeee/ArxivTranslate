// Translation accessibility. A peer audit (2026-09-06) found skipped heading levels, missing main landmarks,
// unlabelled object elements, and missing table headers, all inherited from arXiv/LaTeXML without the extension.
// Fixing those would violate DOM invariants (§7.1); the tests below guard the responsibilities that belong to the extension.
import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { LANG_ATTR, T_CLASS, enable, renderText, restore } from '@/core/renderer'
import { renderPending } from '@/core/renderer/pending'
import { docOf, frag } from './helpers'

describe('translation language annotation, missed by the peer audit', () => {
  it('translations carry lang because html lang describes the original and would otherwise make screen readers pronounce Chinese with an English voice', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    doc.documentElement.lang = 'en'
    enable(doc, 'stack', undefined, 'zh-CN')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(node.getAttribute('lang')).toBe('zh-CN')
    // The original remains unchanged (§7.1).
    expect(block!.el.hasAttribute('lang')).toBe(false)
    expect(doc.documentElement.lang).toBe('en')
  })

  it('language is stored in data-axt-* on html and removed on restoration', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'stack', undefined, 'ja')
    expect(doc.documentElement.getAttribute(LANG_ATTR)).toBe('ja')
    const [block] = extract(doc) as TextBlock[]
    renderText(block!, frag(doc, 'こんにちは。'))
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('omitting language writes no attribute; mode changes must not invent a language', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'side')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(doc.documentElement.hasAttribute(LANG_ATTR)).toBe(false)
    expect(node.hasAttribute('lang')).toBe(false)
  })
})

describe('decorative copies are hidden from screen readers', () => {
  it('loading spinners carry aria-hidden so each block wait state is not announced', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [block] = extract(doc) as TextBlock[]
    renderPending(block!)
    const spinner = doc.querySelector('.axt-spinner')!
    expect(spinner.getAttribute('aria-hidden')).toBe('true')
  })

  it('mirrors carry aria-hidden because they visually balance the right column with identical content', async () => {
    const { createMirrors } = await import('@/core/renderer')
    // A translated paragraph makes this a mirror container; a formula is the mirror target.
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" data-axt-id="p1">A.</p><p class="ltx_p axt-t" data-axt-for="p1">甲。</p><table class="ltx_equation"><tbody><tr><td>x</td></tr></tbody></table></div>')
    const made = createMirrors(doc)
    expect(made).toBeGreaterThan(0)
    const mirrors = [...doc.querySelectorAll('.axt-mirror')]
    expect(mirrors.every(el => el.getAttribute('aria-hidden') === 'true')).toBe(true)
    // aria-hidden excludes screen readers but not Tab navigation; clone links would remain focusable and let keyboard users enter
    // a silent decorative copy (caught in the 2401.00596 bibliography by the A/B audit, issue #72).
    expect(mirrors.every(el => el.hasAttribute('inert'))).toBe(true)
  })

  it('real translations remain accessible because they carry information', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', undefined, 'zh-CN')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(node.hasAttribute('aria-hidden')).toBe(false)
    expect(node.classList.contains(T_CLASS)).toBe(true)
  })
})
