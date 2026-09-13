import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BLUR_ATTR, UNDERLINE_ATTR } from '@/core/renderer/attrs'
import { enable, restore } from '@/core/renderer/page'
import { CUSTOM_STYLE_SELECTOR } from '@/core/renderer/style-preset'
import { sanitizeCustomCss } from '@/core/renderer/style-values'
import { UNDERLINES } from '@/config/appearance'
import { docOf } from './helpers'
import { LOOK, lookWith } from './looks'

const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
/** The comments name the properties too; strip them before a text assertion */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('translation appearance (§7.5)', () => {
  it('the four line styles have one variable rule each, and no other preset id is left', () => {
    for (const underline of UNDERLINES) {
      const has = RULES.includes(`[data-axt-underline="${underline}"]`)
      expect([underline, has]).toEqual([underline, underline !== 'none'])
    }
    // Before v12 each effect had an id; now the values all go through variables, and only two switches remain as attributes
    expect(RULES).not.toContain('data-axt-style')
  })

  it('the appearance only decorates on top and writes no property that fights the site (the measured lesson of §7.5)', () => {
    // font: inherit once overrode the abstract heading's 1.4rem with the parent default; display / margin break side's grid pairing
    for (const property of ['font:', 'font-size', 'font-family', 'line-height', 'display:', 'margin:', 'margin-top', 'width:']) {
      expect(RULES).not.toContain(property)
    }
  })

  it('the underline has to be drawn explicitly on math / inline-block: text-decoration does not propagate into atomic inline boxes', () => {
    // The missing line the owner reported was this: the dotted line broke at formulas and inline boxes (measured 2026-09-05: computed text-decoration-line none)
    expect(RULES).toMatch(/html\[data-axt-underline\] :is\(\.axt-t[\s\S]*?:is\(math, \.ltx_inline-block, svg, img\)\)/)
  })

  it('the shared rule matches on “has an underline” rather than writing text-decoration on every translation: it would wipe the line the site draws under links', () => {
    expect(RULES).not.toMatch(/html\[data-axt-on\][^{]*\.axt-t[^{]*\{[^}]*text-decoration/)
  })

  it('line style and width both come from variables: the thickness from the configured thickness, the colour following the text colour', () => {
    expect(RULES).toContain('text-decoration-thickness: var(--axt-deco-thickness, 1px)')
    expect(RULES).toContain('text-decoration: underline var(--axt-deco-style) var(--axt-color, var(--axt-deco-color))')
  })

  it('the blur respects the system\'s “reduce motion”: the hover-to-sharpen transition is dropped', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(RULES)
    expect(reduced).not.toBeNull()
    expect(reduced![1]).toMatch(/data-axt-blur[^{]*\{[^}]*transition: none/)
  })

  it('no continuous animation: an animation changing the style burns CPU on a long paper (Codex on #52)', () => {
    // Measured main-thread tasks within 4 s on 600 translation blocks: glow's text-shadow animation 1028 ms, gradient's
    // background-position animation 573 ms. v12 removed these effects whole, and there must be no keyframes left
    expect(RULES).not.toContain('@keyframes')
    expect(RULES).not.toMatch(/animation:\s*axt-/)
  })

  it('the decoration never lands on the skeleton, the failure widget or side mode\'s structural clones: they carry .axt-t too but are no translations (Codex on #52)', () => {
    // The blur would smudge the formulas mirrored into the right column; the opacity would fade the Retry button with them
    for (const line of RULES.split('\n')) {
      if (!line.includes('.axt-t')) continue
      const excluded = ['.axt-pending', '.axt-error', '.axt-mirror', '.axt-split'].every(c => line.includes(c))
      expect([line, excluded]).toEqual([line, true])
    }
  })

  it('enable writes the underline and the blur onto <html>, in the same layer as the mode attribute', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', lookWith({ underline: 'wavy', blur: true }))
    expect(doc.documentElement.getAttribute(UNDERLINE_ATTR)).toBe('wavy')
    expect(doc.documentElement.hasAttribute(BLUR_ATTR)).toBe(true)
    expect(doc.documentElement.getAttribute('data-axt-mode')).toBe('stack')
  })

  it('with no appearance passed neither attribute is written: a mode switch must not touch the appearance', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack')
    expect(doc.documentElement.hasAttribute(UNDERLINE_ATTR)).toBe(false)
    expect(doc.documentElement.hasAttribute(BLUR_ATTR)).toBe(false)
  })

  it('switching to a configuration without underline / blur removes the attributes rather than leaving the previous state', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', lookWith({ underline: 'dashed', blur: true }))
    enable(doc, 'stack', LOOK)
    expect(doc.documentElement.hasAttribute(UNDERLINE_ATTR)).toBe(false)
    expect(doc.documentElement.hasAttribute(BLUR_ATTR)).toBe(false)
  })

  it('the advanced CSS is wrapped in our selector, and a change rewrites the style sheet', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', lookWith({ css: 'color: #1565c0;' }))
    const sheet = doc.querySelector('style[data-axt-sheet="modes"]')!
    expect(sheet.textContent).toContain(`${CUSTOM_STYLE_SELECTOR} {`)
    expect(sheet.textContent).toContain('color: #1565c0;')
    // enable again with new declarations: the same <style> element is updated, no second copy stacked
    enable(doc, 'stack', lookWith({ css: 'color: teal;' }))
    expect(doc.querySelectorAll('style[data-axt-sheet="modes"]')).toHaveLength(1)
    expect(doc.querySelector('style[data-axt-sheet="modes"]')!.textContent).toContain('color: teal;')
  })

  it('the declaration block accepts declarations only: braces, @ rules and `<` are refused (against slips, not a security boundary)', () => {
    expect(sanitizeCustomCss('color: red')).toEqual({ ok: true, css: 'color: red' })
    expect(sanitizeCustomCss('')).toEqual({ ok: true, css: '' })
    for (const bad of ['a { color: red }', 'color: red }', '@media print { }', '</style>']) {
      expect([bad, sanitizeCustomCss(bad).ok]).toEqual([bad, false])
    }
  })

  it('after restoring the original the appearance attributes on <html> vanish too (§7.1 item 4)', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'side', lookWith({ underline: 'wavy', blur: true, color: '#1565c0' }))
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
