// One definition of "a real translation node" (ADR-0003): `TRANSLATION_EXCLUDED_CLASSES` in attrs.ts.
// The style sheets cannot import it, so every `.axt-t:not(…)` they write that names `.axt-pending`
// must list exactly the same classes — issue #46 was this list drifting between two copies.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REAL_TRANSLATION, TRANSLATION_EXCLUDED_CLASSES } from '@/core/renderer/attrs'
import { TOP_TRANSLATION_SELECTOR, TRANSLATION_SELECTOR } from '@/core/renderer/style-preset'

const STYLES = join(import.meta.dirname, '../../src/styles')
const canonical = TRANSLATION_EXCLUDED_CLASSES.map(c => `.${c}`).join(', ')

describe('the translation boundary', () => {
  it('is the four injected sub-classes, in the documented order', () => {
    expect(canonical).toBe('.axt-pending, .axt-error, .axt-mirror, .axt-split')
    expect(REAL_TRANSLATION).toBe(`.axt-t:not(${canonical})`)
    expect(TRANSLATION_SELECTOR).toBe(`html[data-axt-on] ${REAL_TRANSLATION}`)
    expect(TOP_TRANSLATION_SELECTOR).toContain(REAL_TRANSLATION)
  })

  it('every copy in the style sheets lists the same classes', () => {
    const seen: string[] = []
    for (const file of readdirSync(STYLES).filter(f => f.endsWith('.css'))) {
      const css = readFileSync(join(STYLES, file), 'utf8')
      for (const m of css.matchAll(/\.axt-t:not\(([^)]*)\)/g)) {
        const list = m[1]!
        if (!list.includes('.axt-pending')) continue // a deliberately narrower list, e.g. `:not(.axt-error)` alone
        seen.push(`${file}: ${list}`)
        expect(list, `${file} writes a different boundary`).toBe(canonical)
      }
    }
    // the sheets do carry the boundary — a regex that matched nothing would pass vacuously
    expect(seen.length).toBeGreaterThanOrEqual(6)
  })
})
