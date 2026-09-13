// The accessibility attributes of translation nodes. The four items the peer audit (2026-09-06) checked — skipped heading levels,
// no <main>, <object> without a label, tables without <th> — are all in arXiv/LaTeXML's original page, present without the extension,
// and changing them would break the DOM invariant of §7.1. What is ours are the few things guarded here.
import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { LANG_ATTR } from '@/core/renderer/attrs'
import { enable, restore } from '@/core/renderer/page'
import { renderText } from '@/core/renderer/translation'
import { renderPending } from '@/core/renderer/pending'
import { docOf, frag } from './helpers'

describe('translation nodes carry their language (the one the peer audit missed)', () => {
  it('a translation carries lang: the page\'s <html lang> speaks of the original; unmarked, a screen reader would read Chinese in an English voice', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    doc.documentElement.lang = 'en'
    enable(doc, 'stack', undefined, 'zh-CN')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(node.getAttribute('lang')).toBe('zh-CN')
    // Not a character of the original moves (§7.1)
    expect(block!.el.hasAttribute('lang')).toBe(false)
    expect(doc.documentElement.lang).toBe('en')
  })

  it('the language is recorded on <html> as a data-axt-* attribute and cleared with the restore', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'stack', undefined, 'ja')
    expect(doc.documentElement.getAttribute(LANG_ATTR)).toBe('ja')
    const [block] = extract(doc) as TextBlock[]
    renderText(block!, frag(doc, 'こんにちは。'))
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('with no language given the attribute is not written: a mode switch must not conjure a lang', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'side')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(doc.documentElement.hasAttribute(LANG_ATTR)).toBe(false)
    expect(node.hasAttribute('lang')).toBe(false)
  })
})

describe('purely decorative copies are hidden from screen readers', () => {
  it('the loading skeleton carries aria-hidden: the per-block waiting state must not be read out one by one', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const [block] = extract(doc) as TextBlock[]
    renderPending(block!)
    const skeleton = doc.querySelector('.axt-skel')!
    expect(skeleton.getAttribute('aria-hidden')).toBe('true')
  })

  it('the mirror carries aria-hidden: it is the right column\'s visual counterweight, identical in content to the left', async () => {
    const { createMirrors } = await import('@/core/renderer/mirror')
    // A translated paragraph makes the container a mirror container; an equation is the mirror target
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" data-axt-id="p1">A.</p><p class="ltx_p axt-t" data-axt-for="p1">甲。</p><table class="ltx_equation"><tbody><tr><td>x</td></tr></tbody></table></div>')
    const made = createMirrors(doc)
    expect(made).toBeGreaterThan(0)
    const mirrors = [...doc.querySelectorAll('.axt-mirror')]
    expect(mirrors.every(el => el.getAttribute('aria-hidden') === 'true')).toBe(true)
    // aria-hidden only stops screen readers, not Tab: the links inside the copy stay in the focus order, and a keyboard user lands in a
    // decorative copy that announces nothing (caught by the A/B audit on the reference mirror of 2401.00596, issue #72)
    expect(mirrors.every(el => el.hasAttribute('inert'))).toBe(true)
  })

  it('the real translation is not hidden: it is content with information', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', undefined, 'zh-CN')
    const [block] = extract(doc) as TextBlock[]
    const node = renderText(block!, frag(doc, '你好。'))
    expect(node.hasAttribute('aria-hidden')).toBe(false)
    expect(node.classList.contains(T_CLASS)).toBe(true)
  })
})
