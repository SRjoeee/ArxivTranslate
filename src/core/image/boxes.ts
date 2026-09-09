// OCR lines → translation boxes (DESIGN §15.1). Pure functions shared by happy-dom and real browsers.
//
// Vision returns lines; wrapped labels ("Dynamical / charge", "Pair / Production") span two lines but need translation as one phrase.
// Merge vertically adjacent lines that align at the left edge or center and overlap horizontally.
// Filter per §6: do not translate numbers (ticks) or text without two consecutive letters (panel labels "B", "(a)", "E=+1").
// Also reject low confidence: Vision gives these 0.5, while real words are usually near 1.0.
// Parameters are calibrated against real coordinates in tests/fixtures/ocr/qed3d-string-breaking.json.
import { isNumericCell } from '@/core/rules/latexml'
import type { OcrLine, Quad } from '@/shared/ocr'

export interface Box {
  x: number
  y: number
  w: number
  h: number
  /** Merged source text, with spaces between lines. */
  text: string
  /** Number of merged lines; divide box height by this count for font sizing. */
  lines: number
}

export interface BoxOptions {
  /** Discard lines below this confidence. */
  minConf?: number
}

/** Axis-aligned bounding box of the quad; rotated axis labels are initially rendered using their enclosing box. */
export function quadBounds(quad: Quad): { x: number; y: number; w: number; h: number } {
  const xs = quad.map(([x]) => x)
  const ys = quad.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** Translatable text: at least two consecutive letters in any script, and not numeric. */
export function isTranslatable(text: string): boolean {
  const trimmed = text.trim()
  if (!/\p{L}{2,}/u.test(trimmed)) return false
  return !isNumericCell(trimmed)
}

/** Same column: left edges or centers differ by less than three quarters of a line height. */
function aligned(a: Box, b: { x: number; w: number; h: number }): boolean {
  const tolerance = 0.75 * Math.min(a.h / a.lines, b.h)
  const leftClose = Math.abs(a.x - b.x) <= tolerance
  const centerClose = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) <= tolerance
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
  return overlapX && (leftClose || centerClose)
}

/** Vertically adjacent: next line starts within 0.6 line heights of the previous box's bottom; slight overlap allowed. */
function adjacent(a: Box, b: { y: number; h: number }): boolean {
  const gap = b.y - (a.y + a.h)
  return gap <= 0.6 * Math.min(a.h / a.lines, b.h) && gap >= -0.5 * b.h
}

export function linesToBoxes(lines: readonly OcrLine[], options: BoxOptions = {}): Box[] {
  const minConf = options.minConf ?? 0.3
  const kept = lines
    .filter(line => line.conf >= minConf && isTranslatable(line.text))
    .map(line => ({ ...quadBounds(line.quad), text: line.text.trim() }))
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const boxes: Box[] = []
  for (const line of kept) {
    const host = boxes.find(box => adjacent(box, line) && aligned(box, line))
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
      boxes.push({ ...line, lines: 1 })
    }
  }
  return boxes
}
