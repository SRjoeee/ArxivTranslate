// Align footnotes across side-mode columns (DESIGN §7.2).
//
// Rehydration reconstructs protected footnotes inside translated paragraphs as source-language clones.
// Each footnote therefore appears twice: beside the source and beside its translation.
//
// Copy the footnote translation into the reconstructed clone, stacking source above translation.
// Mark the original with data-axt-note so CSS hides it, including its nested translation.
// This leaves one margin note at the right edge, with English above Chinese
// (2312.17141: document 522→2026, margin note 2042→2522; one note in both side and stack).
//
// Copy, do not move: renderText finds previous translations by original-block siblings on retranslation.
// Moving would prevent replacement; deleting the paragraph translation then deletes the only footnote copy (Codex #26).
// Compare content and replace the copy when translations change, e.g. a new target language.
//
// Retain arXiv positioning (float and negative margin outside the article). Moving notes inside the column
// squeezed body text and covered list items (ar5iv fixes their footnotes at height: 0); users reported impaired reading.
//
// Hide only by data-axt-note, set after a successful copy. Unconditional CSS in the first version hid translations before JS ran.
// Now unprocessed notes retain the old source / translation layout in the original, losing no content.
import { ID_ATTR } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { DOCUMENT_ROOT, NOTE } from '@/core/rules/latexml'

/** Original marker: translation copied into the clone; hide this margin note with CSS. */
const LOCALIZED_ATTR = 'data-axt-note'
/** Class for the copied translation, removing ar5iv's footnote-box shell (below). */
export const NOTE_T_CLASS = 'axt-note-t'

/** Translation placed in the clone: remove box shell and own number, already supplied by the outer clone. */
function localizedCopy(translated: Element): Element {
  const clone = translated.cloneNode(true) as Element
  // The translation is also .ltx_note_content. Nesting it creates a box inside a box, adding a double top border,
  // 9.6 px indent, and an absolutely positioned number drifting into body text (observed; user reported misplaced notes).
  clone.classList.remove(NOTE.contentClass)
  clone.classList.add(NOTE_T_CLASS)
  for (const name of clone.getAttributeNames()) if (name.startsWith('data-axt-')) clone.removeAttribute(name)
  for (const mark of Array.from(clone.querySelectorAll(NOTE.marks))) mark.remove()
  return clone
}

/**
 * Copy footnote translations into clones reconstructed in translated blocks, then mark originals.
 * Idempotent: leave identical content alone; replace changed content. Return the count changed this pass.
 */
export function localizeNotes(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let localized = 0
  for (const translation of Array.from(scope.querySelectorAll(`.${T_CLASS}`))) {
    const original = translation.previousElementSibling
    if (!original || original.classList.contains(T_CLASS)) continue
    const copies = Array.from(translation.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
    if (copies.length === 0) continue
    const sources = Array.from(original.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
    // Leave mismatched counts alone: source text in the right column is better than the wrong footnote.
    if (sources.length !== copies.length) continue
    copies.forEach((copy, i) => {
      const source = sources[i]
      const translated = source?.nextElementSibling
      if (!translated?.classList.contains(T_CLASS)) return // Not translated yet; try next pass.
      const fresh = localizedCopy(translated)
      const existing = copy.querySelector(`:scope > .${NOTE_T_CLASS}`)
      if (existing?.textContent === fresh.textContent) return // Already aligned, with unchanged content.
      existing?.remove()
      // Retain the clone's source text and append its translation, English above Chinese in one margin note.
      copy.append(fresh)
      source?.closest(NOTE.root)?.setAttribute(LOCALIZED_ATTR, '')
      localized += 1
    })
  }
  return localized
}

/**
 * Undo footnote alignment for a block before removing its translation (Codex #30).
 * Footnotes within a block: the clone disappears with that block's translation, so reveal the original.
 * A block that is itself footnote content: remove its translation copy in the outer paragraph and reveal the original.
 * Otherwise failed retranslation would hide the original after deleting its copy, losing the note in every mode. Return the count undone.
 */
export function delocalizeNotes(block: Element): number {
  let undone = 0
  for (const note of Array.from(block.querySelectorAll(`[${LOCALIZED_ATTR}]`))) {
    note.removeAttribute(LOCALIZED_ATTR)
    undone += 1
  }
  const note = block.closest(NOTE.root)
  if (!note?.hasAttribute(LOCALIZED_ATTR)) return undone
  note.removeAttribute(LOCALIZED_ATTR)
  undone += 1
  const outer = note.parentElement?.closest(`[${ID_ATTR}]`)
  const translation = outer?.nextElementSibling
  if (!outer || !translation?.classList.contains(T_CLASS)) return undone
  const sources = Array.from(outer.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
  const copies = Array.from(translation.querySelectorAll(`${NOTE.content}:not(.${T_CLASS})`))
  copies[sources.indexOf(block)]?.querySelector(`:scope > .${NOTE_T_CLASS}`)?.remove()
  return undone
}
