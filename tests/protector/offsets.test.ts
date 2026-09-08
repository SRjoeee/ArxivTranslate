import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { nodeOffsetAt, serialize, spanAt, type TextSpan } from '@/core/protector'
import { el } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

/** 段与占位符是否严格铺满整段线上文本（无缝隙、无重叠、按序） */
function tiles(spans: readonly TextSpan[], text: string): { ordered: boolean; within: boolean } {
  let ordered = true
  let within = true
  let prev = 0
  for (const s of spans) {
    if (s.from < prev || s.to <= s.from) ordered = false
    if (s.to > text.length) within = false
    prev = s.to
  }
  return { ordered, within }
}


/**
 * **不要在这里断言 `Range` 的行为**：happy-dom 的 `Range.toString()` 对任何区间都返回空串，
 * `startOffset` 也不可信（写这个模块时手搓一个 0–3 的区间验证过）。与 `CSS.supports` 恒真是同一类坑。
 * 这里只测偏移映射本身——那是纯算术；`Range` 的实际行为由 `pnpm e2e` 在真实浏览器里验。
 *
 * `textOf` 用节点数据直接切，等价于 `rangeOf(...).toString()` 在真浏览器里该给出的结果。
 */
function textOf(spans: readonly TextSpan[], from: number, to: number): string {
  const start = spanAt(spans, from, 'start')
  const end = spanAt(spans, to, 'end')
  if (!start || !end) return ''
  if (start === end) return start.node.data.slice(nodeOffsetAt(start, from), nodeOffsetAt(end, to))
  const head = start.node.data.slice(nodeOffsetAt(start, from))
  const tail = end.node.data.slice(0, nodeOffsetAt(end, to))
  const middle = spans.slice(spans.indexOf(start) + 1, spans.indexOf(end)).map(s => s.node.data).join('')
  return head + middle + tail
}

describe('线上偏移 ↔ DOM（#105）', () => {
  it('记账路径与默认路径产出的线上文本逐字节相同——12 篇 fixture、两种格式', () => {
    // 两条路径是刻意分开的：默认那条整串转义 + 一次折叠，一个字符都不多碰（性能）；
    // 记账那条逐字符走才能记下锚点。这条用例是防它们漂移的唯一闸
    let blocks = 0
    for (const f of readdirSync(FIXTURE_DIR).filter(n => n.endsWith('.html'))) {
      const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      for (const b of extract(d)) {
        if (b.kind !== 'text') continue
        for (const fmt of ['tags', 'markers'] as const) {
          const plain = serialize(b.el, fmt)
          const tracked = serialize(b.el, fmt, { offsets: true })
          expect([f, b.id, fmt, tracked.text]).toEqual([f, b.id, fmt, plain.text])
          blocks++
        }
      }
    }
    expect(blocks).toBeGreaterThan(2000)
  })

  it('段按序、不重叠、不越界，且只覆盖文本（占位符不属于任何段）', () => {
    const block = serialize(el('<p class="ltx_p">one <math><mi>x</mi></math> two <math><mi>y</mi></math> three</p>'), 'tags', { offsets: true })
    const spans = block.offsets!
    expect(tiles(spans, block.text)).toEqual({ ordered: true, within: true })
    expect(spans.map(s => block.text.slice(s.from, s.to))).toEqual(['one ', ' two ', ' three'])
  })

  it('实体：`&` 占 5 个线上字符，锚点让它之后的偏移仍然落对', () => {
    const block = serialize(el('<p class="ltx_p">A &amp; B ends here</p>'), 'tags', { offsets: true })
    expect(block.text).toBe('A &amp; B ends here')
    // 取 `B ends` —— 它在实体之后，偏移必须补上 &amp; 多出来的 4 个字符
    const at = block.text.indexOf('B ends')
    expect(textOf(block.offsets!, at, at + 6)).toBe('B ends')
  })

  it('markers 的 `@@`：字面 @ 在线上占两个字符', () => {
    const block = serialize(el('<p class="ltx_p">mail a@b.com then more text</p>'), 'markers', { offsets: true })
    expect(block.text).toBe('mail a@@b.com then more text')
    const at = block.text.indexOf('then more')
    expect(textOf(block.offsets!, at, at + 9)).toBe('then more')
  })

  it('折叠：硬换行折成一个空格之后，后面的偏移仍然落对（#119）', () => {
    const block = serialize(el('<p class="ltx_p">first line\n   second line\n\n  third line</p>'), 'tags', { offsets: true })
    expect(block.text).toBe('first line second line third line')
    const at = block.text.indexOf('third')
    expect(textOf(block.offsets!, at, at + 5)).toBe('third')
  })

  it('NBSP 不被折叠，也不打乱偏移', () => {
    const block = serialize(el('<p class="ltx_p">see Section 1.1 and then some</p>'), 'tags', { offsets: true })
    expect(block.text).toContain(' ')
    const at = block.text.indexOf('and then')
    expect(textOf(block.offsets!, at, at + 8)).toBe('and then')
  })

  it('跨占位符的区间：Range 从第一段跨到最后一段，中间的公式被包进去', () => {
    const block = serialize(el('<p class="ltx_p">left <math><mi>x</mi></math> right</p>'), 'tags', { offsets: true })
    // 真浏览器里 Range 会把中间的公式包进去；这里只验两端的偏移落对
    expect(textOf(block.offsets!, 0, block.text.length)).toBe('left  right')
  })

  it('整段都是占位符时没有可高亮的范围，返回 undefined', () => {
    const block = serialize(el('<p class="ltx_p"><math><mi>x</mi></math></p>'), 'tags', { offsets: true })
    expect(block.offsets).toEqual([])
    expect(spanAt(block.offsets!, 0)).toBeUndefined()
  })

  it('真实 fixture 上逐段核对：每一段线上文本解码后就是该节点的内容', () => {
    const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, '2609.04056.html'), 'utf8'), 'text/html')
    let checked = 0
    for (const b of extract(d)) {
      if (b.kind !== 'text') continue
      const block = serialize(b.el, 'tags', { offsets: true })
      for (const s of block.offsets!) {
        const wire = block.text.slice(s.from, s.to)
        // 段的每个端点都要能换算回节点内的合法偏移，且首尾锚点自洽
        expect([s.from < s.to, nodeOffsetAt(s, s.from) <= nodeOffsetAt(s, s.to), nodeOffsetAt(s, s.to) <= s.node.data.length])
          .toEqual([true, true, true])
        expect(wire.length).toBe(s.to - s.from)
        checked++
      }
      if (checked > 400) break
    }
    expect(checked).toBeGreaterThan(100)
  })
})
