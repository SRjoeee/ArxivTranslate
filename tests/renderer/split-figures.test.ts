// Whole-figure splitting (DESIGN §7.2). Images and formulas lack translations, leaving the right side of block pairs empty.
// Spanning both columns loses comparison, so clone the whole figure and retain only translated text in the clone.
import { describe, expect, it } from 'vitest'
import { MIRROR_CLASS, SPLIT_ATTR, SPLIT_CLASS, T_CLASS, dropStaleSplits, renderImage, restore, splitFigures } from '@/core/renderer'
import { IMG_CLASS } from '@/core/marks'
import { ID_ATTR } from '@/core/extractor'
import { docOf } from './helpers'

/** Figure with a subfigure caption: graphic, caption, and caption translation */
const figure = (extra = '') => `<figure class="ltx_figure">
  <img class="ltx_graphics" src="a.png" width="600" height="200">
  <figcaption class="ltx_caption">Figure 1. Original</figcaption>
  <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="c1">图 1. 译文</figcaption>${extra}
</figure>`

describe('splitFigures', () => {
  it('clones figures containing pairs and retains only translated text in the clone', () => {
    const doc = docOf(figure())
    expect(splitFigures(doc)).toBe(1)
    const original = doc.querySelector(`figure[${SPLIT_ATTR}]`)!
    const clone = original.nextElementSibling!
    expect(clone.classList.contains(SPLIT_CLASS)).toBe(true)
    expect(clone.classList.contains(T_CLASS)).toBe(true) // Pairing rules use this class to place the clone in the right column.
    // The clone retains the graphic and translated caption but removes the original caption.
    expect(clone.querySelector('img')).not.toBeNull()
    expect(clone.querySelectorAll('.ltx_caption')).toHaveLength(1)
    expect(clone.textContent).toContain('图 1. 译文')
    expect(clone.textContent).not.toContain('Figure 1. Original')
    // The original gains markers without changing any children.
    expect(original.querySelectorAll('.ltx_caption')).toHaveLength(2)
  })

  it('clones omit original IDs and block markers', () => {
    const doc = docOf(`<figure class="ltx_figure" id="S1.F1">
      <img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption" id="S1.F1.cap" data-axt-id="b1">cap</figcaption>
      <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="b1">说明</figcaption></figure>`)
    splitFigures(doc)
    const clone = doc.querySelector(`.${SPLIT_CLASS}`)!
    expect(clone.id).toBe('')
    expect(clone.querySelector('[id]')).toBeNull()
    expect(clone.querySelector('[data-axt-id]')).toBeNull()
  })

  it('figures without translations are not split; mirroring handles them', () => {
    const doc = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png"></figure>')
    expect(splitFigures(doc)).toBe(0)
  })

  it('media-free floats are not split because table floats already have translated table clones', () => {
    const doc = docOf(`<figure class="ltx_table">
      <table class="ltx_tabular"><tbody><tr><td>a</td></tr></tbody></table>
      <table class="ltx_tabular ${T_CLASS}" data-axt-for="t1"><tbody><tr><td>甲</td></tr></tbody></table>
      <figcaption class="ltx_caption">Table 1</figcaption>
      <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="c1">表 1</figcaption></figure>`)
    expect(splitFigures(doc)).toBe(0)
  })

  it('inline math in table-float captions does not trigger splitting because it is not standalone media', () => {
    // Both table floats in 2312.17527 were incorrectly split (Codex #26).
    const doc = docOf(`<figure class="ltx_table">
      <table class="ltx_tabular"><tbody><tr><td>a</td></tr></tbody></table>
      <table class="ltx_tabular ${T_CLASS}" data-axt-for="t1"><tbody><tr><td>甲</td></tr></tbody></table>
      <figcaption class="ltx_caption" ${ID_ATTR}="c1">Table 1: <math>x</math></figcaption>
      <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="c1">表 1：<math>x</math></figcaption></figure>`)
    expect(splitFigures(doc)).toBe(0)
  })

  it('changed translation content rebuilds clones; counting translations alone would preserve stale language output', () => {
    const doc = docOf(figure())
    splitFigures(doc)
    doc.querySelector(`figure[${SPLIT_ATTR}] .ltx_caption.${T_CLASS}`)!.textContent = '图 1. 另一种译法'
    expect(splitFigures(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)!.textContent).toContain('另一种译法')
  })

  it('nested subfigures are cloned with the outermost figure rather than split individually', () => {
    const doc = docOf(`<figure class="ltx_figure"><div class="ltx_flex_figure"><div class="ltx_flex_cell">
      <figure class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" src="a.png">
        <figcaption class="ltx_caption">(a) panel</figcaption>
        <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="p1">(a) 面板</figcaption>
      </figure></div></div></figure>`)
    expect(splitFigures(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
  })

  it('unchanged translations do not rebuild clones', () => {
    const doc = docOf(figure())
    expect(splitFigures(doc)).toBe(1)
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
  })

  it('additional translations rebuild clones so the right column does not remain incomplete', () => {
    const doc = docOf(figure())
    splitFigures(doc)
    const fig = doc.querySelector(`figure[${SPLIT_ATTR}]`)!
    const p = doc.createElement('p')
    p.className = 'ltx_p'
    p.textContent = 'note'
    fig.append(p)
    const t = doc.createElement('p')
    t.className = `ltx_p ${T_CLASS}`
    t.setAttribute('data-axt-for', 'c2')
    t.textContent = '注'
    p.after(t)
    expect(splitFigures(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)!.textContent).toContain('注')
  })

  it('removes existing mirrors inside figures to avoid duplication between both mechanisms', () => {
    const doc = docOf(figure(`<img class="ltx_graphics ${T_CLASS} ${MIRROR_CLASS}" src="a.png">`))
    splitFigures(doc)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('restoration recovers the node-for-node original DOM (§7.1)', () => {
    const doc = docOf(figure())
    const before = doc.querySelector('article')!.innerHTML
    splitFigures(doc)
    // restore removes both clones and markers.
    for (const t of Array.from(doc.querySelectorAll(`.${T_CLASS}`))) t.remove()
    restore(doc)
    expect(doc.querySelector(`[${SPLIT_ATTR}]`)).toBeNull()
    expect(doc.querySelector('article')!.innerHTML.replace(/\s+/g, ' ').trim())
      .toBe(before.replace(new RegExp(`<figcaption class="ltx_caption ${T_CLASS}"[^>]*>[^<]*</figcaption>`), '').replace(/\s+/g, ' ').trim())
  })

  it('pending nodes are not translations: alone they do not split; mixed clones drop spinners but keep originals, rebuilding when translations change the key (§7.6)', () => {
    const pendingOnly = docOf(`<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">
      <figcaption class="ltx_caption">cap</figcaption><figcaption class="ltx_caption ${T_CLASS} axt-pending" data-axt-for="c1"><span class="axt-spinner"></span></figcaption></figure>`)
    expect(splitFigures(pendingOnly)).toBe(0)

    const mixed = docOf(`<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">
      <figcaption class="ltx_caption">cap A</figcaption><figcaption class="ltx_caption ${T_CLASS}" data-axt-for="c1">说明 A</figcaption>
      <figcaption class="ltx_caption">cap B</figcaption><figcaption class="ltx_caption ${T_CLASS} axt-pending" data-axt-for="c2"><span class="axt-spinner"></span></figcaption></figure>`)
    expect(splitFigures(mixed)).toBe(1)
    const clone = mixed.querySelector(`.${SPLIT_CLASS}`)!
    expect(clone.querySelector('.axt-pending, .axt-spinner')).toBeNull()
    expect(clone.textContent).toContain('说明 A')
    expect(clone.textContent).toContain('cap B')
    // B arrives, changing the signature and rebuilding the clone.
    const pending = mixed.querySelector('.axt-pending')!
    const done = mixed.createElement('figcaption')
    done.className = `ltx_caption ${T_CLASS}`
    done.setAttribute('data-axt-for', 'c2')
    done.textContent = '说明 B'
    pending.replaceWith(done)
    expect(splitFigures(mixed)).toBe(1)
    expect(mixed.querySelector(`.${SPLIT_CLASS}`)!.textContent).toContain('说明 B')
  })
})

describe('mirrors are not translations (issue #46, measured on 2312.17141)', () => {
  it('a figure whose only axt-t node is a mirror is not split while its caption is still pending', () => {
    // The full-pass baseline mistook a new mirror for a translation on the next pass, removed it, and cloned an untranslated figure.
    const doc = docOf('<figure class="ltx_figure" id="f"><img class="ltx_graphics" src="a.png" alt="">'
      + '<img class="ltx_graphics axt-t axt-mirror" data-axt-for="mirror:0" src="a.png" alt="">'
      + '<figcaption class="ltx_caption" data-axt-id="c" data-axt-state="pending">Figure.</figcaption></figure>')
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelector('.axt-split')).toBeNull()
    expect(doc.querySelectorAll('.axt-mirror')).toHaveLength(1) // Keep the mirror.
  })

  describe('image overlays (DESIGN §15.2)', () => {
    const IMG_FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png" id="F1.g1"><figcaption class="ltx_caption">Figure 1.</figcaption></figure>'
    const overlayOn = (doc: Document, text = '静态电荷') => {
      const el = doc.querySelector('img') as HTMLImageElement
      return renderImage({ id: el.id, el }, [{ x: 0.1, y: 0.1, w: 0.3, h: 0.05, lines: 1, source: 'Static charge', text }])
    }

    it('overlay-only figures also split; clones retain image and overlay while stripping overlay data-axt-* attributes', () => {
      const doc = docOf(IMG_FIGURE)
      overlayOn(doc)
      expect(splitFigures(doc)).toBe(1)
      const clone = doc.querySelector(`.${SPLIT_CLASS}`)!
      const img = clone.querySelector('img')!
      expect(img).not.toBeNull()
      // The overlay immediately follows the cloned image, as required by anchor positioning.
      expect(img.nextElementSibling?.classList.contains(IMG_CLASS)).toBe(true)
      expect(clone.querySelector(`.${IMG_CLASS}`)!.getAttributeNames().some(n => n.startsWith('data-axt-'))).toBe(false)
      expect(clone.querySelector(`.${IMG_CLASS}`)!.textContent).toBe('静态电荷')
    })

    it('late overlays change the signature and rebuild the clone with the overlay', () => {
      const doc = docOf(figure())
      splitFigures(doc)
      const before = doc.querySelector(`.${SPLIT_CLASS}`)!
      expect(before.querySelector(`.${IMG_CLASS}`)).toBeNull()
      overlayOn(doc)
      expect(splitFigures(doc)).toBe(1)
      const after = doc.querySelector(`.${SPLIT_CLASS}`)!
      expect(after).not.toBe(before)
      expect(after.querySelector(`.${IMG_CLASS}`)).not.toBeNull()
      // An unchanged signature does not rebuild.
      expect(splitFigures(doc)).toBe(0)
    })

    it('captionless figures mirrored at session startup lose their figure-level mirror when split, avoiding three right-side copies', () => {
      const doc = docOf(IMG_FIGURE)
      const fig = doc.querySelector('figure')!
      const mirror = fig.cloneNode(true) as Element
      mirror.classList.add(T_CLASS, MIRROR_CLASS)
      fig.after(mirror)
      overlayOn(doc)
      expect(splitFigures(doc)).toBe(1)
      expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
      expect(doc.querySelectorAll('figure')).toHaveLength(2) // Original plus clone
    })

    it('dropStaleSplits removes stale clones and original markers outside side mode, leaving matching signatures untouched', () => {
      const doc = docOf(figure())
      splitFigures(doc)
      expect(dropStaleSplits(doc)).toBe(0)
      overlayOn(doc) // The overlay arrives in the original after side → only.
      expect(dropStaleSplits(doc)).toBe(1)
      expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
      expect(doc.querySelector(`[${SPLIT_ATTR}]`)).toBeNull()
      // Switch back to side and split again; the clone includes the overlay.
      expect(splitFigures(doc)).toBe(1)
      expect(doc.querySelector(`.${SPLIT_CLASS} .${IMG_CLASS}`)).not.toBeNull()
    })
  })
})
