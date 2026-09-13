// Footnotes going back to their column (DESIGN §7.2). A translated paragraph is rehydrated by the placeholder protocol, and the footnote is a protected node,
// so the translation rebuilds a copy of the **source** footnote; here the footnote's translation is copied into it, and the page edge carries one margin note.
import { describe, expect, it } from 'vitest'
import { T_CLASS } from '@/core/marks'
import { delocalizeNotes, localizeNotes } from '@/core/renderer/notes'
import { docOf } from './helpers'

/**
 * A body paragraph with a footnote: the source paragraph (with the footnote and the footnote's translation) + the paragraph's translation (with the rehydrated footnote copy).
 * The footnote body carries data-axt-id: it is a block the extractor registered (`.ltx_note_content` is a translation unit),
 * and its translation will arrive sooner or later — a footnote without that mark is another matter, see the “unregistered footnote” cases
 */
const withNote = (translated = true, zh = '中文脚注') => docOf(`
  <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content" data-axt-id="n1"><sup class="ltx_note_mark">1</sup>English note</span
    >${translated ? `<span class="ltx_note_content ${T_CLASS}" data-axt-for="n1"><sup class="ltx_note_mark">1</sup>${zh}</span>` : ''}
    </span></span></p>
  <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    ></span></span></p>`)

const copy = (doc: Document) => doc.querySelector(`.${T_CLASS} .ltx_note_content`)!
const sourceNote = (doc: Document) => doc.querySelector(`.ltx_p:not(.${T_CLASS}) .ltx_note`)!

describe('localizeNotes', () => {
  it('the translation is copied into the copy: one margin note with the source above and the translation below', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    const box = copy(doc).closest('.ltx_note_outer')!
    expect(box.textContent).toContain('English note')
    expect(box.textContent).toContain('中文脚注')
    expect(box.textContent!.indexOf('English')).toBeLessThan(box.textContent!.indexOf('中文'))
  })

  it('the translation put in sheds the footnote frame and carries neither the number nor the block mark', () => {
    // .ltx_note_content has a double top rule and an indent, and its own number is absolutely positioned (measured: it flies into the body text)
    const doc = withNote()
    localizeNotes(doc)
    const placed = doc.querySelector('.axt-note-t')!
    expect(placed.classList.contains('ltx_note_content')).toBe(false)
    expect(placed.querySelectorAll('.ltx_note_mark, .ltx_tag')).toHaveLength(0)
    expect(placed.getAttributeNames().some(n => n.startsWith('data-axt-'))).toBe(false)
  })

  it('gathers the copy\'s own original into .axt-note-s with the marks outside, so only mode can hide it (reported 2026-09-10)', () => {
    // The copy is a clone from a placeholder with no block mark, so the [data-axt-state="translated"]
    // rule never reaches it; bare text nodes cannot be hidden by CSS, hence the wrapper
    const doc = withNote()
    localizeNotes(doc)
    const c = copy(doc)
    const wrapper = c.querySelector(':scope > .axt-note-s')!
    expect(wrapper).not.toBeNull()
    expect(wrapper.textContent).toBe('English note')
    // The marks remain direct children of the copy; the translation follows the wrapper
    expect(c.querySelector(':scope > .ltx_note_mark')).not.toBeNull()
    expect(wrapper.querySelector('.ltx_note_mark')).toBeNull()
    expect(c.lastElementChild!.classList.contains('axt-note-t')).toBe(true)
    // Idempotent: a second run adds no second wrapper
    localizeNotes(doc)
    expect(c.querySelectorAll('.axt-note-s')).toHaveLength(1)
    // Inside the translation put in, the number is hidden rather than deleted (mirror sentence registration needs the two trees isomorphic), hence the second 1 in textContent
    expect(c.querySelector<HTMLElement>('.axt-note-t sup')?.hidden).toBe(true)
    expect(c.textContent).toBe('1English note1中文脚注')
  })

  it('keeps the marks in front: the wrapper starts after the last mark, tag and whitespace included', () => {
    // ar5iv: `<sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> text` (54 of 58 fixture notes)
    const doc = docOf(`
      <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
        ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> English note</span
        ><span class="ltx_note_content ${T_CLASS}" data-axt-for="n1"><sup class="ltx_note_mark">1</sup>中文脚注</span></span></span></p>
      <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
        ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> English note</span
        ></span></span></p>`)
    localizeNotes(doc)
    const c = copy(doc)
    const order = Array.from(c.childNodes).map(n => (n.nodeType === 1 ? ((n as Element).classList.contains('axt-note-t') ? 'axt-note-t' : (n as Element).className.split(' ')[0]) : '#')).join(' ')
    expect(order).toBe('ltx_note_mark # ltx_tag axt-note-s axt-note-t')
    expect(c.querySelector('.axt-note-s')!.textContent).toBe(' English note')
  })

  it('does not localise a skeleton or a failure widget: they are .axt-t siblings too', () => {
    for (const cls of ['axt-pending', 'axt-error']) {
      const doc = docOf(`
        <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
          ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
          ><span class="ltx_note_content ${T_CLASS} ${cls}" data-axt-for="n1">…</span></span></span></p>
        <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
          ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
          ></span></span></p>`)
      expect(localizeNotes(doc)).toBe(0)
      expect(copy(doc).querySelector('.axt-note-t, .axt-note-s')).toBeNull()
      expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
    }
  })

  it('does not wrap before the translation arrives: the stylesheet hides an original only beside a translation, so nothing is lost', () => {
    const doc = withNote(false)
    localizeNotes(doc)
    expect(copy(doc).querySelector('.axt-note-s')).toBeNull()
  })

  it('the original copy is marked data-axt-note and hidden whole by the style; the copy is not marked', () => {
    const doc = withNote()
    localizeNotes(doc)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    expect(doc.querySelector(`.${T_CLASS} .ltx_note`)!.hasAttribute('data-axt-note')).toBe(false)
  })

  it('copied, not moved: the translation in the original stays where it is, so on a retranslation renderText finds the old translation to replace', () => {
    // Moved, the old copy would be deleted with the paragraph translation and the footnote translation lost (Codex on #26)
    const doc = withNote()
    localizeNotes(doc)
    expect(doc.querySelectorAll(`.ltx_note_content.${T_CLASS}`)).toHaveLength(1)
    expect(sourceNote(doc).querySelector(`.${T_CLASS}`)!.textContent).toContain('中文脚注')
  })

  it('undo the placement before deleting the paragraph translation: the original is no longer hidden, and the footnote does not vanish in every mode (Codex on #30)', () => {
    const doc = withNote()
    localizeNotes(doc)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    const paragraph = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(delocalizeNotes(paragraph)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('undo the placement before deleting the footnote translation: the copy\'s translation inside the outer paragraph translation goes too, and the original shows', () => {
    const doc = withNote()
    localizeNotes(doc)
    doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!.setAttribute('data-axt-id', 'p1')
    const noteBlock = sourceNote(doc).querySelector(`.ltx_note_content:not(.${T_CLASS})`)!
    expect(delocalizeNotes(noteBlock)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
    expect(doc.querySelector('.axt-note-t')).toBeNull()
    // A block never placed: nothing happens
    expect(delocalizeNotes(noteBlock)).toBe(0)
  })

  it('retranslation: once the paragraph translation is replaced whole, the new copy is placed again', () => {
    const doc = withNote()
    localizeNotes(doc)
    // renderText replaces the paragraph translation: the old one (with the placed copy) is deleted, a new one inserted, its copy source text again
    const old = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const fresh = old.cloneNode(true) as Element
    fresh.querySelector('.axt-note-t')!.remove()
    old.replaceWith(fresh)
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('中文脚注')
  })

  it('when the translation\'s content changed (retranslated into another target) the new one replaces it rather than keeping the old copy for good', () => {
    const doc = withNote()
    localizeNotes(doc)
    sourceNote(doc).querySelector(`.${T_CLASS}`)!.append('（修订）')
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('修订')
  })

  it('skipping this pass loses no content either: the original still holds source + translation', () => {
    const doc = withNote()
    const source = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(source.textContent).toContain('English note')
    expect(source.textContent).toContain('中文脚注')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('a footnote not yet translated is left alone until the next round', () => {
    const doc = withNote(false)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).textContent).toContain('English note')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  /** A footnote the extractor did not register: the body is all URL, no letter to translate, so no translation will ever come (numbers 1–6 of 2509.10652v3) */
  const unregistered = (copyText = 'https://chat.openai.com') => docOf(`
    <p class="ltx_p" data-axt-id="p1">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
      ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> <a class="ltx_ref ltx_url">https://chat.openai.com</a></span
      ></span></span></p>
    <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
      ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup> <span class="ltx_tag ltx_tag_note">1</span> <a class="ltx_ref ltx_url">${copyText}</a></span
      ></span></span></p>`)

  it('an unregistered footnote (body all URL): the copy is identical byte for byte, the original is marked hidden, and the page edge keeps one', () => {
    // The translation will never come, and waiting draws the same margin note twice (the owner's report on 2509.10652v3, 2026-09-11)
    const doc = unregistered()
    expect(localizeNotes(doc)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    // The copy has no translation to hold and stays as it is (not wrapped in .axt-note-s: only only mode, hiding the source, needs that)
    expect(copy(doc).querySelector('.axt-note-t')).toBeNull()
    expect(copy(doc).textContent).toContain('https://chat.openai.com')
    expect(localizeNotes(doc)).toBe(0) // // idempotent
  })

  // Codex on #163: a block whose translation equals its source byte for byte has its whole .axt-t hidden in stack mode
  // (the data-axt-identity rule of modes.css). That copy is the only one of this footnote left,
  // and marking the original hidden too takes the whole footnote off the page
  it('when the translation equals the source whole (stack hides the copy) the original is left alone: one is better than none', () => {
    const doc = unregistered()
    doc.querySelector(`.${T_CLASS}`)!.setAttribute('data-axt-identity', '')
    expect(localizeNotes(doc)).toBe(0)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  // Fourth round: the guard grew only on the “unregistered footnote” branch. A registered footnote whose translation arrived vanishes the same way —
  // that margin box in the original holds exactly source + translation, and hiding it hides the translation with it
  it('a footnote whose translation arrived: when the copy will be hidden the original is not hidden either', () => {
    const doc = withNote()
    doc.querySelector(`.ltx_p.${T_CLASS}`)!.setAttribute('data-axt-identity', '')
    expect(localizeNotes(doc)).toBe(0)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
    // The translation is still put into the copy: it has to be there when a mode shows it
    expect(copy(doc).querySelector('.axt-note-t')?.textContent).toContain('中文脚注')
  })

  // Two more copies with the same hole (Codex on #163, third round): the split-figure copy is hidden whole in stack,
  // the mirror is hidden outside side (modes.css). A footnote inside either cannot count as “the only one left”
  it('split-figure copies and mirrors do not count either: some mode hides them whole too', () => {
    for (const cls of ['axt-split', 'axt-mirror']) {
      const doc = unregistered()
      doc.querySelector(`.${T_CLASS}`)!.classList.add(cls)
      expect([cls, localizeNotes(doc)]).toEqual([cls, 0])
      expect([cls, sourceNote(doc).hasAttribute('data-axt-note')]).toEqual([cls, false])
    }
  })

  it('a copy whose text the engine changed keeps both: better a duplicate than lost content', () => {
    const doc = unregistered('https://chat.openai.com/zh')
    expect(localizeNotes(doc)).toBe(0)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('idempotent: with the content unchanged the second pass does nothing', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
  })

  it('when the counts do not match the whole passage is skipped: better the source kept than a mismatch', () => {
    const doc = withNote()
    const t = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const extra = doc.createElement('span')
    extra.className = 'ltx_note_content'
    extra.textContent = 'stray'
    t.append(extra)
    expect(localizeNotes(doc)).toBe(0)
  })
})
