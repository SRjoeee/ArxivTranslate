import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { FOR_ATTR, MIRROR_CLASS, T_CLASS, createMirrors, renderImage, renderText, restore } from '@/core/renderer'
import { IMG_CLASS } from '@/core/marks'
import { docOf, frag } from './helpers'

/** Build a container with an existing translation so container detection applies */
const withTranslation = (body: string) => {
  const doc = docOf(body)
  const blocks = extract(doc)
  markBlocks(blocks)
  const first = blocks.find(b => b.kind === 'text') as TextBlock | undefined
  if (first) renderText(first, frag(doc, '译文'))
  return doc
}

describe('createMirrors', () => {
  it('calling before translation starts does nothing; unmarked top-level elements would otherwise be cloned whole (observed regression)', () => {
    const doc = docOf('<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6>'
      + '<p class="ltx_p" id="a1">Long English abstract.</p></div>'
      + '<section class="ltx_section"><h2 class="ltx_title ltx_title_section">Intro</h2>'
      + '<div class="ltx_para"><p class="ltx_p" id="p1">Body.</p></div></section>')
    expect(createMirrors(doc)).toBe(0)
  })

  it('does not mirror untouched sections during translation, avoiding duplicate clones when translations arrive', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">One.</p></div>'
      + '<section class="ltx_section"><div class="ltx_para"><p class="ltx_p" id="p2">Two.</p></div></section>')
    const blocks = extract(doc)
    markBlocks(blocks)
    renderText(blocks[0] as TextBlock, frag(doc, '译文'))
    createMirrors(doc)
    const section = doc.querySelector('section.ltx_section')!
    expect(section.nextElementSibling).toBeNull()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('mirrors formulas as soon as blocks are marked, without waiting for translations that formulas never receive', () => {
    // Observed in 2312.17141: all 413 mirrors appeared only at translation completion; formulas previously spanned both columns.
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_equation" id="E1"><tbody><tr><td class="ltx_eqn_cell">x=1</td></tr></tbody></table></div>')
    markBlocks(extract(doc))
    expect(createMirrors(doc)).toBe(1)
    expect(doc.querySelector(`.ltx_equation.${MIRROR_CLASS}`)).not.toBeNull()
    // The marked paragraph itself must never be cloned.
    expect(doc.querySelectorAll('.ltx_p')).toHaveLength(1)
  })

  it('copies untranslated container content and marks it axt-t plus axt-mirror', () => {
    const doc = withTranslation('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_equation" id="E1"><tbody><tr><td class="ltx_eqn_cell">x=1</td></tr></tbody></table></div>')
    expect(createMirrors(doc)).toBe(1)
    const mirror = doc.getElementById('E1')!.nextElementSibling!
    expect(mirror.classList.contains(T_CLASS)).toBe(true)
    expect(mirror.classList.contains(MIRROR_CLASS)).toBe(true)
    expect(mirror.tagName).toBe('TABLE')
    expect(mirror.hasAttribute('id')).toBe(false)
    expect(mirror.getAttribute(FOR_ATTR)).toMatch(/^mirror:/)
  })

  it('bibliographies mirror only labels: author blocks translate themselves since 2026-09-06 (§5.4)', () => {
    const doc = docOf('<ul class="ltx_biblist"><li class="ltx_bibitem" id="b1">'
      + '<span class="ltx_tag ltx_tag_bibitem">[1]</span>'
      + '<span class="ltx_bibblock">A. Author, B. Author.</span>'
      + '<span class="ltx_bibblock">Some title.</span></li></ul>')
    const blocks = extract(doc)
    markBlocks(blocks)
    // Both segments are translation units with translations; when authors were skipped, their untranslated segment needed a balancing copy.
    expect(blocks.filter(b => b.kind === 'text')).toHaveLength(2)
    for (const b of blocks) renderText(b as TextBlock, frag(doc, '译文'))
    createMirrors(doc)
    const kinds = Array.from(doc.getElementById('b1')!.children)
      .map(c => `${Array.from(c.classList).filter(x => x.startsWith('ltx_'))[0]}${c.classList.contains(MIRROR_CLASS) ? '(mirror)' : c.classList.contains(T_CLASS) ? '(translation)' : ''}`)
    expect(kinds).toContain('ltx_tag(mirror)')
    expect(kinds.filter(k => k === 'ltx_bibblock(mirror)')).toHaveLength(0)
    expect(kinds.filter(k => k === 'ltx_bibblock(translation)')).toHaveLength(2)
  })

  it('does not mirror pending blocks, avoiding both a clone and translation after completion', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">One.</p><p class="ltx_p" id="p2">Two.</p></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    renderText(blocks[0] as TextBlock, frag(doc, '译文'))
    createMirrors(doc)
    // p2 is untranslated but is a block and must not be mirrored.
    expect(doc.getElementById('p2')!.nextElementSibling).toBeNull()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('does not mirror translated blocks or containers with translations; delegates containers to their children', () => {
    const doc = withTranslation('<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="c1">Cap.</figcaption></figure>')
    createMirrors(doc)
    const figure = doc.getElementById('F1')!
    expect(figure.nextElementSibling).toBeNull()
    expect(figure.querySelector(`.${MIRROR_CLASS}`)?.tagName).toBe('IMG')
  })

  it('repeated calls are idempotent and add no duplicates', () => {
    const doc = withTranslation('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_equation" id="E1"><tbody><tr><td>x</td></tr></tbody></table></div>')
    expect(createMirrors(doc)).toBe(1)
    expect(createMirrors(doc)).toBe(0)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('restoration removes mirrors and recovers the exact DOM', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = '<article class="ltx_document"><div class="ltx_para">'
      + '<p class="ltx_p" id="p1">Text.</p><table class="ltx_equation" id="E1"><tbody><tr><td>x</td></tr></tbody></table>'
      + '</div></article>'
    const before = document.documentElement.outerHTML
    const blocks = extract(document)
    markBlocks(blocks)
    renderText(blocks[0] as TextBlock, frag(document, '译文'))
    expect(createMirrors(document)).toBe(1)
    restore(document)
    expect(document.documentElement.outerHTML).toBe(before)
  })

  it('stack regions generate no mirrors because they have no right column and would duplicate content vertically', () => {
    // Multipanel figure cells: 2312.17141 duplicated each panel formula, displaying all content twice.
    const doc = docOf(`
      <div class="ltx_para"><p class="ltx_p">x</p><p class="ltx_p ${T_CLASS}" data-axt-for="1">译</p></div>
      <figure class="ltx_figure"><div class="ltx_flex_figure"><div class="ltx_flex_cell">
        <figure class="ltx_figure ltx_figure_panel">
          <table class="ltx_equation"><tbody><tr><td>E</td></tr></tbody></table>
          <figcaption class="ltx_caption">(a) panel</figcaption>
          <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="2">(a) 面板</figcaption>
        </figure>
      </div></div></figure>`)
    createMirrors(doc)
    expect(doc.querySelectorAll('.ltx_flex_cell .axt-mirror')).toHaveLength(0)
  })

  it('does not mirror outward-floating marginal notes or publication metadata', () => {
    // In 2312.17141, DOI, journal, and CCS metadata were duplicated and the left floating copy overlapped the right column.
    const doc = docOf(`
      <span class="ltx_pubnotes ltx_pubnotes_meta"><span class="ltx_pubnotes_content">DOI: x</span></span>
      <div class="ltx_para"><p class="ltx_p">x</p><p class="ltx_p ${T_CLASS}" data-axt-for="1">译</p></div>`)
    createMirrors(doc)
    expect(doc.querySelectorAll('.ltx_pubnotes')).toHaveLength(1)
  })

  describe('image overlays (DESIGN §15.2)', () => {
    /** Figure with a caption block: figure is a container and img its direct child */
    const FIG = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"><figcaption class="ltx_caption" id="F1.cap">Figure 1.</figcaption></figure>'
    const overlayOn = (doc: Document) => {
      const el = doc.querySelector('img') as HTMLImageElement
      renderImage({ id: el.id, el }, [{ x: 0, y: 0, w: 0.3, h: 0.05, lines: 1, source: 'Static charge', text: '静态电荷' }])
    }

    it('an image followed by an overlay is already paired; neither it nor the overlay is mirrored', () => {
      const doc = docOf(FIG)
      const blocks = extract(doc)
      markBlocks(blocks)
      overlayOn(doc)
      createMirrors(doc)
      expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
      expect(doc.querySelectorAll(`.${IMG_CLASS}`)).toHaveLength(1)
    })

    it('images without overlays still mirror normally, preserving ordinary mirroring behavior', () => {
      const doc = docOf(FIG)
      markBlocks(extract(doc))
      createMirrors(doc)
      expect(doc.querySelector(`.${MIRROR_CLASS}`)!.tagName).toBe('IMG')
    })

    it('does not mirror an entire wrapper containing an image and overlay', () => {
      const doc = docOf('<figure class="ltx_figure" id="F1"><div class="ltx_flex_cell ltx_flex_size_1"><img class="ltx_graphics" src="a.png" id="F1.g1"></div><figcaption class="ltx_caption" id="F1.cap">Figure 1.</figcaption></figure>')
      markBlocks(extract(doc))
      overlayOn(doc)
      createMirrors(doc)
      expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
    })
  })
})
