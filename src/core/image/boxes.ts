// OCR lines → translation boxes (DESIGN §15.1). Pure functions, one and the same under happy-dom and on a real machine.
//
// Vision returns lines; a label wrapped in the image ("Dynamical / charge", "Pair / Production") is two lines and
// has to be sent as one sentence, so lines that are vertically adjacent, aligned (left edge or centre line) and
// overlapping horizontally merge into one box. The filter follows the keep rules of §6: bare numbers (tick marks),
// text without two consecutive letters (single-letter panel labels "B", "(a)", "E=+1") are not translated, and
// low confidence is dropped — Vision gives these 0.5, and real words are almost all 1.0.
// The rule parameters were set against the real coordinates in tests/fixtures/ocr/qed3d-string-breaking.json.
import { isNumericCell } from '@/core/rules/latexml'
import type { OcrLine, Quad } from '@/shared/ocr'

export interface Box {
  x: number
  y: number
  w: number
  h: number
  /** The merged source text (lines joined with spaces) */
  text: string
  /** How many lines were merged in; the font size is shared out by it */
  lines: number
  /**
   * A rotated label's own box (both as fractions of the image's **width**): `len` along the baseline, `thick` across
   * it. Only lines with an `angle` have it; the axis-aligned bounding box is both too large for a tilted label and
   * in two different scales on its two axes, so it cannot place one (§15.5)
   */
  len?: number
  thick?: number
  /**
   * Text direction in radians; absent means upright (§15.5).
   *
   * Set by the SVG path only, and the corpus has only 0 and -π/2. **A rotated line takes no part in merging**: the
   * adjacency / alignment tests below are written for “lines stacking downwards”, while a vertical line stacks
   * sideways, and applying them would glue two unrelated axis labels together. A vertical label is rarely multi-line anyway.
   */
  angle?: number
}

export interface BoxOptions {
  /** Lines below this confidence are dropped */
  minConf?: number
  /**
   * Whether vertically adjacent, aligned lines are one label. True for anything that arrives as
   * *lines* — OCR and glyph runs both cut a wrapped label into one per line, and translating the
   * halves separately would be translating half sentences.
   *
   * The inline-picture path (§15.6) passes false: there a line is a whole TikZ node, already
   * complete however it wraps, and two nodes stacked close together in a diagram ("Stable
   * LatentMoE" over "Gated MLA") would otherwise be merged into one label across both boxes.
   */
  merge?: boolean
}

/** The axis-aligned bounding box of the four corners: a rotated axis label's corners are not axis-aligned, so its box is drawn first */
export function quadBounds(quad: Quad): { x: number; y: number; w: number; h: number } {
  const xs = quad.map(([x]) => x)
  const ys = quad.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Text worth translating: at least two consecutive letters (of any script), and not a number */
export function isTranslatable(text: string): boolean {
  const trimmed = text.trim()
  if (!/\p{L}{2,}/u.test(trimmed)) return false
  return !isNumericCell(trimmed)
}

/** The same column: left edges or centre lines within three quarters of a line height */
function aligned(a: Box, b: { x: number; w: number; h: number }): boolean {
  const tolerance = 0.75 * Math.min(a.h / a.lines, b.h)
  const leftClose = Math.abs(a.x - b.x) <= tolerance
  const centerClose = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) <= tolerance
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
  return overlapX && (leftClose || centerClose)
}

/** Vertically adjacent: the next line's top within 0.6 line heights of the previous box's bottom (slight overlap allowed) */
function adjacent(a: Box, b: { y: number; h: number }): boolean {
  const gap = b.y - (a.y + a.h)
  return gap <= 0.6 * Math.min(a.h / a.lines, b.h) && gap >= -0.5 * b.h
}

export function linesToBoxes(lines: readonly OcrLine[], options: BoxOptions = {}): Box[] {
  const minConf = options.minConf ?? 0.3
  const merge = options.merge ?? true
  const kept = lines
    .filter(line => line.conf >= minConf && isTranslatable(line.text))
    .map(line => ({ ...quadBounds(line.quad), text: line.text.trim(), angle: line.angle, len: line.len, thick: line.thick, rows: line.rows }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const boxes: Box[] = []
  for (const line of kept) {
    const host = !merge || line.angle ? undefined : boxes.find(box => !box.angle && adjacent(box, line) && aligned(box, line))
    if (host) {
      const right = Math.max(host.x + host.w, line.x + line.w)
      const bottom = Math.max(host.y + host.h, line.y + line.h)
      host.x = Math.min(host.x, line.x)
      host.y = Math.min(host.y, line.y)
      host.w = right - host.x
      host.h = bottom - host.y
      host.text = `${host.text} ${line.text}`
      host.lines++
    } else {
      // A picture label knows how many lines it wraps to (§15.6); everything else is one line
      const { rows, ...rest } = line
      boxes.push({ ...rest, lines: Math.max(1, rows ?? 1) })
    }
  }
  return boxes
}
