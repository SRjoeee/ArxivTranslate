import { describe, expect, it } from 'vitest'
import { T_CLASS, alignPairMargins, clearPairMargins, readPairMargins, writePairMargins } from '@/core/renderer'
import { docOf } from './helpers'

/** Site adjacent-sibling margin rules such as ar5iv ltx_role_affiliation + ltx_role_affiliation */
const SITE_CSS = '.aff + .aff { margin-top: 8px }'

/** Author area: two pairs (email and affiliation); translations inherit original classes */
function setup(css = SITE_CSS): { original: HTMLElement; translation: HTMLElement } {
  document.head.innerHTML = `<style>${css}</style>`
  document.body.innerHTML = `<article class="ltx_document"><span class="box"
    ><span class="c mail">a@b</span><span class="c mail ${T_CLASS}">甲</span
    ><span class="c aff">Univ</span><span class="c aff ${T_CLASS}">大学</span
  ></span></article>`
  const original = document.querySelector<HTMLElement>(`.aff:not(.${T_CLASS})`)!
  return { original, translation: original.nextElementSibling as HTMLElement }
}

/** happy-dom returns empty text for undeclared margins; browsers return 0px */
const mt = (el: Element) => getComputedStyle(el).marginTop || '0px'

describe('alignPairMargins', () => {
  it('inserting translations changes adjacent-sibling matching and gives pair members different top margins', () => {
    const { original, translation } = setup()
    // The original follows the preceding mail translation; its translation follows its own aff original.
    expect(mt(original)).toBe('0px')
    expect(mt(translation)).toBe('8px')
  })

  it('copies the original top margin onto its translation so computed values match', () => {
    const { original, translation } = setup()
    expect(alignPairMargins(document)).toBe(1)
    expect(mt(translation)).toBe(mt(original))
    expect(translation.style.marginTop).toBe('0px')
  })

  it('repeated calls report no changes once values are set', () => {
    setup()
    expect(alignPairMargins(document)).toBe(1)
    expect(alignPairMargins(document)).toBe(0)
  })

  it('clears previous values before recomputing so changes in site margins take effect', () => {
    const { translation } = setup()
    alignPairMargins(document)
    expect(translation.style.marginTop).toBe('0px')
    // Simulate a resized window changing site margins by replacing the rule.
    document.head.innerHTML = '<style>.aff { margin-top: 5px }</style>'
    // Both now naturally have 5px; clearing the previously fixed 0px still counts as a change.
    expect(alignPairMargins(document)).toBe(1)
    expect(translation.style.marginTop).toBe('')
    expect(mt(translation)).toBe('5px')
  })

  it('leaves original nodes unchanged (§7.1)', () => {
    const { original } = setup()
    alignPairMargins(document)
    expect(original.getAttribute('style')).toBeNull()
  })

  it('clearPairMargins returns inline margin control to site CSS', () => {
    const { translation } = setup()
    alignPairMargins(document)
    clearPairMargins(document)
    expect(translation.style.marginTop).toBe('')
    expect(mt(translation)).toBe('8px')
  })

  it('does not pair when the preceding sibling is another translation, such as an adjacent mirror', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = `<article class="ltx_document"><span class="c">x</span
      ><span class="c ${T_CLASS}">甲</span><span class="c ${T_CLASS}">乙</span></article>`
    expect(alignPairMargins(document)).toBe(0)
  })

  it('translations inside split clones are excluded because their preceding siblings are not originals', () => {
    // Original members are removed from clones, so a caption translation follows the image and would copy the wrong margin (Codex #26).
    document.head.innerHTML = '<style>img { margin-top: 30px }</style>'
    document.body.innerHTML = `<article class="ltx_document"><figure class="ltx_figure axt-split ${T_CLASS}">
      <img src="a.png"><figcaption class="ltx_caption ${T_CLASS}">图 1</figcaption></figure></article>`
    expect(alignPairMargins(document)).toBe(0)
    expect(document.querySelector('figcaption')!.getAttribute('style')).toBeNull()
  })
})

describe('separate reads and writes so preparation reads before any mutation (issue #46)', () => {
  it('readPairMargins does not write inline margins; writePairMargins does, and together they match alignPairMargins', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" style="margin-top: 8px">A</p><p class="ltx_p axt-t" data-axt-for="a">译</p></div>')
    const t = doc.querySelector('.axt-t') as HTMLElement
    const plan = readPairMargins(doc)
    expect(plan.pairs).toHaveLength(1)
    expect(t.style.marginTop).toBe('') // No writes during the read phase
    const changed = writePairMargins(plan)
    const again = docOf('<div class="ltx_para"><p class="ltx_p" style="margin-top: 8px">A</p><p class="ltx_p axt-t" data-axt-for="a">译</p></div>')
    expect(changed).toBe(alignPairMargins(again))
    expect(t.style.marginTop).toBe((again.querySelector('.axt-t') as HTMLElement).style.marginTop)
  })
})

