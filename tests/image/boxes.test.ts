import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTranslatable, linesToBoxes, quadBounds } from '@/core/image/boxes'
import type { OcrLine, OcrResult, Quad } from '@/shared/ocr'

// OCR 行 → 译文框（DESIGN §15.1）。参数对着真实的 Vision 输出定：helper 冒烟测试倒出来的参考图结果

const FIXTURE: OcrResult = JSON.parse(readFileSync(join(import.meta.dirname, '../fixtures/ocr/qed3d-string-breaking.json'), 'utf8'))

const line = (text: string, x: number, y: number, w: number, h: number, conf = 1): OcrLine => ({
  text, conf, quad: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]],
})

describe('quadBounds', () => {
  it('旋转的四角取轴对齐外接框', () => {
    const quad: Quad = [[0.1, 0.2], [0.3, 0.22], [0.29, 0.3], [0.09, 0.28]]
    expect(quadBounds(quad)).toEqual({ x: 0.09, y: 0.2, w: 0.3 - 0.09, h: 0.3 - 0.2 })
  })
})

describe('isTranslatable', () => {
  it('至少两个连续字母且不是数值', () => {
    expect(isTranslatable('Even sites')).toBe(true)
    expect(isTranslatable('Δ-lattice')).toBe(true)
    expect(isTranslatable('B')).toBe(false) // 单字母面板标号
    expect(isTranslatable('(a)')).toBe(false)
    expect(isTranslatable('E=+1')).toBe(false)
    expect(isTranslatable('12.5')).toBe(false)
    expect(isTranslatable('1e-3')).toBe(false)
    expect(isTranslatable('')).toBe(false)
  })
})

describe('linesToBoxes', () => {
  it('竖直相邻、左缘或中线对齐的行合成一框，文本空格相连、行数累加', () => {
    // "Pair / Production" 是中线对齐、左缘差得远（真实坐标）
    const boxes = linesToBoxes([line('Pair', 0.397, 0.194, 0.055, 0.017), line('Production', 0.366, 0.214, 0.141, 0.020)])
    expect(boxes).toHaveLength(1)
    expect(boxes[0]).toMatchObject({ text: 'Pair Production', lines: 2, x: 0.366, y: 0.194 })
    expect(boxes[0]!.w).toBeCloseTo(0.141, 5)
    expect(boxes[0]!.h).toBeCloseTo(0.040, 5)
  })

  it('不对齐或横向不重叠的不合：两列各自成框', () => {
    const boxes = linesToBoxes([line('Loop', 0.641, 0.431, 0.066, 0.023), line('string', 0.834, 0.431, 0.066, 0.018), line('Production', 0.610, 0.449, 0.138, 0.020), line('Extension', 0.814, 0.448, 0.113, 0.018)])
    expect(boxes.map(b => b.text).sort()).toEqual(['Loop Production', 'string Extension'])
  })

  it('竖直距离超过 0.6 行高的不合：两个独立标签', () => {
    // "charge"（底 0.167）与下面的 "Static charge"（顶 0.187）：间隙 0.02 > 0.6 × 0.023
    const boxes = linesToBoxes([line('charge', 0.087, 0.144, 0.089, 0.023), line('Static charge', 0.066, 0.187, 0.182, 0.025)])
    expect(boxes).toHaveLength(2)
  })

  it('过滤：置信度低的、纯数字、单字母、无字母的各丢一例，正常的留下', () => {
    const boxes = linesToBoxes([
      line('Even sites', 0.1, 0.1, 0.1, 0.02),
      line('Odd sites', 0.5, 0.1, 0.1, 0.02, 0.2), // conf 低
      line('12.5', 0.1, 0.5, 0.05, 0.02),
      line('B', 0.3, 0.5, 0.02, 0.02),
      line('E=+1', 0.5, 0.5, 0.05, 0.02),
    ])
    expect(boxes.map(b => b.text)).toEqual(['Even sites'])
  })

  it('真实数据：参考图 27 行合成 15 框，换行的标签合并、面板标号与符号被丢掉', () => {
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
    // 合并框的行数与外接框：Dynamical charge 两行，底到 charge 的底
    const dyn = boxes.find(b => b.text === 'Dynamical charge')!
    expect(dyn.lines).toBe(2)
    expect(dyn.y + dyn.h).toBeCloseTo(0.167, 2)
  })
})
