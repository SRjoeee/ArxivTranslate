import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CUSTOM_STYLE_SELECTOR, DECORATION_PRESETS, STYLE_PRESETS, STYLE_ATTR_NAME, customStyleRule, enable, restore, sanitizeCustomCss } from '@/core/renderer'
import { docOf } from './helpers'

const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/presets.css'), 'utf8')
/** Comments also mention property names; strip them before text assertions */
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('style presets (§7.5)', () => {
  it('every preset has a rule except none, which adds no decoration', () => {
    for (const preset of STYLE_PRESETS) {
      const has = RULES.includes(`[data-axt-style="${preset}"]`)
      // none is the default with no rule; customStyleRule builds custom rules at runtime.
      expect([preset, has]).toEqual([preset, preset !== 'none' && preset !== 'custom'])
    }
  })

  it('presets add decoration without properties that conflict with site styles (§7.5 measurements)', () => {
    // font: inherit once replaced a 1.4rem abstract heading with its parent default; display and margin disrupt side-grid pairing.
    for (const property of ['font:', 'font-size', 'font-family', 'line-height', 'display:', 'margin:', 'margin-top', 'width:']) {
      expect(RULES).not.toContain(property)
    }
  })

  it('underline presets explicitly target math and inline-block because text-decoration does not propagate to atomic inline boxes', () => {
    // This caused reported gaps at formulas and inline boxes; measured text-decoration-line was none on 2026-09-05.
    const shared = /html:is\(([^)]*)\) :is\(\.axt-t[\s\S]*?:is\(math, \.ltx_inline-block, svg, img\)\)/.exec(RULES)
    expect(shared).not.toBeNull()
    for (const preset of DECORATION_PRESETS) {
      expect(shared![1]).toContain(`[data-axt-style="${preset}"]`)
    }
  })

  it('shared rules list only underline presets; a wildcard would erase site link underlines', () => {
    // html[data-axt-style] .axt-t { text-decoration: … } would assign none to every preset.
    expect(RULES).not.toMatch(/html\[data-axt-style\][^{]*\{[^}]*text-decoration/)
  })

  it('respects reduced motion by stopping blink animation and blur hover transitions', () => {
    const reduced = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(RULES)
    expect(reduced).not.toBeNull()
    expect(reduced![1]).toMatch(/blink[^{]*\{[^}]*animation: none/)
    expect(reduced![1]).toMatch(/blur[^{]*\{[^}]*transition: none/)
  })

  it('only compositor animations remain; continuously animated styles consume CPU on long papers (Codex #52)', () => {
    // Measured main-thread work over four seconds with 600 translations: glow text-shadow took 1028 ms and gradient
    // background-position took 573 ms; both fell to 1 ms when static. blink changes opacity and took 3 ms, so it remains.
    const animated = [...RULES.matchAll(/html\[data-axt-style="([\w-]+)"\][^{]*\{[^}]*animation:\s*axt-/g)].map(m => m[1])
    expect(animated).toEqual(['blink'])
    expect(RULES).not.toContain('axt-gradient-flow')
    expect(RULES).not.toContain('axt-glow')
  })

  it('animation names use the axt- prefix (hard rule 5)', () => {
    for (const name of RULES.match(/@keyframes ([\w-]+)/g) ?? []) {
      expect(name.replace('@keyframes ', '')).toMatch(/^axt-/)
    }
  })

  it('highlighter repeats at line height because a one-shot gradient colors only the last line of multiline text (Codex #52)', () => {
    expect(RULES).toMatch(/html\[data-axt-style="marker"\] \.axt-t[\s\S]*?html\[data-axt-style="marker-gradient"\] \.axt-t[^{]*\{[^}]*background-size: 100% 1lh/)
    expect(RULES).toMatch(/background-repeat: repeat-y/)
  })

  it('quote excludes inline heading translations to preserve side-by-side original and translated headings', () => {
    expect(RULES).toMatch(/html\[data-axt-style="quote"\] \.axt-t:not\(\[data-axt-inline\]/)
  })

  it('decoration excludes spinners, failure controls, and structural side clones despite their axt-t class (Codex #52)', () => {
    // gradient color: transparent would hide Retry text; blur would obscure formulas mirrored into the right column.
    for (const line of RULES.split('\n')) {
      if (!line.includes('.axt-t')) continue
      const excluded = ['.axt-pending', '.axt-error', '.axt-mirror', '.axt-split'].every(c => line.includes(c))
      expect([line, excluded]).toEqual([line, true])
    }
  })

  it('enable writes the preset on html alongside the mode attribute', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', { preset: 'quote', customCss: '' })
    expect(doc.documentElement.getAttribute(STYLE_ATTR_NAME)).toBe('quote')
    expect(doc.documentElement.getAttribute('data-axt-mode')).toBe('stack')
  })

  it('omitting style writes no attribute because mode changes must not alter styling', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack')
    expect(doc.documentElement.hasAttribute(STYLE_ATTR_NAME)).toBe(false)
  })

  it('wraps custom CSS in the supplied selector and rewrites the stylesheet when it changes', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    enable(doc, 'stack', { preset: 'custom', customCss: 'color: #1565c0;' })
    const sheet = doc.querySelector('style[data-axt-sheet="modes"]')!
    expect(sheet.textContent).toContain(`${CUSTOM_STYLE_SELECTOR} {`)
    expect(sheet.textContent).toContain('color: #1565c0;')
    // Enabling with new custom CSS updates the same style element instead of adding another.
    enable(doc, 'stack', { preset: 'custom', customCss: 'color: red;' })
    expect(doc.querySelectorAll('style[data-axt-sheet="modes"]')).toHaveLength(1)
    expect(doc.querySelector('style[data-axt-sheet="modes"]')!.textContent).toContain('color: red;')
  })

  it('restore removes stylesheets and attributes to recover the identical DOM (§7.1)', () => {
    const doc = docOf('<p class="ltx_p" id="p1">Text.</p>')
    const before = doc.documentElement.outerHTML
    enable(doc, 'side', { preset: 'quote', customCss: '' })
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })
})

describe('sanitizeCustomCss', () => {
  it('accepts ordinary declarations and trims surrounding whitespace', () => {
    expect(sanitizeCustomCss('  color: #1565c0; opacity: .9;  ')).toEqual({ ok: true, css: 'color: #1565c0; opacity: .9;' })
    expect(sanitizeCustomCss('')).toEqual({ ok: true, css: '' })
    expect(sanitizeCustomCss('   ')).toEqual({ ok: true, css: '' })
  })

  it('rejects braces because a stray brace can unexpectedly alter the entire paper layout', () => {
    expect(sanitizeCustomCss('color: red; } body { display: none;')).toMatchObject({ ok: false })
    expect(sanitizeCustomCss('.foo { color: red; }')).toMatchObject({ ok: false })
  })

  it('rejects at-rules and less-than signs', () => {
    expect(sanitizeCustomCss('@import url(x)')).toMatchObject({ ok: false })
    expect(sanitizeCustomCss('color: red; </style>')).toMatchObject({ ok: false })
  })

  it('customStyleRule creates no empty rule for empty input and no rule for invalid input', () => {
    expect(customStyleRule('')).toBe('')
    expect(customStyleRule('   ')).toBe('')
    expect(customStyleRule('color: red; }')).toBe('')
    expect(customStyleRule('color: red;')).toBe(`${CUSTOM_STYLE_SELECTOR} {\ncolor: red;\n}\n`)
  })
})
