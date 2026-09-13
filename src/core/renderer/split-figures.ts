// A figure split in two in side mode (DESIGN §7.2): the original caption in the left column, the translated caption
// in the right.
//
// The images and formulas inside a figure have no translation, so pairing by block leaves the right column empty,
// and letting the whole figure span both columns gives up the alignment. So the block is cloned whole: the clone
// drops each pair's original member and keeps the translations, and the original hides the translations inside it
// in side mode. The two share one structure, so the rows align of their own accord. A table float does not take this
// path — its table has a translation clone already.
//
// **No scaling** (the owner's decision, 2026-09-05): a narrow column lets ar5iv reflow — `.ltx_flex_figure` is
// `flex-flow: wrap` itself, and the panels go vertical on their own (measured on 2312.17141: 342px tall at full width,
// 546px at half, no overflow). What cannot reflow (a wide formula, a wide SVG; 3 of 8 figures measured overflowed by
// 78 / 102 / 209px) falls back to horizontal scrolling within the column, with the font size never touched. Feeding
// the column width to ar5iv's `--main-width` (it sizes panels at .33 / .5 of it) measured worse: panels shrank to
// 160px and still overflowed by 555px, so that variable is left alone.
import { DOCUMENT_ROOT, FIGURE_MEDIA, SPLIT_ROOTS, isTableRoot, tableCells } from '@/core/rules/latexml'
import { ID_ATTR } from '@/core/extractor'
import { AXT_ATTR_PREFIX, IMG_CLASS, T_CLASS } from '@/core/marks'
import { hashText } from '@/shared/hash'
import { ERROR_CLASS, FOR_ATTR, MIRROR_CLASS, PENDING_CLASS, REAL_TRANSLATION, SPLIT_ATTR, SPLIT_CLASS, SPLIT_FOR_ATTR, SPLIT_OF_ATTR } from './attrs'
import { mirrorSentences, sentenceSignatureOf } from './sentences'


// The line of a real translation is REAL_TRANSLATION of attrs.ts — rings, failure widgets, **mirrors and split
// clones** carry .axt-t for pairing only and are no translations. With .axt-mirror left out (issue #46 measured on
// 2312.17141): a figure whose caption was still pending got its media mirrored, the next full pass took the mirror
// for “a translation”, removed it and cloned a figure with no translation at all — the right column held a copy of
// the original. On the baseline's full pass every time, 2 of 7 split figures were such false splits
/** An image overlay (§15.2) is a real translation too: a figure whose only translation it is splits as well, and its arrival changes the signature and rebuilds the copy */
const REAL_OR_IMAGE = `${REAL_TRANSLATION}, .${IMG_CLASS}`
/** The signature of the translated content at clone time, to tell whether translations were added or changed and the copy needs rebuilding */
const KEY_ATTR = 'data-axt-split-key'

/**
 * A translation node's sentence-registration signature as it stands.
 *
 * A table is the only translation that keeps its registration on **descendants**: `renderTable` reports
 * “original cell → clone cell” per cell, the `.axt-t` table itself is never registered, and asking it alone always
 * gives an empty signature — the transition “table never aligned → aligned, text unchanged” goes unseen, the copy
 * stays as it is and not one cell is mirrored (Codex on #148; measured on 2312.11805v4, whose Figures 10 / 20 are
 * splittable figures with tables inside). The root test is one `matches`; a non-table translation walks no subtree
 */
function signatureOf(t: Element): string {
  const own = sentenceSignatureOf(t)
  return isTableRoot(t) ? `${own}/${tableCells(t).map(sentenceSignatureOf).join(',')}` : own
}

/** The translation's signature: the same count with changed content (a retranslation into another target language) rebuilds too; counting alone would keep a stale copy for good (Codex on #26) */
function translationKey(fig: Element): string {
  // Beyond the text, the **sentence registration**: with the text unchanged but the registration going from “none”
  // to “some”, a copy left as it is would never be mirrored, and hovering it would find nothing (Codex on #148)
  const texts = Array.from(fig.querySelectorAll(REAL_OR_IMAGE), t => `${t.textContent ?? ''}\u0000${signatureOf(t)}`)
  return `${texts.length}:${hashText(JSON.stringify(texts))}`
}

/**
 * Is there “loose” media: outside every translation block and outside every translation.
 * An inline formula in caption text is `math` too, so “is there media” alone mistakes a table float for a figure
 * (measured: both table floats of 2312.17527 were split; Codex on #26)
 */
function hasLooseMedia(fig: Element): boolean {
  return Array.from(fig.querySelectorAll(FIGURE_MEDIA)).some(m => m.closest(`[${ID_ATTR}], .${T_CLASS}`) === null)
}

/**
 * The node correspondence between two trees just cloned and still identical.
 *
 * Called after `cloneNode(true)` and before any removal: at that moment the two sides correspond one to one in
 * document order, and the pairing is counted rather than guessed. Text nodes are needed too (the translation side's
 * spans mostly land on text nodes), hence NodeIterator rather than `querySelectorAll`
 */
function pairNodes(from: Element, to: Element): Map<Node, Node> {
  const doc = from.ownerDocument
  const a = doc.createNodeIterator(from)
  const b = doc.createNodeIterator(to)
  const out = new Map<Node, Node>()
  for (;;) {
    const x = a.nextNode()
    const y = b.nextNode()
    if (!x || !y) break
    out.set(x, y)
  }
  return out
}

/**
 * The outermost split root an element sits in (nested sub-figures and equation groups inside a figure are copied
 * with the outermost); null when not inside one. A root is not only `figure`: an equation group with a description
 * row is split in two whole as well (`SPLIT_ROOTS`, issue #152)
 */
export function outermostFigure(el: Element): Element | null {
  let fig = el.closest(SPLIT_ROOTS)
  while (fig?.parentElement) {
    const outer = fig.parentElement.closest(SPLIT_ROOTS)
    if (!outer) break
    fig = outer
  }
  return fig
}

function needsSplit(fig: Element): boolean {
  if (fig.classList.contains(T_CLASS)) return false // the clone itself
  if (fig.parentElement?.closest(SPLIT_ROOTS)) return false // a nested sub-figure, or an equation group inside a figure, is copied with its outermost root
  if (!fig.querySelector(REAL_OR_IMAGE)) return false // no translation inside (pending does not count): nothing paired in the whole block, left to the mirrors
  return hasLooseMedia(fig) // a float without loose media (a table) need not be copied whole: its table has a translation clone already
}

/**
 * The clone must carry neither the original's ids nor its block marks (duplicate ids). But **the correspondence
 * must not go with them**: in only mode the original is hidden whole, and an anchor into a row inside the figure
 * (21 measured on 2312.17141, `#S3.Ex73`–`#S3.Ex79` all equation rows of Figure 6) can only land on the clone;
 * without the correspondence it could only scroll to the figure's top, with the row wanted possibly still off
 * screen (Codex on #80). So the original id moves into `data-axt-split-of` — not an id, never duplicated, gone with
 * the clone when that is removed
 */
function stripIds(root: Element): void {
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const id = el.getAttribute('id')
    const forId = el.classList.contains(IMG_CLASS) ? el.getAttribute(FOR_ATTR) : null
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith(AXT_ATTR_PREFIX)) el.removeAttribute(name)
    if (id) el.setAttribute(SPLIT_OF_ATTR, id)
    if (forId) el.setAttribute(SPLIT_FOR_ATTR, forId)
  }
}

/**
 * Make a translation-only copy of each figure holding pairs inside; idempotent, rebuilt when translations are
 * added or changed. Returns how many copies were made.
 */
export function splitFigures(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let made = 0
  for (const fig of Array.from(scope.querySelectorAll(SPLIT_ROOTS))) {
    if (!needsSplit(fig)) continue
    const key = translationKey(fig)
    const sibling = fig.nextElementSibling
    const existing = sibling?.classList.contains(SPLIT_CLASS) ? sibling : null
    if (existing && existing.getAttribute(KEY_ATTR) === key) continue
    existing?.remove()

    // Mirrors and whole-block copies are two schemes; a mirror left inside the figure duplicates a copy (all our own
    // nodes, removable). A figure without a caption is mirrored whole when the session starts (the figure's next
    // sibling) and removed along with the split once the overlay arrives, or the right column holds three
    for (const stale of Array.from(fig.querySelectorAll(`.${MIRROR_CLASS}`))) stale.remove()
    const figureMirror = fig.nextElementSibling
    if (figureMirror?.classList.contains(MIRROR_CLASS)) figureMirror.remove()

    const clone = fig.cloneNode(true) as Element
    // **While the two trees are still identical**, record each node's counterpart. The steps below remove each pair's
    // original member from the clone, after which the trees are no longer isomorphic and pairing could only be
    // guessed. The hover highlight relies on this table to move the translation side's spans onto the copy actually
    // shown on screen (issue #139)
    const twins = pairNodes(fig, clone)
    // Pairs still waiting for a translation / failed: the copy drops the ring and the widget and keeps the original; the key changes when the translation arrives and the copy is rebuilt
    for (const pending of Array.from(clone.querySelectorAll(`.${PENDING_CLASS}, .${ERROR_CLASS}`))) pending.remove()
    // The clone keeps the translations only: each pair's original member is taken out (a translation never is)
    for (const original of Array.from(clone.querySelectorAll('*'))) {
      if (original.classList.contains(T_CLASS)) continue
      if (original.nextElementSibling?.classList.contains(T_CLASS)) original.remove()
    }
    stripIds(clone)
    clone.classList.add(T_CLASS, SPLIT_CLASS)
    clone.setAttribute(FOR_ATTR, `split:${made}`)
    clone.setAttribute(KEY_ATTR, key)

    fig.setAttribute(SPLIT_ATTR, '')
    fig.after(clone)
    // The caption's translation in the right column is this clone; the original's is hidden by side mode. Unregistered,
    // the rectangles computed on the translation side at hover time are empty and not one band is drawn (issue #139,
    // the owner's feedback of 2026-09-10). **Every element is tried, not `.axt-t` alone.** A table's sentences are
    // registered per **cell** (`renderTable` reports “original cell → clone cell”), and those cells sit inside the
    // `.axt-t` table; scanning `.axt-t` only would miss them (Codex on #148). An element never registered returns
    // straight out of `mirrorSentences`, at the cost of one WeakMap lookup
    for (const original of [fig, ...Array.from(fig.querySelectorAll('*'))]) {
      const copy = twins.get(original)
      if (copy?.nodeType === 1 && copy.isConnected) mirrorSentences(original, copy as Element, node => twins.get(node))
    }
    made++
  }
  return made
}

/**
 * Outside side mode, drop the copies whose signature expired (§15.2): after side → only the OCR arrives late and the
 * overlay goes into the hidden original, which the copy lacks; rebuilt only in side, the overlay would stay
 * invisible until the return to side. Remove the copy, take the mark off the original, show the original only (stack
 * shows the original anyway; in only the original's translations show as usual); a full tidy rebuilds them on the
 * return to side. Returns how many copies were dropped
 */
export function dropStaleSplits(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let dropped = 0
  for (const fig of Array.from(scope.querySelectorAll(`[${SPLIT_ATTR}]`))) {
    const sibling = fig.nextElementSibling
    const existing = sibling?.classList.contains(SPLIT_CLASS) ? sibling : null
    if (existing && existing.getAttribute(KEY_ATTR) === translationKey(fig)) continue
    existing?.remove()
    fig.removeAttribute(SPLIT_ATTR)
    dropped++
  }
  return dropped
}
