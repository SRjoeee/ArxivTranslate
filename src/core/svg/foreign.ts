// Text in an inline TikZ picture (DESIGN §15.6).
//
// LaTeXML draws `\begin{tikzpicture}` as an `<svg class="ltx_picture">` inline in the page, and puts
// every node's label in a `<foreignObject>` as ordinary HTML:
//
//   <foreignObject width="140.33" height="13.84" transform="matrix(1 0 0 -1 0 10.38)">
//     <span class="ltx_foreignobject_container"><span class="ltx_foreignobject_content">(a) Imbalanced routing</span></span>
//   </foreignObject>
//
// So the text needs neither OCR nor the glyph reconstruction the external figures need (§15.5): it
// is HTML in the main document, and so is its box. Reading both as rectangles is exact whatever the
// picture is nested in — LaTeXML wraps these in `.ltx_transformed_inner` with a CSS `scale()`, and
// `getBoundingClientRect` has already applied it to the picture and the label alike.
//
// Phase 0 measured these pictures as having no translatable text and the text pipeline skips them
// (rule `picture`); that still holds for what it measured — a 2023 maths paper draws formulas in
// TikZ, and formulas are `<math>`, which `visibleText` leaves out. It does not hold for the
// architecture diagrams of a modern ML paper: across the fixture corpus plus four live papers,
// 954 foreignObjects, 199 of them carrying real words — 184 in one paper (reported 2026-09-11).
//
// **Read-only, like the rest of §15**: the overlay is a sibling of the `<svg>`, nothing inside the
// picture is touched, and §7.1 is unaffected.
import { FIGURE_SELECTORS, classify, proseText } from '@/core/rules/latexml'
import type { OcrLine, Quad } from '@/shared/ocr'
import { collectText, squash } from '@/core/text'

/**
 * MathML's own copy of the TeX source, which sits beside the rendered markup inside `<semantics>`.
 * It is not rendered, so it must not be read: `textContent` of `Block n-1` otherwise comes out
 * `Block n−1n-1` — the rendered symbol followed by the source that produced it.
 */
const MATH_ANNOTATION = 'annotation, annotation-xml'

/**
 * What a label actually shows.
 *
 * Not `visibleText` from the rules module: that leaves out everything the rules protect, maths
 * included, because for an HTML block a formula is a placeholder that will be put back. Here the
 * overlay covers the label's whole box, so a `Block n−1` node whose text came back as `Block` would
 * hide the `n−1` behind a white label reading `块`. The glyph path (§15.5) has always sent the
 * symbols along for the same reason — they are glyphs like any other. What is dropped is what the
 * rules class as *skip* (a conversion error, a listing) and the annotation above.
 */
function renderedText(label: Element): string {
  return squash(collectText(label, el => el.matches(MATH_ANNOTATION) || classify(el)?.kind === 'skip'))
}

/**
 * Two consecutive letters, the same bar `isTranslatable` sets downstream — applied here to what is
 * left of the label once the **maths is taken out**, which is the difference that matters.
 *
 * A node that is nothing but a formula must be left alone: `softmax`, `argmax` and `exp` are words
 * to a translator and symbols to a reader, and a white label reading 「软最大」 over a formula is
 * worse than no translation at all. `proseText` is exactly "the label minus what the rules protect,
 * minus the identifiers LaTeXML marked as maths", so a label with no letters left in it after that
 * is pure maths (the corpus has one: 2609.00246's `initMT`, a `.ltx_markedasmath` span — Codex on #163).
 * `Block n−1` keeps its `Block` and is translated whole, symbol and all.
 */
const WORDY = /\p{L}{2,}/u

/** The label as the reader sees it, or '' when it is pure maths / nothing worth translating */
function labelText(label: Element): string {
  if (!WORDY.test(proseText(label))) return ''
  return renderedText(label)
}

/**
 * Every label's text, without touching geometry.
 *
 * `collectImageTargets` uses it to leave out the pictures that hold no words — most of the corpus's
 * 170 are drawn formulas — and it runs over every picture in the paper, so it must not read a single
 * rectangle: that would be a forced layout per picture before the page has even been translated.
 */
export function pictureTexts(picture: Element): string[] {
  const out: string[] = []
  for (const label of Array.from(picture.querySelectorAll(FIGURE_SELECTORS.pictureText))) {
    const text = labelText(label)
    if (text !== '') out.push(text)
  }
  return out
}

/** Where a label sits inside the picture's box, as fractions of it */
function quadOf(label: DOMRect, box: DOMRect): Quad {
  const x0 = (label.left - box.left) / box.width
  const x1 = (label.right - box.left) / box.width
  const y0 = (label.top - box.top) / box.height
  const y1 = (label.bottom - box.top) / box.height
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]
}

/**
 * A picture's labels as `OcrLine`s, in the same normalised shape the other two sources produce, so
 * everything downstream — the translatable filter, the request, the cache key, the overlay — is
 * shared and knows nothing about where the text came from.
 *
 * `conf` is 1: the text was read, not recognised.
 *
 * Measured across the corpus: not one foreignObject carries a rotation (825 checked; the matrix on
 * them is LaTeXML's y-flip), so every label is upright and its client rect *is* its box. `rows`
 * comes from the count of line boxes — 8.6% of labels wrap, and the overlay sizes its font by the
 * box height divided by the rows it holds.
 */
export function foreignLinesOf(picture: Element): OcrLine[] {
  const box = picture.getBoundingClientRect()
  if (box.width <= 0 || box.height <= 0) return []
  const out: OcrLine[] = []
  const seen = new Set<string>()
  for (const label of Array.from(picture.querySelectorAll(FIGURE_SELECTORS.pictureText))) {
    const text = labelText(label)
    if (text === '') continue
    const rect = label.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) continue
    // A TikZ node drawn twice at the same spot (2607.24653v2's diagram has four `Stable LatentMoE`,
    // two of them coincident) would be two identical labels stacked and two identical segments in
    // the request
    const key = `${text}@${Math.round(rect.left)},${Math.round(rect.top)}`
    if (seen.has(key)) continue
    seen.add(key)
    const rows = label.getClientRects().length
    out.push({ text, quad: quadOf(rect, box), conf: 1, ...(rows > 1 ? { rows } : {}) })
  }
  return out
}
