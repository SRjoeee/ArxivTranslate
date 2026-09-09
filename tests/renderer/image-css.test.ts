import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Image overlay styles (DESIGN §15.2): happy-dom lacks layout, so test the rules themselves.

const CSS = readFileSync(join(import.meta.dirname, '../../src/styles/image.css'), 'utf8')
const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

describe('image.css', () => {
  it('anchor positioning: the image declares a name, its parent scopes it and establishes positioning, and the overlay uses anchor and anchor-size', () => {
    expect(RULES).toMatch(/img:has\(\+ \.axt-img\) \{\s*anchor-name: --axt-img;/)
    expect(RULES).toMatch(/:has\(> \.axt-img\) \{\s*position: relative;\s*anchor-scope: --axt-img;/)
    expect(RULES).toMatch(/\.axt-img \{[^}]*position-anchor: --axt-img;[^}]*top: anchor\(top\);[^}]*width: anchor-size\(width\);/)
    // unsupported anchor positioning leaves the entire block inactive and overlays hidden
    expect(RULES).toMatch(/@supports \(top: anchor\(top\)\)/)
  })

  it('stays outside the pairing grid, uses container font units, and does not intercept image clicks', () => {
    expect(RULES).toMatch(/\.axt-img \{[^}]*grid-column: auto;[^}]*grid-row: auto;/)
    expect(RULES).toMatch(/\.axt-img \{[^}]*container-type: size;/)
    expect(RULES).toMatch(/\.axt-img \{[^}]*pointer-events: none;/)
    expect(RULES).toMatch(/\.axt-img > span \{[^}]*pointer-events: auto;/)
  })

  it('visibility depends only on html attributes because split clones strip all overlay data-axt-* attributes', () => {
    expect(RULES).not.toMatch(/\[data-axt-img=/)
    for (const mode of ['side', 'stack', 'only']) {
      expect(RULES).toContain(`html[data-axt-mode="${mode}"][data-axt-img-modes~="${mode}"] .axt-img`)
    }
  })

  it('side hides overlays in originals using a rule after the visibility rule to win at equal specificity', () => {
    const show = RULES.indexOf('html[data-axt-mode="side"][data-axt-img-modes~="side"] .axt-img')
    const hide = RULES.indexOf('html[data-axt-mode="side"] [data-axt-split] .axt-img')
    expect(show).toBeGreaterThan(-1)
    expect(hide).toBeGreaterThan(show)
    // Only side: stack displays originals, only displays clones, and overlays follow whichever copy is visible.
    expect(RULES).not.toMatch(/html\[data-axt-mode="(stack|only)"\] \[data-axt-split\] \.axt-img/)
  })

  it('the hidden baseline is outside supports so unsupported browsers cannot show overlay text below images', () => {
    const supports = RULES.indexOf('@supports')
    const baseline = RULES.search(/\.axt-img \{\s*display: none;\s*\}/)
    expect(baseline).toBeGreaterThan(-1)
    expect(baseline).toBeLessThan(supports)
    // no duplicate display:none baseline exists inside supports; visibility uses attribute gates
    expect(RULES.slice(supports)).not.toMatch(/\n {2}\.axt-img \{[^}]*display: none/)
  })

  it('the stylesheet has no ltx_ selectors because overlays do not depend on site structure', () => {
    expect(RULES).not.toContain('ltx_')
  })
})
