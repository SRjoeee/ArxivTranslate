import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTranslatable, linesToBoxes, quadBounds } from '@/core/image/boxes'
import type { OcrLine, OcrResult, Quad } from '@/shared/ocr'

// OCR lines → translation boxes (DESIGN §15.1), calibrated against real Vision output from the helper smoke-test reference image.

const FIXTURE: OcrResult = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/ocr/qed3d-string-breaking.json'), 'utf8'))

const line = (text: string, x: number, y: number, w: number, h: number, conf = 1): OcrLine => ({
  text, conf, quad: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
})

describe('quadBounds', () => {
  it('uses the axis-aligned bounding box of rotated corners', () => {
    const quad: Quad = [[0.1, 0.2], [0.3, 0.22], [0.29, 0.3], [0.09, 0.28]]
    expect(quadBounds(quad)).toEqual({ x: 0.09, y: 0.2, w: 0.3 - 0.09, h: 0.3 - 0.2 })
  })
})

describe('isTranslatable', () => {
  it('requires at least two consecutive letters and nonnumeric content', () => {
    expect(isTranslatable('Even sites')).toBe(true)
    expect(isTranslatable('Δ-lattice')).toBe(true)
    expect(isTranslatable('B')).toBe(false) // Single-letter panel label
    expect(isTranslatable('(a)')).toBe(false)
    expect(isTranslatable('E=+1')).toBe(false)
    expect(isTranslatable('12.5')).toBe(false)
    expect(isTranslatable('1e-3')).toBe(false)
    expect(isTranslatable('')).toBe(false)
  })
})

describe('linesToBoxes', () => {
  it('merges vertically adjacent lines aligned on their left edge or center; joins text with spaces and sums line counts', () => {
    // "Pair / Production" is center-aligned with widely separated left edges (real coordinates).
    const boxes = linesToBoxes([line('Pair', 0.397, 0.194, 0.055, 0.017), line('Production', 0.366, 0.214, 0.141, 0.020)])
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ text: 'Pair Production', lines: 2, x: 0.366, y: 0.194 })
    expect(boxes[0]!.w).toBeCloseTo(0.141, 5)
    expect(boxes[0]!.h).toBeCloseTo(0.040, 5)
  })

  it('keeps misaligned or horizontally disjoint lines separate, producing one box per column', () => {
    const boxes = linesToBoxes([line('Loop', 0.641, 0.431, 0.066, 0.023), line('string', 0.834, 0.431, 0.066, 0.018), line('Production', 0.610, 0.449, 0.138, 0.020), line('Extension', 0.814, 0.448, 0.113, 0.018)])
    expect(boxes.map(b => b.text).sort()).toEqual(['Loop Production', 'string Extension'])
  })

  it('keeps labels separate when the vertical gap exceeds 0.6 line heights', () => {
    // "charge" ends at 0.167 and "Static charge" starts at 0.187: gap 0.02 > 0.6 × 0.023.
    const boxes = linesToBoxes([line('charge', 0.087, 0.144, 0.089, 0.023), line('Static charge', 0.066, 0.187, 0.182, 0.025)])
    expect(boxes).toHaveLength(2)
  })

  it('filters one low-confidence, numeric, single-letter, and letterless sample each while keeping normal text', () => {
    const boxes = linesToBoxes([
      line('Even sites', 0.1, 0.1, 0.1, 0.02),
      line('Odd sites', 0.5, 0.1, 0.1, 0.02, 0.2), // Low confidence
      line('12.5', 0.1, 0.5, 0.05, 0.02),
      line('B', 0.3, 0.5, 0.02, 0.02),
      line('E=+1', 0.5, 0.5, 0.05, 0.02),
    ])
    expect(boxes.map(b => b.text)).toEqual(['Even sites'])
  })

  it('real data: merges 27 reference-image lines into 15 boxes, joining multiline labels and dropping panel letters and symbols', () => {
    const boxes = linesToBoxes(FIXTURE.lines)
    const texts = boxes.map(b => b.text)
    for (const merged of ['Dynamical charge', 'Electric membrane', 'Plaquette deformation', 'Pair Production', 'Loop Production', 'string Extension', 'Tree tensor networks']) {
      expect(texts, merged).toContain(merged)
    }
    for (const kept of ['Static charge', 'Processes', 'Dressed sites', 'Even sites', 'Odd sites', '(b) Breaking', 'String']) {
      expect(texts, kept).toContain(kept)
    }
    for (const dropped of ['B', '(a)', '(a', 'E=+1', 'E=-1']) {
      expect(texts, dropped).not.toContain(dropped)
    }
    expect(boxes).toHaveLength(15)
    // merged line count and bounds: Dynamical charge spans two lines and ends at the bottom of charge
    const dyn = boxes.find(b => b.text === 'Dynamical charge')!
    expect(dyn.lines).toBe(2)
    expect(dyn.y + dyn.h).toBeCloseTo(0.167, 2)
  })
})
