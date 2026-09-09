// Image overlay (DESIGN §15.2): .axt-img is the next sibling of <img>, with one span per translated label.
// Write position / size as normalized percentages and font size in container-query units, calculated once in JS without geometry reads.
// No .axt-t (see IMG_CLASS in marks.ts). Insert only on success; pending / failed states create no DOM nodes.
// Consistent with §7.1: add no attributes to <img>; restore removes the entire layer via INJECTED_SELECTOR.
import { IMG_CLASS } from '@/core/marks'
import { FOR_ATTR, LANG_ATTR } from './index'
import { MIRROR_CLASS } from './mirror'

/** Mode gate on <html>: space-separated selected modes, matched with CSS ~= (§15 settings). */
export const IMG_MODES_ATTR = 'data-axt-img-modes'

export interface ImageTarget {
  id: string
  el: HTMLImageElement
}

/** Translated label: normalized image coordinates (0–1, top-left origin); lines is the merged OCR line count. */
export interface ImageLabel {
  x: number
  y: number
  w: number
  h: number
  lines: number
  /** OCR source text shown on hover. */
  source: string
  /** Translation. */
  text: string
}

export function setImageModes(doc: Document, modes: readonly string[]): void {
  if (modes.length > 0) doc.documentElement.setAttribute(IMG_MODES_ATTR, modes.join(' '))
  else doc.documentElement.removeAttribute(IMG_MODES_ATTR)
}

/** Existing overlay under the same parent, associated with the target through data-axt-for. */
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
 * Estimate text width in em: 1 per CJK character, 0.55 for other characters (average Latin width), 0.3 for spaces.
 * Used only to cap font size by width; exact metrics are unnecessary. Chinese translations are usually shorter, so height usually controls size.
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
 * Inline label style: position / dimensions as image percentages; font size = min(height-based, width-based) in container-query units.
 * The overlay is a size container, so 1cqh = 1% of image height. Line height 1.15; one line uses about 72% of box height, divided across merged lines.
 */
export function labelStyle(label: ImageLabel): string {
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`
  const lines = Math.max(1, label.lines)
  const byHeight = (72 * label.h) / lines
  // Width cap: text spans lines rows, each about emWidth / lines em; reserve an 8% margin.
  const byWidth = (92 * label.w * lines) / emWidth(label.text)
  return `left:${pct(label.x)};top:${pct(label.y)};width:${pct(label.w)};height:${pct(label.h)};font-size:min(${byHeight.toFixed(2)}cqh,${byWidth.toFixed(2)}cqw)`
}

/**
 * Insert an image overlay idempotently: replace, never stack. Return the overlay node.
 * Remove any immediately following mirror first. Mirroring runs once per session before OCR, inserting between the image and overlay.
 * The overlay must be the next sibling: anchors resolve to the nearest preceding matching name, and img:has(+ .axt-img) requires adjacency.
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
  for (const label of labels) {
    const span = doc.createElement('span')
    span.textContent = label.text
    span.title = label.source
    if (lang) span.setAttribute('lang', lang)
    span.setAttribute('style', labelStyle(label))
    node.append(span)
  }
  target.el.after(node)
  return node
}
