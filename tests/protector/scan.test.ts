import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { decodeText, nodeOffsetAt, rehydrate, scanTokens, serialize, tokenize, wireOffsetAt, type PositionedToken } from '@/core/protector'
import { el } from './helpers'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')

const asTokens = (positioned: PositionedToken[]) =>
  positioned.map(t => (t.kind === 'text' ? { kind: t.kind, text: t.text } : t.kind === 'close' ? { kind: t.kind } : { kind: t.kind, id: t.id }))

/**
 * What `rehydrate` builds: `tokenize` leaves entities alone and `decodeText` resolves them a step
 * later. The scan does both at once so its anchors can describe the whole wire-to-node change, so
 * this is the sequence it has to match.
 */
const asRehydrated = (wire: string, fmt: 'tags' | 'markers') =>
  tokenize(wire, fmt).map(t => (t.kind === 'text' ? { kind: t.kind, text: decodeText(t.text) } : t))

describe('positioned token scan (#105)', () => {
  it('agrees with tokenize across every fixture in both formats', () => {
    // The scan mirrors tokenize rather than changing it, because tokenize is the protector's
    // hottest path and its markers branch has already turned `@@` back into `@`. Mirroring only
    // works while the two agree, so this is the guard that says they do.
    let blocks = 0
    for (const f of readdirSync(FIXTURE_DIR).filter(n => n.endsWith('.html'))) {
      const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      for (const b of extract(d)) {
        if (b.kind !== 'text') continue
        for (const fmt of ['tags', 'markers'] as const) {
          const wire = serialize(b.el, fmt).text
          expect([f, b.id, fmt, asTokens(scanTokens(wire, fmt))]).toEqual([f, b.id, fmt, asRehydrated(wire, fmt)])
          blocks++
        }
      }
    }
    expect(blocks).toBeGreaterThan(2000)
  })

  it('tiles the wire text: every token interval is contiguous and covers it', () => {
    for (const [wire, fmt] of [
      ['a <x id="1"/> b <t id="2">c</t> d', 'tags'],
      ['a @b# c @@d @e# f', 'markers'],
    ] as const) {
      let at = 0
      for (const t of scanTokens(wire, fmt)) {
        expect([t.kind, t.from]).toEqual([t.kind, at])
        at = t.to
      }
      expect(at).toBe(wire.length)
    }
  })

  it('anchors an entity and an escaped @, which change length on the way out', () => {
    const tags = scanTokens('A &amp; B', 'tags')[0]!
    expect(tags.kind).toBe('text')
    if (tags.kind !== 'text') return
    expect(tags.text).toBe('A & B')
    // 5 wire characters became 1, so the run cannot be interpolated straight through
    expect(tags.anchors.length).toBeGreaterThan(1)

    const markers = scanTokens('mail a@@b.com', 'markers')[0]!
    expect(markers.kind).toBe('text')
    if (markers.kind !== 'text') return
    expect(markers.text).toBe('mail a@b.com')
    expect(markers.anchors.length).toBeGreaterThan(1)
  })
})

describe('rehydrate offsets (#105)', () => {
  const doc = () => new DOMParser().parseFromString('<!doctype html><html><body><div></div></body></html>', 'text/html')

  it('tiles the translated wire text', () => {
    const d = doc()
    const block = serialize(el('<p class="ltx_p">a <math><mi>x</mi></math> b <em>c</em> d</p>'), 'tags')
    const frag = rehydrate(block.text, block, d)
    let at = 0
    for (const span of frag.offsets) {
      expect([span.kind, span.from]).toEqual([span.kind, at])
      at = span.to
    }
    expect(at).toBe(block.text.length)
  })

  it('wireOffsetAt lands at the end of the escape a caret sits after', () => {
    // A caret at node offset k sits *after* character k-1, so everything encoding characters
    // 0..k-1 is behind it — including the whole five characters of an `&amp;`. The wire offset for
    // it is therefore the *last* one nodeOffsetAt sends back to k, not the first: with `A & B`,
    // node 2 is before the ampersand (wire 2) and node 3 is after it (wire 7, not wire 3). Only
    // asserting the round trip cannot tell those apart — both choices survive it — so the property
    // checked here is maximality, which is what a sentence boundary sitting between wire 3 and
    // wire 7 would actually depend on.
    const d = doc()
    for (const [markup, fmt] of [
      ['<p class="ltx_p">A &amp; B ends here</p>', 'tags'],
      ['<p class="ltx_p">mail a@b.com then more</p>', 'markers'],
      ['<p class="ltx_p">&lt;tag&gt; &amp;&amp; more &#38; done</p>', 'tags'],
      ['<p class="ltx_p">plain text with no escapes</p>', 'tags'],
    ] as const) {
      const block = serialize(el(markup), fmt)
      const frag = rehydrate(block.text, block, d)
      const spans = frag.offsets
      for (const span of spans) {
        if (span.kind !== 'text') continue
        // Every wire offset in the span, grouped by the node offset it resolves to
        const last = new Map<number, number>()
        for (let w = span.from; w <= span.to; w++) last.set(nodeOffsetAt(span, w), w)
        for (let k = 0; k <= span.node.data.length; k++) {
          expect([markup, k, wireOffsetAt(spans, span.node, k)]).toEqual([markup, k, last.get(k)])
        }
      }
    }
  })
})
