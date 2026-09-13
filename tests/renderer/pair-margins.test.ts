import { describe, expect, it } from 'vitest'
import { T_CLASS } from '@/core/marks'
import { clearPairMargins, readPairMargins, writePairMargins } from '@/core/renderer/pair-margins'
/** Read then write in one go — the shape production takes through the tidy layer (prep.ts) */
const alignPairMargins = (root: Document | Element): number => writePairMargins(readPairMargins(root))
import { docOf } from './helpers'

/** The site's adjacent-sibling margin rule of the form ar5iv `.ltx_role_affiliation + .ltx_role_affiliation` */
const SITE_CSS = '.aff + .aff { margin-top: 8px }'

/** The author area's shape: two pairs (email, affiliation), the translation copying the original block's class */
function setup(css = SITE_CSS): { original: HTMLElement; translation: HTMLElement } {
  document.head.innerHTML = `<style>${css}</style>`
  document.body.innerHTML = `<article class="ltx_document"><span class="box"
    ><span class="c mail">a@b</span><span class="c mail ${T_CLASS}">甲</span
    ><span class="c aff">Univ</span><span class="c aff ${T_CLASS}">大学</span
  ></span></article>`
  const original = document.querySelector<HTMLElement>(`.aff:not(.${T_CLASS})`)!
  return { original, translation: original.nextElementSibling as HTMLElement }
}

/** happy-dom returns an empty string for an undeclared margin, a browser "0px" */
const mt = (el: Element) => getComputedStyle(el).marginTop || '0px'

describe('alignPairMargins', () => {
  it('an inserted translation changes what the adjacent-sibling rule matches, so the top margins of a pair disagree', () => {
    const { original, translation } = setup()
    // The source's previous sibling is the previous translation (.mail); the translation's previous sibling is its own source (.aff)
    expect(mt(original)).toBe('0px')
    expect(mt(translation)).toBe('8px')
  })

  it('copies the source\'s top margin onto the translation, and the computed values agree', () => {
    const { original, translation } = setup()
    expect(alignPairMargins(document)).toBe(1)
    expect(mt(translation)).toBe(mt(original))
    expect(translation.style.marginTop).toBe('0px')
  })

  it('idempotent: a repeated call reports no change (the value is written already)', () => {
    setup()
    expect(alignPairMargins(document)).toBe(1)
    expect(alignPairMargins(document)).toBe(0)
  })

  it('a recomputation wipes the previous round\'s value first, so a changed site margin is followed', () => {
    const { translation } = setup()
    alignPairMargins(document)
    expect(translation.style.marginTop).toBe('0px')
    // After a viewport change the site style gives a new margin (imitated here by swapping the rule)
    document.head.innerHTML = '<style>.aff { margin-top: 5px }</style>'
    // Both became 5px and agree by themselves: wiping the 0px written last round still counts as a change
    expect(alignPairMargins(document)).toBe(1)
    expect(translation.style.marginTop).toBe('')
    expect(mt(translation)).toBe('5px')
  })

  it('the original node is not rewritten (§7.1)', () => {
    const { original } = setup()
    alignPairMargins(document)
    expect(original.getAttribute('style')).toBeNull()
  })

  it('clearPairMargins gives the inline margins back to the site style', () => {
    const { translation } = setup()
    alignPairMargins(document)
    clearPairMargins(document)
    expect(translation.style.marginTop).toBe('')
    expect(mt(translation)).toBe('8px')
  })

  it('no pairing when the previous sibling is a translation too (a mirror next to a translation)', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = `<article class="ltx_document"><span class="c">x</span
      ><span class="c ${T_CLASS}">甲</span><span class="c ${T_CLASS}">乙</span></article>`
    expect(alignPairMargins(document)).toBe(0)
  })

  it('a translation inside a split clone takes no part in the alignment: its previous sibling is no source', () => {
    // Inside the clone the source member was removed, so the translation's previous sibling is the figure, whose margin it would copy (Codex on #26)
    document.head.innerHTML = '<style>img { margin-top: 30px }</style>'
    document.body.innerHTML = `<article class="ltx_document"><figure class="ltx_figure axt-split ${T_CLASS}">
      <img src="a.png"><figcaption class="ltx_caption ${T_CLASS}">图 1</figcaption></figure></article>`
    expect(alignPairMargins(document)).toBe(0)
    expect(document.querySelector('figcaption')!.getAttribute('style')).toBeNull()
  })
})

describe('reads and writes apart (issue #46): the tidy layer puts every read before any write', () => {
  it('readPairMargins writes no inline margin, writePairMargins does; together they equal alignPairMargins', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" style="margin-top: 8px">A</p><p class="ltx_p axt-t" data-axt-for="a">译</p></div>')
    const t = doc.querySelector('.axt-t') as HTMLElement
    const plan = readPairMargins(doc)
    expect(plan.pairs).toHaveLength(1)
    expect(t.style.marginTop).toBe('') // the read phase writes nothing
    const changed = writePairMargins(plan)
    const again = docOf('<div class="ltx_para"><p class="ltx_p" style="margin-top: 8px">A</p><p class="ltx_p axt-t" data-axt-for="a">译</p></div>')
    expect(changed).toBe(alignPairMargins(again))
    expect(t.style.marginTop).toBe((again.querySelector('.axt-t') as HTMLElement).style.marginTop)
  })
})

