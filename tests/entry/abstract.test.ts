import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABS_LINK_CLASS, AUTO_TRANSLATE_HASH, injectBilingualLink, relabelBilingualLink } from '@/core/abstract/link'
import { LOCALES } from '@/locales'

// The bilingual entry on the abstract page (issue #146). The fixture is a real arxiv.org/abs page: the insertion point relies on arXiv's own
// markup, and only a test against the real markup says anything
const PAGE = readFileSync(join(import.meta.dirname, '../fixtures/abs/1706.03762.html'), 'utf8')
const pageOf = (html = PAGE) => new DOMParser().parseFromString(html, 'text/html')
// The copy comes from the locale pack (UI.md §6): the Chinese one is taken here; the link's behaviour does not depend on the words
const LABEL = LOCALES['zh-CN'].S.page.abstractLink(LOCALES['zh-CN'].S.brand)

describe('the bilingual entry on the abstract page (#146)', () => {
  it('after a change of interface language the link already inserted is rewritten (Codex on #161)', () => {
    const doc = pageOf()
    expect(injectBilingualLink(doc, LABEL)).toBe(true)
    const en = LOCALES.en.S.page.abstractLink(LOCALES.en.S.brand)
    expect(relabelBilingualLink(doc, en)).toBe(true)
    expect(doc.querySelector(`.${ABS_LINK_CLASS}`)?.textContent).toBe(en)
    // On a page without this link nothing happens, and nothing throws
    expect(relabelBilingualLink(pageOf(), en)).toBe(false)
  })

  it('inserted after arXiv\'s own HTML link, pointing at the URL it gives plus the auto-start hash', () => {
    const doc = pageOf()
    const html = doc.querySelector<HTMLAnchorElement>('#latexml-download-link')!
    expect(injectBilingualLink(doc, LABEL)).toBe(true)

    const link = doc.querySelector<HTMLAnchorElement>(`.${ABS_LINK_CLASS}`)!
    expect(link.textContent).toBe(LABEL)
    // **The href arXiv gives**: it carries the version (v7); an id assembled by hand would point at the wrong version
    expect(link.getAttribute('href')).toBe(`${html.href}${AUTO_TRANSLATE_HASH}`)
    expect(link.getAttribute('href')).toContain('/html/1706.03762v7')
    // The position: right after the HTML entry, still in the same list
    expect(html.closest('li')!.nextElementSibling!.contains(link)).toBe(true)
    expect(link.closest('ul')).toBe(html.closest('ul'))
  })

  it('a paper without an HTML version gets nothing inserted', () => {
    // Such a paper's abstract page has no such element at all — not “a link pointing nowhere”, the whole entry is absent
    const doc = pageOf()
    doc.querySelector('#latexml-download-link')!.closest('li')!.remove()
    expect(injectBilingualLink(doc, LABEL)).toBe(false)
    expect(doc.querySelector(`.${ABS_LINK_CLASS}`)).toBeNull()
  })

  it('a second run does not insert a second link', () => {
    const doc = pageOf()
    expect(injectBilingualLink(doc, LABEL)).toBe(true)
    expect(injectBilingualLink(doc, LABEL)).toBe(false)
    expect(doc.querySelectorAll(`.${ABS_LINK_CLASS}`)).toHaveLength(1)
  })

  it('apart from the inserted line the page did not change by one byte', () => {
    // The abstract page is outside §7.1 (that speaks of the full-text page), but the same rule: add our own node only, touch nobody else's
    const doc = pageOf()
    const before = doc.body.outerHTML
    injectBilingualLink(doc, LABEL)
    const inserted = doc.querySelector(`.${ABS_LINK_CLASS}`)!.closest('li')!
    inserted.remove()
    expect(doc.body.outerHTML).toBe(before)
  })
})
