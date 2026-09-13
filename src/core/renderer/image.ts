// The image overlay (DESIGN §15.2): the <img>'s next sibling `.axt-img`, one span per translated label inside;
// position and size are written as percentages of the normalised coordinates, the font size in container query
// units — all computed into strings in JS and written once, **reading no geometry**. The overlay carries no .axt-t
// (marks.ts says why under IMG_CLASS) and is inserted on success only; pending and failure have no DOM node. In
// keeping with §7.1: the <img> itself gains no attribute; restore removes the whole layer by INJECTED_SELECTOR.
import { IMG_CLASS } from '@/core/marks'
import { DIR_ATTR, FOR_ATTR, LANG_ATTR, MIRROR_CLASS, SPLIT_FOR_ATTR } from './attrs'

/** The mode gate on <html>: the set of modes the reader ticked, space-separated; CSS matches the current mode with ~= (the §15 setting) */
export const IMG_MODES_ATTR = 'data-axt-img-modes'

export interface ImageTarget {
  id: string
  el: Element
  /**
   * A bitmap goes “bytes → OCR”, an external SVG figure reads the glyphs of its `contentDocument` directly (§15.5),
   * an inline TikZ figure reads the HTML inside `foreignObject` and its rectangle (§15.6). The three meet in
   * `linesToBoxes`; the overlay, the cache and the scheduling after that are one and the same
   */
  kind: 'raster' | 'svg' | 'picture'
}

/** One translated label: position and size in the image's normalised coordinates (0–1, top-left origin); lines is how many OCR lines were merged into it */
export interface ImageLabel {
  x: number
  y: number
  w: number
  h: number
  lines: number
  /** The OCR source text, shown on hover */
  source: string
  /** The translation */
  text: string
  /** Text direction in radians; absent means horizontal (§15.5) */
  angle?: number
  /** A tilted label's own length and thickness, both as fractions of the image's **width**; present with angle */
  len?: number
  thick?: number
}

export function setImageModes(doc: Document, modes: readonly string[]): void {
  if (modes.length > 0) doc.documentElement.setAttribute(IMG_MODES_ATTR, modes.join(' '))
  else doc.documentElement.removeAttribute(IMG_MODES_ATTR)
}

/** The overlay the target already has (in the same parent, data-axt-for pointing at it) */
export function overlayOf(target: ImageTarget): Element | null {
  const parent = target.el.parentElement
  if (!parent) return null
  for (const child of Array.from(parent.children)) {
    if (child.classList.contains(IMG_CLASS) && child.getAttribute(FOR_ATTR) === target.id) return child
  }
  return null
}

export function clearImage(target: ImageTarget): boolean {
  const existing = overlayOf(target)
  if (!existing) return false
  existing.remove()
  return true
}

/**
 * This image's overlays **anywhere in the document**, the one inside a side-mode split copy included.
 *
 * `clearImage` looks only at the image's own sibling slot, enough for “replace with a fresh one” — the copy is
 * rebuilt by signature at the next tidy. Not enough for “no longer translating this image”: the copy's overlay
 * stays, and in only mode **the original is hidden**, so what the reader sees is exactly the copy's overlay from
 * the previous run, or even the previous target language (Codex on #134)
 */
export function clearImageEverywhere(target: ImageTarget): number {
  const doc = target.el.ownerDocument
  // The copy's overlay answers to `data-axt-split-for`: `stripIds` wipes every `data-axt-*` off the clone, so a lookup
  // by `data-axt-for` alone would leave the copy's overlay there for good (Codex on #134)
  const id = CSS.escape(target.id)
  const stale = Array.from(doc.querySelectorAll(`.${IMG_CLASS}[${FOR_ATTR}="${id}"], .${IMG_CLASS}[${SPLIT_FOR_ATTR}="${id}"]`))
  for (const node of stale) node.remove()
  return stale.length
}

/**
 * Roughly how many ems a run of text spans: one em per CJK character, 0.55 em for the rest (the average width of
 * Latin letters), 0.3 em for a space. Only an upper bound for the font size, not a measurement — the translation is
 * mostly Chinese and usually shorter than the source, and the box height decides the size
 */
export function emWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    if (/\s/.test(ch)) width += 0.3
    else if (/[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch)) width += 1
    else width += 0.55
  }
  return Math.max(width, 0.55)
}

/**
 * A label's inline style: position and size as percentages of the image, font size = min(by box height, by box
 * width), in container query units (the overlay is a size container: 1cqh is 1% of the image's height, 1cqw 1% of
 * its width). Line height 1.15, one line takes about 72% of the box height; a multi-line box shares it out by line
 * count. **No geometry is read**: the whole string is computed in JS and written once.
 *
 * **A vertical label (`angle`) cannot use percentages.** Rotated 90° about its centre, the box's width becomes the
 * vertical extent on screen and its height the horizontal thickness; `width: X%` is a percentage of the container's
 * **width**, wrong for the length whenever the container is not square. So a vertical label's width is written in
 * `cqh` (a percentage of the image height — the axis the text really runs along) and its height in `cqw`, with
 * left / top as `calc()` from the centre minus half — the two units subtract inside calc, both being percentages
 * of the same container.
 */
export function labelStyle(label: ImageLabel): string {
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`
  const cq = (v: number) => `${(v * 100).toFixed(3)}cqw`
  const lines = Math.max(1, label.lines)
  if (label.angle && label.len && label.thick) {
    // A tilted label sits along **its own axis**: the box is the text's own length and thickness (not the axis-aligned
    // bounding box — that one coincides with the text only at multiples of 90° and is a size larger at 5°), placed
    // centre on centre and then rotated as a whole. Both axes use cqw (a percentage of the image width, one length
    // unit), so one number is the same real length whichever way it points; `width: X%` would become “a percentage
    // of the container width”, wrong for the vertical length whenever the container is not square
    const cx = label.x + label.w / 2
    const cy = label.y + label.h / 2
    const byThickness = (72 * label.thick) / lines
    const byLength = (92 * label.len * lines) / emWidth(label.text)
    return `left:${pct(cx)};top:${pct(cy)};width:${cq(label.len)};height:${cq(label.thick)};`
      + `transform:translate(-50%,-50%) rotate(${((label.angle * 180) / Math.PI).toFixed(2)}deg);`
      + `font-size:min(${byThickness.toFixed(2)}cqw,${byLength.toFixed(2)}cqw)`
  }
  const byHeight = (72 * label.h) / lines
  // The width cap: the text splits into `lines` rows of about emWidth / lines ems each; 8% margin kept
  const byWidth = (92 * label.w * lines) / emWidth(label.text)
  return `left:${pct(label.x)};top:${pct(label.y)};width:${pct(label.w)};height:${pct(label.h)};font-size:min(${byHeight.toFixed(2)}cqh,${byWidth.toFixed(2)}cqw)`
}

/**
 * Insert an image's overlay; idempotent, a re-render replaces rather than stacks. Returns the overlay node.
 * A mirror right after the image is removed first: mirrors run once per session, before OCR, and would sit between
 * the image and the overlay — the overlay must be the image's **next** sibling (anchors resolve to “the nearest
 * preceding node of that name”, and `img:has(+ .axt-img)` accepts an adjacent one only)
 */
export function renderImage(target: ImageTarget, labels: readonly ImageLabel[]): Element {
  clearImage(target)
  const next = target.el.nextElementSibling
  if (next?.classList.contains(MIRROR_CLASS)) next.remove()
  const doc = target.el.ownerDocument
  const node = doc.createElement('div')
  node.className = IMG_CLASS
  node.setAttribute(FOR_ATTR, target.id)
  const lang = doc.documentElement.getAttribute(LANG_ATTR)
  // A label in an image needs `dir` as well: an Arabic label under an ltr base direction puts its punctuation at the wrong end (§7.5)
  const dir = doc.documentElement.getAttribute(DIR_ATTR)
  for (const label of labels) {
    const span = doc.createElement('span')
    span.textContent = label.text
    span.title = label.source
    if (lang) span.setAttribute('lang', lang)
    if (dir) span.setAttribute('dir', dir)
    span.setAttribute('style', labelStyle(label))
    node.append(span)
  }
  target.el.after(node)
  return node
}
