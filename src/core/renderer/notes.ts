// Footnotes and their two-column placement in side mode (DESIGN §7.2).
//
// A paragraph's translation is filled back through the placeholder protocol, and a footnote is a protected node,
// so **the translated paragraph rebuilds a copy of the original footnote**: the same footnote appears twice on the
// page, once with the original and once with the translation.
//
// This module **copies** the footnote's translation into that copy, which thus reads “original + translation”
// stacked; the original is marked data-axt-note and hidden by the style sheet (the translation inside it hides with
// the whole margin box). The result is one margin note at the page's edge, English above and Chinese below
// (measured on 2312.17141: document 522→2026, margin notes 2042→2522, one copy left in side and in stack alike).
//
// Copied, not moved: when renderText translates a second time it finds the old translation as “the original
// block's sibling” to replace it; moved away, it is not found, and the old copy is removed with the paragraph's
// translation — the footnote's translation is lost (Codex on #26). The copy is compared by content, and replaced
// when the translation changes (a retranslation into another target language).
//
// The margin note's position is arXiv's own (float + negative margin, hung outside the article) and is not
// changed: pulling it into the column squeezed the body and covered list items (ar5iv fixes footnotes inside list
// items at height: 0), and the owner reported it “hurts reading”.
//
// Hiding goes by the data-axt-note mark alone, and the mark is set only when the copy succeeded: the first version
// hid the original's translation with one unconditional CSS rule, and where the JS had not run the Chinese
// vanished. Now, where it has not run, the page only falls back to the old look of “original + translation side by
// side inside the original”, losing nothing.
//
// “The copy succeeded” comes in two kinds: the translation has arrived (copy = original + translation), or the
// footnote was never registered as a block by the extractor (all URLs, all formulas, nothing to translate) and the
// copy equals the original word for word. The second kind used to go unmarked, the original stayed in view, and
// the same margin note painted twice in the gutter (the six URL footnotes in the introduction of 2509.10652v3, the
// owner's feedback of 2026-09-11).
import { ID_ATTR } from '@/core/extractor'
import { AXT_ATTR_PREFIX, T_CLASS, isInjected } from '@/core/marks'
import { DOCUMENT_ROOT, NOTE } from '@/core/rules/latexml'
import { ERROR_CLASS, IDENTITY_ATTR, MIRROR_CLASS, PENDING_CLASS, SPLIT_CLASS } from './attrs'
import { mirrorPair } from './sentences'
import { squash } from '@/core/text'

/** On the original: its translation was copied into the copy, and the style sheet hides this margin note */
const LOCALIZED_ATTR = 'data-axt-note'
/** The class the translation copied into the copy takes: the ar5iv footnote-box shell comes off (below) */
export const NOTE_T_CLASS = 'axt-note-t'
/**
 * The wrapper around the copy's **own original text**. The copy is a clone rebuilt from the
 * placeholder and carries no block mark, so only mode's hiding rule (`[data-axt-state="translated"]`)
 * never reaches it and the margin note kept showing its English (reported on 2609.09360v1,
 * 2026-09-10). Bare text nodes cannot be hidden by CSS, so the original's nodes — everything but
 * the marks — go into this span and the stylesheet hides it per mode; only next to a translation
 * that actually arrived (`:has(> .axt-note-t)`), so a copy without one keeps showing its text.
 */
export const NOTE_S_CLASS = 'axt-note-s'

/** The translation placed inside the copy: the footnote-box shell off, the number it carries removed (the copy's outer layer has one already) */
function localizedCopy(translated: Element): Element {
  const clone = translated.cloneNode(true) as Element
  // The translation node is itself a .ltx_note_content; nested into the copy it becomes “a box inside a box” — one
  // more double top border, 9.6px more indent, and its own absolutely positioned number flies into the body text
  // (measured; the owner reported “the position is a mess”)
  clone.classList.remove(NOTE.contentClass)
  clone.classList.add(NOTE_T_CLASS)
  for (const name of clone.getAttributeNames()) if (name.startsWith(AXT_ATTR_PREFIX)) clone.removeAttribute(name)
  // The marks are hidden, not removed: in the translation's sentence registration a mark is a
  // placeholder, and mirroring onto the copy needs a twin for every node — with one missing, that
  // sentence's range would run from the hidden original all the way to the copy and enclose the
  // document between. Without the class there is no ar5iv absolute positioning; `hidden` takes it
  // out of layout; the subtree stays, so the two trees remain isomorphic
  for (const mark of Array.from(clone.querySelectorAll(NOTE.marks))) {
    mark.removeAttribute('class')
    ;(mark as HTMLElement).hidden = true
  }
  return clone
}

/** Gathers the copy's own original — everything after the marks, minus the translation — into `.axt-note-s`; idempotent. Returns the wrapper. */
function wrapSource(copy: Element): Element | null {
  const existing = copy.querySelector(`:scope > .${NOTE_S_CLASS}`)
  if (existing) return existing
  const doc = copy.ownerDocument
  const wrapper = doc.createElement('span')
  wrapper.className = NOTE_S_CLASS
  // The wrapper takes the contiguous run **after the last mark**, not "every node that is not a
  // mark": ar5iv's note content is `<sup>1</sup> <span.ltx_tag>1</span> text…` in 54 of the 58
  // fixture notes, and picking up the whitespace between the marks too would put the wrapper in
  // front of the tag — the note's number would render after the English (Codex on #153), and the
  // changed document order would keep the two trees from pairing up when the sentence
  // registration is mirrored (measured on 2609.09360v1)
  const children = Array.from(copy.childNodes)
  let start = 0
  children.forEach((n, i) => { if (n.nodeType === 1 && (n as Element).matches(NOTE.marks)) start = i + 1 })
  const loose = children.slice(start).filter(n => !(n.nodeType === 1 && (n as Element).classList.contains(NOTE_T_CLASS)))
  if (loose.length === 0 || !loose.some(n => /\S/.test(n.textContent ?? ''))) return null
  copy.insertBefore(wrapper, loose[0]!)
  for (const n of loose) wrapper.append(n)
  return wrapper
}

/** A tree flattened in document order: a `through` node is not counted but its children are walked, a `skip` node is left out with its subtree */
function flatten(root: Node, rule: (node: Node) => 'keep' | 'skip' | 'through'): Node[] {
  const out: Node[] = []
  const walk = (node: Node) => {
    const r = rule(node)
    if (r === 'skip') return
    if (r === 'keep') out.push(node)
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  for (const child of Array.from(root.childNodes)) walk(child)
  return out
}

/** Pairs two sequences node for node; gives up on a length or node-kind mismatch — better an unlit copy than offsets pointed at the wrong nodes */
function pairUp(a: Node[], b: Node[]): Map<Node, Node> | undefined {
  if (a.length !== b.length) return undefined
  const out = new Map<Node, Node>()
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!
    const y = b[i]!
    if (x.nodeType !== y.nodeType || (x.nodeType === 1 && (x as Element).tagName !== (y as Element).tagName)) return undefined
    out.set(x, y)
  }
  return out
}

/**
 * Mirrors the note's sentence registration onto the copy (§7.7 — the idea of issue #139, but here
 * both sides are clones): the source side onto the original text inside the copy, the target side
 * onto the translation just placed beside it.
 *
 * The copy differs from what it was cloned from by the wrapper (walked through) and by our own
 * nodes (left out). Flattened along those two differences the trees pair up node for node;
 * when they do not, nothing is mirrored.
 */
function mirrorNote(source: Element, translated: Element, wrapper: Element, fresh: Element): void {
  const original = flatten(source, node => (node.nodeType === 1 && isInjected(node as Element) ? 'skip' : 'keep'))
  const copied = flatten(wrapper.parentElement!, node => {
    if (node === wrapper) return 'through'
    if (node.nodeType === 1 && ((node as Element).classList.contains(NOTE_T_CLASS) || isInjected(node as Element))) return 'skip'
    return 'keep'
  })
  const sourceTwins = pairUp(original, copied)
  // The placed translation is isomorphic to the original one: its marks are hidden, not removed (localizedCopy)
  const targetTwins = pairUp(flatten(translated, () => 'keep'), flatten(fresh, () => 'keep'))
  if (!sourceTwins || !targetTwins) return
  // The source side's root is the wrapper: it is what only mode hides, which is how `checkVisibility`
  // tells the peek that the counterpart is not rendered (§7.7). The marks are outside it, so
  // pointing at one resolves to the paragraph's sentence — which it is on the line of anyway
  mirrorPair(translated, { source: wrapper, target: fresh }, { source: node => sourceTwins.get(node), target: node => targetTwins.get(node) })
}

/** A translation that has actually arrived: not the skeleton, not the failure widget, which are `.axt-t` siblings too */
const arrived = (el: Element | null): el is Element => !!el && el.classList.contains(T_CLASS) && !el.classList.contains(PENDING_CLASS) && !el.classList.contains(ERROR_CLASS)

/**
 * The copy reproduces the original word for word, so only one of the two needs to be on screen.
 * It is rebuilt from the placeholder, not translated, so this is the normal state for a note with
 * nothing to translate in it — a bare URL, a lone formula.
 */
const reproduces = (source: Element, copy: Element): boolean => {
  const text = squash(source.textContent)
  return text !== '' && text === squash(copy.textContent)
}

/** Copies hidden whole by some mode: the identity ones and the split ones in stack, the mirrors outside side (modes.css). The footnote copy inside cannot count as “the only one left” */
const HIDABLE_COPY = `.${T_CLASS}[${IDENTITY_ATTR}], .${MIRROR_CLASS}, .${SPLIT_CLASS}`

/**
 * Copy a footnote's translation into the copy rebuilt inside the translated block, and mark the original.
 * Idempotent: a copy holding the same content is left alone; changed content is replaced. Returns how many changed
 * this round.
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
    // A count that does not match is left alone: better the original in the right column than the wrong footnote
    if (sources.length !== copies.length) continue
    copies.forEach((copy, i) => {
      const source = sources[i]
      if (!source) return
      const note = source.closest(NOTE.root)
      // Only a translation that has arrived: the skeleton and the failure widget are `.axt-t` siblings
      // as well, and copying one of them would count as a translation — in only mode the English
      // would be hidden behind a skeleton, or gone for good after a failure (Codex on #153)
      const sibling = source.nextElementSibling
      // Whether a translation is coming at all. Computed before the narrowing below: `arrived` says
      // "this is a translation that has landed", and its false branch is a skeleton, a failure
      // widget, or nothing — not "not an element"
      const registered = source.hasAttribute(ID_ATTR) || !!sibling?.classList.contains(T_CLASS)
      // Whether some mode hides the clone this copy sits in — computed for **both** branches
      // (Codex on #163, third round: the guard sat inside the untranslated one). Marking the
      // original hidden is only safe while the copy is guaranteed to be on screen, and that is
      // just as true for a note whose translation has arrived: the original's outer box carries
      // that translation too, so hiding it takes both away
      const hidable = !!copy.closest(HIDABLE_COPY)
      if (!arrived(sibling)) {
        // A note the extractor never registered — its content is a bare URL, a lone formula, nothing
        // with letters in it — will never get a translation, and waiting for one left the original
        // showing beside a copy that says exactly the same thing: one note painted twice, the two
        // boxes 24px apart (the six URL footnotes of 2509.10652v3's opening sentence, reported
        // 2026-09-11). A registered one keeps waiting: hiding it early would take its skeleton with
        // it, and after a failure the widget the reader retries from (Codex on #153).
        // The mark goes on only while the copy reproduces the original word for word; against a copy
        // the engine mangled both stay on screen — a duplicate beats a note gone missing.
        // Nor against a copy some mode hides whole (`hidableCopy`): hiding the original too would
        // take the footnote off the page altogether (Codex on #163, in two rounds — first the
        // identity clone, then the split-figure one). Keeping the original leaves one note in the
        // mode that hides the clone and two in the mode that shows it — the same
        // duplicate-beats-missing trade, for the few clones whose content is its own source
        if (!registered && note && !hidable && !note.hasAttribute(LOCALIZED_ATTR) && reproduces(source, copy)) {
          note.setAttribute(LOCALIZED_ATTR, '')
          localized += 1
        }
        return
      }
      const translated = sibling
      const fresh = localizedCopy(translated)
      const existing = copy.querySelector(`:scope > .${NOTE_T_CLASS}`)
      if (existing?.textContent === fresh.textContent) return // placed already, content unchanged
      existing?.remove()
      // The copy keeps its own original with the translation appended: one margin note, English
      // above, Chinese below. The original goes into a wrapper first, which is what only mode can
      // hide (the marks stay outside: the note's number must show in every mode)
      const wrapper = wrapSource(copy)
      copy.append(fresh)
      // The copy is what is on screen: its sentence registration comes along, so pointing at the
      // note tints the note's own sentence
      if (wrapper) mirrorNote(source, translated, wrapper, fresh)
      // The copy is placed either way (the mode that shows it needs the translation), but **when the copy is hidden the
      // original is not**: the original's margin box already holds original + translation, and hiding it would take this
      // footnote off the page together with its translation
      if (hidable) return
      note?.setAttribute(LOCALIZED_ATTR, '')
      localized += 1
    })
  }
  return localized
}

/**
 * Undo the footnote placement that concerns a block, before its translation is removed (Codex on #30):
 * footnotes inside the block — their copies go with the block's translation, the originals must not stay hidden;
 * the block being a footnote body itself — its translation copy lives in the outer paragraph's translation; the copy
 * removed, the original shows. Otherwise, when a retranslation fails, the original margin note stays hidden by the
 * style sheet while the copy is gone, and the footnote disappears in every mode. Returns how many were undone
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
