import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { extract } from '@/core/extractor'
import { nodeOffsetAt, rangesOf, serialize, spanAt, type WireSpan } from '@/core/protector'
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

/**
 * Records which boundary calls `rangeOf` makes, so the decision can be asserted without relying on
 * happy-dom's Range. Stubs `createRange` on the nodes' own document, which is where `rangeOf` gets
 * it from.
 */
function boundaryCalls(root: Element, spans: readonly WireSpan[], from: number, to: number): string[] {
  const calls: string[] = []
  const name = (n: Node) => (n.nodeType === 3 ? `text(${JSON.stringify((n as Text).data.slice(0, 6))})` : (n as Element).tagName.toLowerCase())
  const recorder = {
    setStart: (n: Node, o: number) => calls.push(`start@${name(n)}:${o}`),
    setEnd: (n: Node, o: number) => calls.push(`end@${name(n)}:${o}`),
    setStartBefore: (n: Node) => calls.push(`startBefore:${name(n)}`),
    setStartAfter: (n: Node) => calls.push(`startAfter:${name(n)}`),
    setEndBefore: (n: Node) => calls.push(`endBefore:${name(n)}`),
    setEndAfter: (n: Node) => calls.push(`endAfter:${name(n)}`),
  }
  const doc = root.ownerDocument
  const spy = vi.spyOn(doc, 'createRange').mockReturnValue(recorder as unknown as Range)
  rangesOf(spans, from, to)
  spy.mockRestore()
  return calls
}


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

  it('labels each placeholder run with what it stands for', () => {
    // A void run stands for the whole node, so an interval ending on it ends after the node; the
    // two halves of a pair bracket the element's content instead. Getting this wrong collapsed
    // formula-only intervals and dropped trailing formulas (Codex on #123).
    const paired = serialize(el('<p class="ltx_p">a <em>b</em> c</p>'), 'tags', { offsets: true })
    expect(paired.offsets!.filter(s => s.kind === 'slot').map(s => (s.kind === 'slot' ? s.role : null))).toEqual(['open', 'close'])
    const voids = serialize(el('<p class="ltx_p">a <math><mi>x</mi></math> b</p>'), 'tags', { offsets: true })
    expect(voids.offsets!.filter(s => s.kind === 'slot').map(s => (s.kind === 'slot' ? s.role : null))).toEqual(['void'])
  })

  it('keeps the node offset monotone through an expanded escape', () => {
    // `&` is one node character but five wire characters. Interpolating through them walked the
    // node offset past the end of the escape, so a boundary at wire 4 mapped further into the node
    // than one at wire 5 — which collapsed the range and dropped what followed (Codex on #123).
    const block = serialize(el('<p class="ltx_p">&amp;Z</p>'), 'tags', { offsets: true })
    expect(block.text).toBe('&amp;Z')
    const span = block.offsets![0]!
    expect(span.kind).toBe('text')
    if (span.kind !== 'text') return
    const mapped = [0, 1, 2, 3, 4, 5, 6].map(w => nodeOffsetAt(span, w))
    expect(mapped).toEqual([...mapped].sort((a, b) => a - b))
    // Everything inside the escape snaps to just after the character it encodes
    expect(mapped).toEqual([0, 1, 1, 1, 1, 1, 2])
    expect(textOf(block.offsets!, 4, 6)).toBe('Z')
  })

  it('an interval covering only a placeholder brackets that node instead of collapsing', () => {
    // Ending *before* a void run puts both boundaries in the same place, so the formula-only
    // interval selects nothing and a trailing formula falls outside (Codex on #123).
    const root = el('<p class="ltx_p"><math><mi>x</mi></math></p>')
    const block = serialize(root, 'tags', { offsets: true })
    expect(textSpans(block.offsets!)).toEqual([])
    expect(boundaryCalls(root, block.offsets!, 0, block.text.length)).toEqual(['startBefore:math', 'endAfter:math'])
  })

  it('ends after a trailing formula, and before the content of a paired element', () => {
    const withFormula = el('<p class="ltx_p">value is <math><mi>x</mi></math></p>')
    const a = serialize(withFormula, 'tags', { offsets: true })
    expect(boundaryCalls(withFormula, a.offsets!, 0, a.text.length).at(-1)).toBe('endAfter:math')

    // The open half of a pair is the opposite: an interval ending there stops before the content
    const paired = el('<p class="ltx_p">a <em>b</em> c</p>')
    const b = serialize(paired, 'tags', { offsets: true })
    const openEnd = b.offsets!.find(s => s.kind === 'slot' && s.role === 'open')!
    expect(boundaryCalls(paired, b.offsets!, 0, openEnd.to).at(-1)).toBe('endBefore:em')
  })

  it('starts after the element when the boundary lands in a closing tag', () => {
    // A sentence beginning exactly where a paired element ends: `<em>Foo.</em>Bar.`
    const root = el('<p class="ltx_p"><em>Foo.</em>Bar.</p>')
    const block = serialize(root, 'tags', { offsets: true })
    const close = block.offsets!.find(s => s.kind === 'slot' && s.role === 'close')!
    expect(boundaryCalls(root, block.offsets!, close.from, block.text.length)[0]).toBe('startAfter:em')
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

  it('cuts the interval where an injected node was skipped, instead of spanning it', () => {
    // An inner block that finished translating first leaves its translation in the DOM between two
    // runs that are adjacent in wire coordinates. One range across that gap would highlight the
    // inner translation as if it were source text (Codex on #123).
    const root = el('<p class="ltx_p">before <span class="axt-t" data-axt-for="x">translated</span> after</p>')
    const block = serialize(root, 'tags', { offsets: true })
    expect(block.text).toBe('before after')
    expect(block.offsets!.map(s => Boolean(s.breakBefore))).toEqual([false, true])
    // Two ranges, so the injected sibling between them is not covered
    expect(boundaryCalls(root, block.offsets!, 0, block.text.length)).toEqual([
      'start@text("before"):0',
      'end@text("before"):7',
      'start@text(" after"):1',
      'end@text(" after"):6',
    ])
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
