// OCR 行 → 译文框（DESIGN §15.1）。纯函数，happy-dom 与真机同一份。
//
// Vision 按行返回；图里换行的标签（"Dynamical / charge"、"Pair / Production"）是两行，翻译要当一句送，
// 所以竖直相邻、水平对齐（左缘或中线）、横向有重叠的行合成一个框。
// 过滤照 §6 的保留规则：纯数字（刻度）、不含两个连续字母的（单字母面板标号 "B"、"(a)"、"E=+1"）不翻，
// 置信度太低的也不要——Vision 对这些给 0.5，真正的词几乎都是 1.0。
// 规则参数对着 tests/fixtures/ocr/qed3d-string-breaking.json 里的真实坐标定的。
import { isNumericCell } from '@/core/rules/latexml'
import type { OcrLine, Quad } from '@/shared/ocr'

export interface Box {
  x: number
  y: number
  w: number
  h: number
  /** 合并后的原文（行之间空格相连） */
  text: string
  /** 合并进来的行数，字号按它均摊 */
  lines: number
}

export interface BoxOptions {
  /** 低于这个置信度的行丢掉 */
  minConf?: number
}

/** 四角的轴对齐外接框：旋转的坐标轴标签四角不是轴对齐的，先按外接框画 */
export function quadBounds(quad: Quad): { x: number; y: number; w: number; h: number } {
  const xs = quad.map(([x]) => x)
  const ys = quad.map(([, y]) => y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** 值得翻的文字：至少两个连续字母（任何文字），且不是数值 */
export function isTranslatable(text: string): boolean {
  const trimmed = text.trim()
  if (!/\p{L}{2,}/u.test(trimmed)) return false
  return !isNumericCell(trimmed)
}

/** 同一列：左缘或中线相差不到四分之三行高 */
function aligned(a: Box, b: { x: number; w: number; h: number }): boolean {
  const tolerance = 0.75 * Math.min(a.h / a.lines, b.h)
  const leftClose = Math.abs(a.x - b.x) <= tolerance
  const centerClose = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2)) <= tolerance
  const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0
  return overlapX && (leftClose || centerClose)
}

/** 竖直相邻：下一行的顶到上一框的底不超过 0.6 行高（允许轻微重叠） */
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
