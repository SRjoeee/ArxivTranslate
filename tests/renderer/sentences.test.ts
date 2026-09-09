import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { nodeOffsetAt, rehydrate, serialize, wireOffsetAt } from '@/core/protector'
import { registerSentences, sentenceAt, sentenceMapAt, sentenceMapOf } from '@/core/renderer'
import { splitSentences } from '@/core/sentences'
import { verifyAlignment } from '@/providers/alignment'

const FIXTURE_DIR = join(import.meta.dirname, '../fixtures/arxiv')
const doc = () => new DOMParser().parseFromString('<html><body></body></html>', 'text/html')

/** Puts a block on a page with its translation beside it, exactly as `renderText` does. */
function render(html: string, fmt: 'tags' | 'markers' = 'tags') {
  const d = doc()
  d.body.innerHTML = html
  const source = d.body.firstElementChild!
  const block = serialize(source, fmt)
  const fragment = rehydrate(block.text, block, d)
  const target = d.createElement(source.tagName)
  target.append(fragment)
  source.after(target)
  return { d, source, target, block, spans: fragment.offsets }
}

describe('sentence registry (#105)', () => {
  it('finds the block from a node on either side, and only when it was registered', () => {
    const { source, target, block, spans } = render('<p class="ltx_p">One. Two.</p>')
    const lengths = splitSentences(block.text)
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()

    registerSentences(source, target, block.offsets, spans, { source: lengths, target: lengths })
    expect(sentenceMapAt(source.firstChild!)?.side).toBe('source')
    expect(sentenceMapAt(target.firstChild!)?.side).toBe('target')
    expect(sentenceMapAt(source)?.map.pairs.length).toBe(lengths.length)
  })

  it('registers nothing without an alignment, so those blocks simply do not highlight', () => {
    // Every Google and LLM block today. A guessed pairing would light up the wrong sentence.
    const { source, target, block, spans } = render('<p class="ltx_p">One. Two.</p>')
    registerSentences(source, target, block.offsets, spans, undefined)
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('registers nothing when the translation side has no offsets', () => {
    // The runs fallback joins its own fragment and cannot report wire positions.
    const { source, target, block } = render('<p class="ltx_p">One. Two.</p>')
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, undefined, { source: lengths, target: lengths })
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('sentenceAt agrees with a linear scan at every offset', () => {
    const pairs = [0, 3, 3, 1, 12, 5].reduce<{ at: number; out: { index: number; source: { from: number; to: number }; target: { from: number; to: number } }[] }>(
      (acc, len) => {
        if (len > 0) {
          acc.out.push({ index: acc.out.length, source: { from: acc.at, to: acc.at + len }, target: { from: acc.at, to: acc.at + len } })
          acc.at += len
        }
        return acc
      },
      { at: 0, out: [] },
    ).out
    const total = pairs[pairs.length - 1]!.source.to
    for (let i = -2; i <= total + 2; i++) {
      const linear = pairs.find(p => i >= p.source.from && i < p.source.to)
      expect([i, sentenceAt(pairs, 'source', i)]).toEqual([i, linear])
    }
  })
})

describe('sentence lookup round trip (#105)', () => {
  /**
   * The property the hover highlight rests on: **the sentence found under the pointer must be the
   * one whose highlight covers the character the pointer is on.**
   *
   * `caretPositionFromPoint` hands the renderer a `(node, offset)`; `wireOffsetAt` turns that into
   * a wire offset, `sentenceAt` picks the sentence, and `rangesOf` builds that sentence's ranges
   * from `nodeOffsetAt`. So for every character of every text run, the sentence chosen for it has
   * to have boundaries that bracket it.
   *
   * Checked through `nodeOffsetAt` rather than by reading the ranges back, because happy-dom's
   * `Range` cannot be inspected — `toString()` is empty for every range and `startOffset` does not
   * return what was set. `tests/protector/offsets.test.ts` works around it by recording the
   * boundary calls; here the boundaries are what is being asserted, so they are compared directly.
   * The ranges themselves were verified in a real browser on #123 (656/656 intervals).
   *
   * Run over real fixture blocks in both wire formats, with a block's own text standing in for its
   * translation: that yields a genuine alignment (the same partition on both sides) with no engine,
   * and exercises exactly the path the renderer will.
   */
  it('the sentence found for a character has boundaries that cover it, across fixtures', () => {
    // Violations are collected rather than asserted per character: an `expect` per character means
    // over a million assertion objects, which costs seven times what the work itself does (906ms of
    // real work, measured). Reporting them together also shows how widespread a break is instead of
    // stopping at the first one.
    const violations: string[] = []
    let chars = 0
    let blocks = 0
    for (const f of readdirSync(FIXTURE_DIR).filter(n => n.endsWith('.html')).slice(0, 3)) {
      const d = new DOMParser().parseFromString(readFileSync(join(FIXTURE_DIR, f), 'utf8'), 'text/html')
      for (const b of extract(d)) {
        if (b.kind !== 'text') continue
        for (const fmt of ['tags', 'markers'] as const) {
          const block = serialize(b.el, fmt)
          const lengths = splitSentences(block.text, fmt)
          if (lengths.length < 2) continue
          const alignment = verifyAlignment({ source: lengths, target: lengths }, block.text, block.text)
          expect([f, b.id, fmt, alignment !== undefined]).toEqual([f, b.id, fmt, true])

          const frag = rehydrate(block.text, block, d)
          const target = d.createElement(b.el.tagName)
          target.append(frag)
          registerSentences(b.el, target, block.offsets, frag.offsets, alignment!)
          const map = sentenceMapOf(b.el)!
          blocks++

          for (const side of ['source', 'target'] as const) {
            const { spans, index } = map[side]
            for (const span of spans) {
              if (span.kind !== 'text') continue
              // Walked once, carrying the next boundary forward, rather than asking twice per
              // character: this runs over every character of every fixture block.
              let next = wireOffsetAt(index, span.node, 0)
              for (let k = 0; k < span.node.data.length; k++) {
                const wire = next
                next = wireOffsetAt(index, span.node, k + 1)
                // A character the tracker collapsed away occupies no wire position and so belongs
                // to no sentence — the run `"). \n"` goes out as `"). "`. It renders as nothing, so
                // no pointer can land on it, and which sentence owns it is not a question with an
                // answer.
                if (wire === next) continue
                const where = `${f} ${b.id} ${fmt} ${side} k=${k}`
                if (wire === undefined) {
                  violations.push(`${where}: no wire offset`)
                  continue
                }
                const sentence = sentenceAt(map.pairs, side, wire)
                if (!sentence) {
                  violations.push(`${where}: wire ${wire} is in no sentence`)
                  continue
                }
                const { from, to } = sentence[side]
                // `nodeOffsetAt` clamps to the span, which is what `rangesOf` relies on when a
                // sentence starts or ends outside this run
                if (!(nodeOffsetAt(span, from) <= k && k < nodeOffsetAt(span, to))) {
                  violations.push(`${where}: sentence ${sentence.index} covers [${nodeOffsetAt(span, from)},${nodeOffsetAt(span, to)}) in this run`)
                }
                chars++
              }
            }
          }
        }
      }
    }
    expect(violations.slice(0, 5)).toEqual([])
    expect([violations.length, blocks > 900, chars > 500_000]).toEqual([0, true, true])
  })
})
