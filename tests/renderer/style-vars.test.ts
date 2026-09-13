// The reader's appearance values (#47, rebuilt in v12): colour, opacity, underline thickness and
// the band. `appearanceRule` turns them into rules that go into the injected sheet — never into an
// inline style on <html>, which restore()'s prefix sweep could not clear (§7.1 would break).
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyStyle, enable, restore } from '@/core/renderer/page'
import { TRANSLATION_SELECTOR, appearanceRule } from '@/core/renderer/style-preset'
import { sanitizeColor } from '@/core/renderer/style-values'
import { BUILT_IN_HIGHLIGHTS, type Look } from '@/config/appearance'
import { docOf } from './helpers'
import { LOOK, lookWith } from './looks'

describe('sanitizeColor', () => {
  it('lets the common spellings through', () => {
    for (const value of ['#1565c0', '#abc', '#11223344', 'red', 'transparent', 'rgb(21 101 192)', 'oklch(0.6 0.1 250)', 'color-mix(in oklab, currentColor 40%, transparent)']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, true])
    }
  })

  it('the empty string is valid and means follow the original', () => {
    expect(sanitizeColor('   ')).toEqual({ ok: true, color: '' })
  })

  it('hex takes 3 / 4 / 6 / 8 digits only: any other length the browser drops whole, and storing it makes the setting a no-op', () => {
    for (const value of ['#abc', '#abcd', '#a1b2c3', '#a1b2c3d4']) expect([value, sanitizeColor(value).ok]).toEqual([value, true])
    // These pass the allowlist yet never reach the rendering: the reader would see the setting stored and the page unchanged (Codex on #106)
    for (const value of ['#ab', '#abcde', '#a1b2c3d', '#a1b2c3d4e']) expect([value, sanitizeColor(value).ok]).toEqual([value, false])
  })

  it('named colours are looked up in an exact table, not “any run of lowercase letters”', () => {
    for (const value of ['red', 'rebeccapurple', 'darkslategrey', 'transparent', 'currentcolor', 'CurrentColor']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, true])
    }
    // These pass the lexical shape but are no colours: storable, yet the browser drops the whole declaration (Codex on #106)
    for (const value of ['banana', 'reddish', 'colour', 'notacolor', 'inherit', 'initial', 'unset', 'revert']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, false])
    }
  })

  it('blocks input that would open a new declaration or close the rule', () => {
    // Typed into the box, "red; opacity: 0" adds a declaration; "}" closes early and what follows becomes a page-wide rule
    for (const value of ['red; opacity: 0', 'red}', '#fff{', 'url(x)', 'var(--x)', '<script>']) {
      expect([value, sanitizeColor(value).ok]).toEqual([value, false])
    }
  })
})

describe('appearanceRule', () => {
  const all = (look: Look) => { const r = appearanceRule(look); return r.base + r.overrides }
  const band = (over: Partial<(typeof BUILT_IN_HIGHLIGHTS)[number]>) => ({ ...BUILT_IN_HIGHLIGHTS[0]!, ...over })

  it('the default appearance writes only the two highlight variables: the translation itself is pixel for pixel as before this feature', () => {
    const css = all(LOOK)
    expect(css).toContain('--axt-hl-mix: 22%;')
    expect(css).toContain(`--axt-hl-color: ${BUILT_IN_HIGHLIGHTS[0]!.color};`)
    expect(css).not.toContain('--axt-color:')
    expect(css).not.toContain('opacity:')
  })

  it('colour and opacity act on the “real translation”, excluding the skeleton, the failure widget, mirrors and split copies', () => {
    const css = all(lookWith({ color: '#1565c0', opacity: 0.8 }))
    expect(css).toContain(TRANSLATION_SELECTOR)
    expect(css).toContain('--axt-color: #1565c0;')
    expect(css).toContain('opacity: 0.8;')
    // Mirrors and split copies are visual clones of the **source** and must not wear the translation's colour and opacity (the same line as §7.5 draws)
    for (const cls of ['.axt-pending', '.axt-error', '.axt-mirror', '.axt-split']) {
      expect([cls, css.includes(cls)]).toEqual([cls, true])
    }
  })

  it('the highlight configuration is written as colour + percentage: the band\'s strength is consumed by color-mix', () => {
    const css = all({ style: LOOK.style, highlight: band({ color: '#e91e63', opacity: 0.3 }) })
    expect(css).toContain('html[data-axt-on] {')
    expect(css).toContain('--axt-hl-color: #e91e63;')
    expect(css).toContain('--axt-hl-mix: 30%;')
  })

  it('the highlight strength is clamped to the schema\'s bounds: caught when a slip makes it invisible or a smear', () => {
    expect(all({ style: LOOK.style, highlight: band({ opacity: 0 }) })).toContain('--axt-hl-mix: 5%;')
    expect(all({ style: LOOK.style, highlight: band({ opacity: 1 }) })).toContain('--axt-hl-mix: 60%;')
  })

  it('the line width is written only when a line is really drawn: a configuration without an underline must leave no dangling variable', () => {
    expect(all(lookWith({ underline: 'wavy', thickness: 2 }))).toContain('--axt-deco-thickness: 2px;')
    expect(all(lookWith({ underline: 'none', thickness: 2 }))).not.toContain('--axt-deco-thickness')
    expect(all(lookWith({ underline: 'wavy', thickness: 1 }))).not.toContain('--axt-deco-thickness')
  })

  it('the opacity uses “top-level real translation”, so a nested footnote translation does not multiply it twice', () => {
    // side mode's localizeNotes inserts .axt-note-t.axt-t inside the paragraph translation; matched on both levels
    // the lower bound 0.3 would render as 0.09. Chrome, measured with this selector: top level 0.5, nested footnote 1, split copy 1, the real translation inside the copy 0.5
    expect(appearanceRule(lookWith({ opacity: 0.5 })).base).toContain(':not(:where(')
    // The colour rule needs no such exclusion: --axt-color is an inherited property, and nesting does not stack it
    expect(appearanceRule(lookWith({ color: '#1565c0' })).overrides).not.toContain(':not(:where(')
  })

  it('the opacity lands in base, the colour and the highlight in overrides: the two parts sit on the two sides of the style sheet', () => {
    const r = appearanceRule({ style: { ...LOOK.style, color: '#1565c0', opacity: 0.5 }, highlight: band({ color: '#e91e63' }) })
    // base before presets.css → the blur rule can override the baseline and multiply --axt-opacity in its own formula
    expect(r.base).toContain('--axt-opacity: 0.5;')
    expect(r.base).toContain('opacity: var(--axt-opacity, 1);')
    expect(r.base).not.toContain('--axt-color')
    // overrides after → wins over any default in the style sheet
    expect(r.overrides).toContain('--axt-color: #1565c0;')
    expect(r.overrides).toContain('--axt-hl-color: #e91e63;')
    expect(r.overrides).not.toContain('opacity: var')
  })

  it('an invalid colour is dropped rather than written into the rule as it is', () => {
    expect(all(lookWith({ color: 'red; opacity: 0' }))).not.toContain('--axt-color')
  })

  it('the opacity does not go below the lower bound: caught when a slip makes it invisible', () => {
    expect(all(lookWith({ opacity: 0 }))).toContain('--axt-opacity: 0.3;')
  })
})

describe('injection and restore', () => {
  // In vitest a `?inline` CSS import resolves to an **empty string** (css: false in vitest.config),
  // so “the generated rules vs presets.css, which comes first” cannot be asserted in a unit test — an indexOf comparison is always -1 and the assertion always true.
  // Asserted instead are two things that can really be checked: inside the injected sheet base comes before overrides; the text contract of presets.css.
  // The real cascade is covered by browser measurement (blur with the slider at 0.5 → computed 0.375)
  it('inside the injected sheet base comes before overrides', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', lookWith({ blur: true, color: '#1565c0', opacity: 0.5 }))
    const css = doc.querySelector('style[data-axt-sheet]')!.textContent ?? ''
    expect(css.indexOf('--axt-opacity: 0.5;')).toBeGreaterThanOrEqual(0)
    expect(css.indexOf('--axt-opacity: 0.5;')).toBeLessThan(css.indexOf('--axt-color: #1565c0;'))
    // Dropping the returned object straight into a template string leaves this (measured: it happened on the settings page's preview)
    expect(css).not.toContain('[object Object]')
  })

  it('stacking declarations act on the top-level translation only; a nested footnote translation is not multiplied a second time', () => {
    // opacity / filter both act on the whole subtree: side mode's .axt-note-t.axt-t nests inside the paragraph translation,
    // and matched on both levels they multiply. Chrome, measured (slider 0.5): before, outer/nested both 0.375 and each got one
    // blur(4px); after, nested is 1 / none (Codex on #106)
    const css = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@media[^{]*\{/g, '')
    const offenders: string[] = []
    for (const m of rules.matchAll(/([^{}]*\.axt-t[^{}]*)\{([^{}]*)\}/g)) {
      const [, selector, body] = m
      // Parsed declaration by declaration, without a negative-lookahead regex: `\s*` backtracks to zero width and lets (?!none) evaluate at the space, always true
      const compounds = body!.split(';').some(decl => {
        const [prop, ...rest] = decl.split(':')
        return ['opacity', 'filter', 'animation'].includes(prop!.trim()) && rest.join(':').trim() !== 'none'
      })
      if (!compounds) continue
      if (!selector!.includes(':not(:where(')) offenders.push(selector!.trim())
    }
    expect(offenders).toEqual([])
  })

  it('in presets.css the blur consumes --axt-opacity rather than overriding it', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
    const rules = css.replace(/\/\*[\s\S]*?\*\//g, '')
    // The blur brings its own 0.75 and must multiply the reader's value, or the slider has no effect on it (Codex on #106)
    expect(rules).toContain('calc(var(--axt-opacity, 1) * 0.75)')
    // No hard-coded bare opacity value may remain; it would override the reader's value
    expect(rules).not.toMatch(/opacity:\s*0?\.\d+;/)
  })

  it('the advanced declaration block still has the last word', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    enable(doc, 'stack', lookWith({ css: 'color: teal;', color: '#1565c0' }))
    const css = doc.querySelector('style[data-axt-sheet]')!.textContent ?? ''
    expect(css.indexOf('color: teal;')).toBeGreaterThan(css.indexOf('--axt-color: #1565c0'))
  })

  it('applyStyle recomputes that sheet only and touches no node; returns false with translation off', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    expect(applyStyle(doc, lookWith({ color: '#1565c0' }))).toBe(false)
    enable(doc, 'stack', LOOK)
    const body = doc.body.outerHTML
    expect(applyStyle(doc, lookWith({ underline: 'dotted', color: '#1565c0', opacity: 0.8 }))).toBe(true)
    expect(doc.documentElement.getAttribute('data-axt-underline')).toBe('dotted')
    expect(doc.querySelector('style[data-axt-sheet]')!.textContent).toContain('--axt-color: #1565c0')
    // Only the injected sheet and the attributes on <html> change; body does not change by one byte
    expect(doc.body.outerHTML).toBe(body)
    // Still one sheet only
    expect(doc.querySelectorAll('style[data-axt-sheet]')).toHaveLength(1)
  })

  it('after restoring the original the DOM equals the pre-translation one byte for byte (§7.1 item 4)', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Hello.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'side', lookWith({ underline: 'wavy', color: '#1565c0', opacity: 0.6 }))
    applyStyle(doc, lookWith({ blur: true, color: 'red', opacity: 0.4 }))
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})
