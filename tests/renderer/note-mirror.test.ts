// The footnote copy in the margin highlights on its own (DESIGN §7.7): its registration is
// mirrored from the original pair when localizeNotes puts the translation beside it.
// On the window's own document: a `DOMParser` document breaks Range offsets in happy-dom.
import { describe, expect, it } from 'vitest'
import { rangesOf, rehydrate, serialize } from '@/core/protector'
import { localizeNotes } from '@/core/renderer/notes'
import { registerSentences, sentenceMapAt } from '@/core/renderer/sentences'
import { splitSentences } from '@/core/sentences'

/**
 * A paragraph whose footnote has been translated in place, and the paragraph's own translation
 * carrying the copy of the note that rehydrate rebuilt from the placeholder — the state the page
 * is in when localizeNotes runs. The note pair is registered the way the pipeline does it.
 */
function page() {
  document.body.innerHTML = `<article class="ltx_document">
    <p class="ltx_p" data-axt-id="p1">Body text.<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content" data-axt-id="n1"><sup class="ltx_note_mark">1</sup>First note. Second note.</span></span></span></p>
    <p class="ltx_p axt-t" data-axt-for="p1">正文。<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>First note. Second note.</span></span></span></p>
  </article>`
  const source = document.querySelector('[data-axt-id="n1"]')!
  const block = serialize(source, 'tags')
  const fragment = rehydrate(block.text, block, document)
  const target = document.createElement('span')
  target.className = 'ltx_note_content axt-t'
  target.setAttribute('data-axt-for', 'n1')
  target.append(fragment)
  source.after(target)
  const lengths = splitSentences(block.text, 'tags')
  registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
  return { source, target, sentences: lengths.length }
}

describe('footnote copy highlight (#139 for notes)', () => {
  it('the copy is registered as a pair of its own: English in the wrapper, Chinese beside it', () => {
    const { target, sentences } = page()
    expect(localizeNotes(document)).toBe(1)
    const copy = document.querySelector('.axt-t .ltx_note_content')!
    const wrapper = copy.querySelector(':scope > .axt-note-s')!
    const placed = copy.querySelector(':scope > .axt-note-t')!
    const englishText = (() => { const w = document.createTreeWalker(wrapper, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (/First/.test((n as Text).data)) return n; return null })()!
    // A pointer on the copy's English resolves to the copy's own pair, on the source side
    const onEnglish = sentenceMapAt(englishText)!
    expect(onEnglish.side).toBe('source')
    expect(onEnglish.map.source.root).toBe(wrapper) // the wrapper is what only mode hides, so the peek can tell
    expect(onEnglish.map.target.root).toBe(placed)
    expect(onEnglish.map.pairs).toHaveLength(sentences)
    // … and on the placed translation, the target side of the same pair
    const onChinese = sentenceMapAt(placed.firstChild!)!
    expect(onChinese.side).toBe('target')
    expect(onChinese.map.target.root).toBe(placed)
    // The ranges of the first sentence are inside the copy, not the original
    const first = onEnglish.map.pairs[0]!
    const sourceRanges = rangesOf(onEnglish.map.source.spans, first.source.from, first.source.to)
    expect(sourceRanges.map(String).join('')).toBe('1First note. ') // the mark is a placeholder at the block's start, part of the first sentence
    expect(sourceRanges.every(r => copy.contains(r.startContainer))).toBe(true)
    const targetRanges = rangesOf(onEnglish.map.target.spans, first.target.from, first.target.to)
    expect(targetRanges.every(r => placed.contains(r.startContainer))).toBe(true)
    // The original pair still answers for itself
    expect(sentenceMapAt(target.firstChild!)?.map.target.root).toBe(target)
  })

  it('a copy that does not match the original node for node is left unregistered', () => {
    const { target } = page()
    // Something else got into the copy before localizeNotes ran
    document.querySelector('.axt-t .ltx_note_content')!.append(document.createElement('b'))
    expect(localizeNotes(document)).toBe(1)
    const placed = document.querySelector('.axt-note-t')!
    // The pointer on the copy's translation walks up to the paragraph's translation, as before
    expect(sentenceMapAt(placed.firstChild!)?.map.target.root).not.toBe(placed)
    expect(sentenceMapAt(target.firstChild!)?.map.target.root).toBe(target)
  })
})
