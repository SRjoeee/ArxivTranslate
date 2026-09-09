// Two-column footnotes (DESIGN §7.2). Placeholder rehydration reconstructs protected original footnotes inside translated paragraphs.
// Copy each footnote translation into that duplicate so only one marginal note appears at the right edge.
import { describe, expect, it } from 'vitest'
import { T_CLASS, delocalizeNotes, localizeNotes } from '@/core/renderer'
import { docOf } from './helpers'

/** Paragraph with a footnote: original contains note and note translation; paragraph translation contains a rehydrated note clone */
const withNote = (translated = true, zh = '中文脚注') => docOf(`
  <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    >${translated ? `<span class="ltx_note_content ${T_CLASS}" data-axt-for="n1"><sup class="ltx_note_mark">1</sup>${zh}</span>` : ''}
    </span></span></p>
  <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    ></span></span></p>`)

const copy = (doc: Document) => doc.querySelector(`.${T_CLASS} .ltx_note_content`)!
const sourceNote = (doc: Document) => doc.querySelector(`.ltx_p:not(.${T_CLASS}) .ltx_note`)!

describe('localizeNotes', () => {
  it('copies translation into the note clone, with original above translation in one marginal note', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    const box = copy(doc).closest('.ltx_note_outer')!
    expect(box.textContent).toContain('English note')
    expect(box.textContent).toContain('中文脚注')
    expect(box.textContent!.indexOf('English')).toBeLessThan(box.textContent!.indexOf('中文'))
  })

  it('inserted translations shed the footnote wrapper, label, and block markers', () => {
    // ltx_note_content has a double top border and indentation; its absolutely positioned label can drift into body text.
    const doc = withNote()
    localizeNotes(doc)
    const placed = doc.querySelector('.axt-note-t')!
    expect(placed.classList.contains('ltx_note_content')).toBe(false)
    expect(placed.querySelectorAll('.ltx_note_mark, .ltx_tag')).toHaveLength(0)
    expect(placed.getAttributeNames().some(n => n.startsWith('data-axt-'))).toBe(false)
  })

  it('marks the original with data-axt-note so CSS hides its entire box; leaves the clone unmarked', () => {
    const doc = withNote()
    localizeNotes(doc)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    expect(doc.querySelector(`.${T_CLASS} .ltx_note`)!.hasAttribute('data-axt-note')).toBe(false)
  })

  it('copies rather than moves translations so renderText can find and replace the old translation on retry', () => {
    // Moving it would lose the footnote translation when the old paragraph copy is removed (Codex #26).
    const doc = withNote()
    localizeNotes(doc)
    expect(doc.querySelectorAll(`.ltx_note_content.${T_CLASS}`)).toHaveLength(1)
    expect(sourceNote(doc).querySelector(`.${T_CLASS}`)!.textContent).toContain('中文脚注')
  })

  it('undoes placement before deleting a paragraph translation so the original note reappears instead of vanishing in every mode (Codex #30)', () => {
    const doc = withNote()
    localizeNotes(doc)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    const paragraph = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(delocalizeNotes(paragraph)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('undoes placement before deleting a footnote translation, removing the translated copy from the paragraph clone and revealing the original', () => {
    const doc = withNote()
    localizeNotes(doc)
    doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!.setAttribute('data-axt-id', 'p1')
    const noteBlock = sourceNote(doc).querySelector(`.ltx_note_content:not(.${T_CLASS})`)!
    expect(delocalizeNotes(noteBlock)).toBe(1)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
    expect(doc.querySelector('.axt-note-t')).toBeNull()
    // does nothing for blocks never placed
    expect(delocalizeNotes(noteBlock)).toBe(0)
  })

  it('after replacing a paragraph translation, places the new note clone again', () => {
    const doc = withNote()
    localizeNotes(doc)
    // renderText replaces the paragraph translation and its placed clone with a fresh translation containing the original note.
    const old = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const fresh = old.cloneNode(true) as Element
    fresh.querySelector('.axt-note-t')!.remove()
    old.replaceWith(fresh)
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('中文脚注')
  })

  it('changed translation content, such as a target-language change, replaces stale copies', () => {
    const doc = withNote()
    localizeNotes(doc)
    sourceNote(doc).querySelector(`.${T_CLASS}`)!.append('（修订）')
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('修订')
  })

  it('Content survives even before this pass: the original still contains both source and translation.', () => {
    const doc = withNote()
    const source = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(source.textContent).toContain('English note')
    expect(source.textContent).toContain('中文脚注')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('leaves untranslated footnotes alone until the next pass', () => {
    const doc = withNote(false)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).textContent).toContain('English note')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('unchanged content makes the second pass a no-op', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
  })

  it('skips the entire paragraph on count mismatch rather than assigning translations to the wrong notes', () => {
    const doc = withNote()
    const t = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const extra = doc.createElement('span')
    extra.className = 'ltx_note_content'
    extra.textContent = 'stray'
    t.append(extra)
    expect(localizeNotes(doc)).toBe(0)
  })
})
