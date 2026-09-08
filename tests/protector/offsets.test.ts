import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { nodeOffsetAt, serialize, spanAt, type WireSpan } from '@/core/protector'
import { el } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

/**
 * Do not assert on `Range` here. happy-dom returns an empty string from `Range.toString()` for any
 * range, and a range built with setStart(node, 4) then setEnd(node, 10) reports startOffset 10 —
 * the same class of hazard as its CSS.supports being unconditionally true. These tests cover the
 * offset arithmetic and the span resolution, which are pure data; `Range` behaviour is verified in
 * the browser by `pnpm e2e`, which is where the highlight lives anyway.
 *
 * `textOf` slices the node data directly, which is what `rangeOf(...).toString()` should produce in
 * a real browser for an interval that stays within text spans.
 */
function textOf(spans: readonly WireSpan[], from: number, to: number): string {
  let out = ''
  for (const span of spans) {
    if (span.to <= from || span.from >= to || span.kind !== 'text') continue
    const start = nodeOffsetAt(span, Math.max(span.from, from))
    const end = nodeOffsetAt(span, Math.min(span.to, to))
    out += span.node.data.slice(start, end)
  }
  return out
}

const textSpans = (spans: readonly WireSpan[]) => spans.filter(s => s.kind === 'text')

describe('wire offsets to DOM (#105)', () => {
  it('emits byte-identical wire text on both paths across every fixture and format', () => {
    // The two paths are deliberately separate: the default one escapes the whole string at once and
    // collapses once, touching not one extra character; only the tracked one walks per character so
    // it can record anchors. This is the single guard against them drifting apart.
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

  it('tiles the whole wire text with no gap and no overlap', () => {
    // Placeholders are spans too. Leaving gaps for them is what dropped formulas at range
    // boundaries before (Codex on #123), so full coverage is the invariant that prevents it.
    const block = serialize(el('<p class="ltx_p">one <math><mi>x</mi></math> two <em>three</em> four</p>'), 'tags', { offsets: true })
    const spans = block.offsets!
    let at = 0
    for (const span of spans) {
      expect([span.from, span.to > span.from]).toEqual([at, true])
      at = span.to
    }
    expect(at).toBe(block.text.length)
  })

  it('resolves a boundary inside a placeholder to that node, not to the neighbouring text', () => {
    // `<math>x</math> is positive` — the interval starts inside the placeholder. Resolving it to the
    // following text span would highlight " is positive" and drop the formula.
    const block = serialize(el('<p class="ltx_p"><math><mi>x</mi></math> is positive</p>'), 'tags', { offsets: true })
    const first = spanAt(block.offsets!, 0)
    expect([first?.kind, first && (first.node as Element).tagName.toLowerCase()]).toEqual(['slot', 'math'])

    const trailing = serialize(el('<p class="ltx_p">positive is <math><mi>x</mi></math></p>'), 'tags', { offsets: true })
    const last = spanAt(trailing.offsets!, trailing.text.length - 1)
    expect([last?.kind, last && (last.node as Element).tagName.toLowerCase()]).toEqual(['slot', 'math'])
  })

  it('marks the closing half of a paired placeholder so its boundary lands after the element', () => {
    const block = serialize(el('<p class="ltx_p">a <em>b</em> c</p>'), 'tags', { offsets: true })
    const slots = block.offsets!.filter(s => s.kind === 'slot')
    expect(slots.map(s => (s.kind === 'slot' ? Boolean(s.closing) : null))).toEqual([false, true])
  })

  it('an interval covering only a placeholder still resolves to that placeholder', () => {
    const block = serialize(el('<p class="ltx_p"><math><mi>x</mi></math></p>'), 'tags', { offsets: true })
    expect(textSpans(block.offsets!)).toEqual([])
    expect(spanAt(block.offsets!, 0)?.kind).toBe('slot')
  })

  it('keeps offsets aligned past an entity, where one character becomes five', () => {
    const block = serialize(el('<p class="ltx_p">A &amp; B ends here</p>'), 'tags', { offsets: true })
    expect(block.text).toBe('A &amp; B ends here')
    const at = block.text.indexOf('B ends')
    expect(textOf(block.offsets!, at, at + 6)).toBe('B ends')
  })

  it('keeps offsets aligned past a doubled @, which markers uses for a literal one', () => {
    const block = serialize(el('<p class="ltx_p">mail a@b.com then more text</p>'), 'markers', { offsets: true })
    expect(block.text).toBe('mail a@@b.com then more text')
    const at = block.text.indexOf('then more')
    expect(textOf(block.offsets!, at, at + 9)).toBe('then more')
  })

  it('keeps offsets aligned past collapsed whitespace (#119)', () => {
    const block = serialize(el('<p class="ltx_p">first line\n   second line\n\n  third line</p>'), 'tags', { offsets: true })
    expect(block.text).toBe('first line second line third line')
    const at = block.text.indexOf('third')
    expect(textOf(block.offsets!, at, at + 5)).toBe('third')
  })

  it('leaves NBSP alone, so it neither collapses nor shifts the offsets', () => {
    const block = serialize(el('<p class="ltx_p">see Section 1.1 and then some</p>'), 'tags', { offsets: true })
    expect(block.text).toContain(' ')
    const at = block.text.indexOf('and then')
    expect(textOf(block.offsets!, at, at + 8)).toBe('and then')
  })

  it('holds on real fixture blocks: every span is well formed and its wire length matches', () => {
    const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, '2609.04056.html'), 'utf8'), 'text/html')
    let checked = 0
    for (const b of extract(d)) {
      if (b.kind !== 'text') continue
      const block = serialize(b.el, 'tags', { offsets: true })
      for (const span of block.offsets!) {
        expect(block.text.slice(span.from, span.to).length).toBe(span.to - span.from)
        if (span.kind === 'text') {
          expect([nodeOffsetAt(span, span.from) <= nodeOffsetAt(span, span.to), nodeOffsetAt(span, span.to) <= span.node.data.length])
            .toEqual([true, true])
        }
        checked++
      }
      if (checked > 400) break
    }
    expect(checked).toBeGreaterThan(100)
  })
})
