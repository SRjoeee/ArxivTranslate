import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { nodeOffsetAt, rehydrate, serialize, wireOffsetAt } from '@/core/protector'
import { SPLIT_CLASS } from '@/core/renderer/attrs'
import { registerSentences, sentenceAt, sentenceMapAt, sentenceMapOf } from '@/core/renderer/sentences'
import { splitFigures } from '@/core/renderer/split-figures'
import { docOf } from './helpers'
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

/** A split figure: the source caption, the hidden translation, the copy on screen */
function splitCaption() {
  const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
    + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
  const source = d.querySelector('figcaption')!
  const block = serialize(source, 'tags')
  const fragment = rehydrate(block.text, block, d)
  const target = d.createElement('figcaption')
  target.className = 'axt-t'
  target.setAttribute('data-axt-for', 'F1.cap')
  target.append(fragment)
  source.after(target)
  const lengths = splitSentences(block.text)
  registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
  splitFigures(d)
  const copy = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
  Object.assign(target, { checkVisibility: () => false })
  Object.assign(copy, { checkVisibility: () => true })
  return { d, source, target, copy }
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

  it('after a side-mode split the highlight follows the copy on screen (#139)', () => {
    // `splitFigures` clones the whole figure with its caption into the right column, **the reader sees the clone**, and the original's translation is hidden.
    // Registering the original alone, hovering the caption gives an empty rectangle on the translation side — the owner's report on 2609.04987v1, 2026-09-10
    // The split scans inside the translation root only, so the page needs `article.ltx_document`
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    // The two marks `renderText` sets: the split finds translations by `.axt-t`, and without it this figure is not split at all
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })

    expect(splitFigures(d)).toBe(1)
    const clone = d.querySelector(`.${SPLIT_CLASS}`)!
    const copy = clone.querySelector('figcaption')!
    expect(copy.textContent).toBe(target.textContent)

    // Hovering the caption inside the clone: resolves to the same block, and it is recognised as the translation side
    const inCopy = sentenceMapAt(copy.firstChild!)
    expect(inCopy?.side).toBe('target')
    expect(inCopy?.map.pairs.length).toBe(lengths.length)
    // Hovering the source, the translation side points at the **clone** — the original copy has no box in side mode
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)
    // The span was swapped for the node in the clone, not the original's
    const nodes = new Set(sentenceMapOf(copy)!.target.spans.map(s => s.node))
    expect([...nodes].every(n => copy.contains(n))).toBe(true)
    expect([...nodes].some(n => target.contains(n))).toBe(false)
  })

  it('switching back to stack hides the copy, and the highlight falls back to the original (#139)', () => {
    // **A mode switch does not delete the copy**, it only hides one side with CSS (stack hides the copy, only hides the original).
    // So the criterion is “who is on screen”, not “who is still in the document” — the latter holds for both, and the highlight would be drawn on the invisible one
    // The split scans inside the translation root only, so the page needs `article.ltx_document`
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    // The two marks `renderText` sets: the split finds translations by `.axt-t`, and without it this figure is not split at all
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    splitFigures(d)
    const copy = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    // side: both on screen, take the copy (the right column's is exactly it)
    for (const el of [target, copy]) Object.assign(el, { checkVisibility: () => true })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)

    // stack: the copy is hidden by CSS but **still in the document** — falls back to the original
    Object.assign(copy, { checkVisibility: () => false })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(target)
  })

  it('a table registered by cells inside a split figure is mirrored too (#148)', () => {
    // A table's sentences are registered by **cell** (`renderTable` reports “source cell → clone cell”), and the cells sit inside the `.axt-t` table.
    // Mirroring `.axt-t` alone, those cells of a table inside a figure stay unregistered in the clone (Codex on #148)
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1.</figcaption>'
      + '<div class="axt-t" data-axt-for="F1.cap"><table><tbody><tr>'
      + '<td class="ltx_td" id="F1.c1">One. Two.</td></tr></tbody></table></div></figure>')
    // The “cell” layer: one cell each for source and translation, registered by cell, exactly as renderTable does
    const cell = d.getElementById('F1.c1')!
    const block = serialize(cell, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('td')
    target.append(fragment)
    cell.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(cell, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })

    expect(splitFigures(d)).toBe(1)
    const copy = d.querySelector(`.${SPLIT_CLASS}`)!.querySelectorAll('td')[1]!
    for (const el of [target, copy]) Object.assign(el, { checkVisibility: () => true })
    // Hovering that cell inside the clone: resolves to the same block
    expect(sentenceMapAt(copy.firstChild!)?.side).toBe('target')
    // Hovering the source cell: the translation side points at the cell in the clone
    expect(sentenceMapAt(cell.firstChild!)?.map.target.root).toBe(copy)
  })

  it('after a retranslation, a copy still hanging around uses this version\'s sentence boundaries (#148)', () => {
    // With the translation text unchanged `translationKey` does not change and the copy is not rebuilt — it still records the previous round's sentence boundaries,
    // and in side mode it is exactly what is on screen. With the same text the spans still match, so swapping the boundaries is enough (Codex on #148)
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    splitFigures(d)
    const copy = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    // The side-mode picture: the original's translation is hidden, the copy is on screen
    Object.assign(target, { checkVisibility: () => false })
    Object.assign(copy, { checkVisibility: () => true })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)
    expect(sentenceMapAt(source.firstChild!)?.map.pairs).toHaveLength(lengths.length)

    // The same text retranslated, this time one sentence only
    const one = [block.text.length]
    registerSentences(source, target, block.offsets, fragment.offsets, { source: one, target: one })
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(copy)
    expect(sentenceMapAt(source.firstChild!)?.map.pairs).toHaveLength(1)

    // This round has no alignment at all: the copy's record cannot be used either
    registerSentences(source, target, block.offsets, fragment.offsets, undefined)
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('when this round has no alignment the copy\'s own record is voided too (#148)', () => {
    // Deleting the “source → translation” index alone is not enough: the copy is a key of the record table itself, and a pointer landing on the copy still finds it
    const { source, target, copy } = splitCaption()
    expect(sentenceMapAt(copy.firstChild!)).toBeDefined()

    const block = serialize(source, 'tags')
    registerSentences(source, target, block.offsets, undefined, undefined)
    expect(sentenceMapAt(copy.firstChild!)).toBeUndefined()
    expect(sentenceMapAt(source.firstChild!)).toBeUndefined()
  })

  it('going from “no alignment” to “alignment” rebuilds and mirrors the copy that stayed (#148)', () => {
    // The split decides on rebuilding by the translation text's signature. With the text unchanged and the registration going from none to some, a copy left as it is would never be
    // mirrored — hovering the source lands on the hidden original, hovering the copy finds nothing
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1: One. Two.</figcaption></figure>')
    const source = d.querySelector('figcaption')!
    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('figcaption')
    target.className = 'axt-t'
    target.setAttribute('data-axt-for', 'F1.cap')
    target.append(fragment)
    source.after(target)

    // Round one: no alignment (Google / LLM blocks are like this)
    registerSentences(source, target, block.offsets, fragment.offsets, undefined)
    expect(splitFigures(d)).toBe(1)
    const first = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    expect(sentenceMapAt(first.firstChild!)).toBeUndefined()

    // Round two: the same text, this time with alignment — the copy must be rebuilt and registered
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    expect(splitFigures(d)).toBe(1)
    const rebuilt = d.querySelector(`.${SPLIT_CLASS} figcaption`)!
    Object.assign(target, { checkVisibility: () => false })
    Object.assign(rebuilt, { checkVisibility: () => true })
    expect(sentenceMapAt(rebuilt.firstChild!)?.side).toBe('target')
    expect(sentenceMapAt(source.firstChild!)?.map.target.root).toBe(rebuilt)
  })

  it('when a table goes from “no alignment” to “alignment” the signature has to enter the cells, or the copy is not rebuilt (#148)', () => {
    // Tables are the only translations whose sentences are registered on **descendants**: `renderTable` reports “source cell → clone cell” per cell,
    // and the `.axt-t` table itself was never registered. A signature that asks the table alone is always empty, this text-preserving transition is invisible,
    // the copy stays as it is and not one cell is mirrored (Codex on #148).
    // The structure follows `renderTable`: the whole `.ltx_tabular` cloned once with .axt-t, the cells inside the clone
    const d = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="F1.cap">Figure 1.</figcaption>'
      + '<figcaption class="ltx_caption axt-t" data-axt-for="F1.cap">图 1。</figcaption>'
      + '<table class="ltx_tabular" id="F1.tab" data-axt-id="F1.tab"><tbody><tr>'
      + '<td class="ltx_td">One. Two.</td></tr></tbody></table></figure>')
    const table = d.getElementById('F1.tab')!
    const cell = table.querySelector('td')!
    const clone = table.cloneNode(true) as Element
    clone.removeAttribute('id')
    clone.removeAttribute('data-axt-id')
    clone.classList.add('axt-t')
    clone.setAttribute('data-axt-for', 'F1.tab')
    table.after(clone)
    const target = clone.querySelector('td')!
    const block = serialize(cell, 'tags')
    const fragment = rehydrate(block.text, block, d)
    target.textContent = ''
    target.append(fragment)

    // Round one: no alignment
    registerSentences(cell, target, block.offsets, fragment.offsets, undefined)
    expect(splitFigures(d)).toBe(1)
    const first = d.querySelector(`.${SPLIT_CLASS} td`)!
    expect(sentenceMapAt(first.firstChild!)).toBeUndefined()

    // Round two: the same text, this time with alignment — the copy must be rebuilt, the cells registered in the copy
    const lengths = splitSentences(block.text)
    registerSentences(cell, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })
    expect(splitFigures(d)).toBe(1)
    const rebuilt = d.querySelector(`.${SPLIT_CLASS} td`)!
    expect(rebuilt).not.toBe(first)
    Object.assign(target, { checkVisibility: () => false })
    Object.assign(rebuilt, { checkVisibility: () => true })
    expect(sentenceMapAt(rebuilt.firstChild!)?.side).toBe('target')
    expect(sentenceMapAt(cell.firstChild!)?.map.target.root).toBe(rebuilt)
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

  it('finds the block from a text node however deep the formula is', () => {
    // The walk used to stop after twelve levels. Text nodes in the fixtures go to sixteen — a
    // `msqrt/msub/mi` in 2401.00596 — and twelve reaches only 99.824% of the 86409 of them. Deep
    // MathML nests without limit, so the walk goes to the root (Codex on #130).
    const d = doc()
    d.body.innerHTML = '<p class="ltx_p">One. Two.</p>'
    const source = d.body.firstElementChild!
    let deepest: Element = source
    for (let i = 0; i < 20; i++) {
      const wrap = d.createElement('span')
      deepest.append(wrap)
      deepest = wrap
    }
    const leaf = d.createTextNode('x')
    deepest.append(leaf)

    const block = serialize(source, 'tags')
    const fragment = rehydrate(block.text, block, d)
    const target = d.createElement('p')
    target.append(fragment)
    source.after(target)
    const lengths = splitSentences(block.text)
    registerSentences(source, target, block.offsets, fragment.offsets, { source: lengths, target: lengths })

    expect(sentenceMapAt(leaf)?.side).toBe('source')
  })

  // The leak this registry was restructured to avoid — an entry keyed by the original element,
  // which `restore()` leaves in the document, holding the whole detached translation — cannot be
  // tested here. happy-dom never releases a detached node: a control run with `--expose-gc` showed
  // a plain object collected and a detached `<p>` that nothing referenced still alive after five
  // collections, so a WeakRef assertion fails whichever way the registry is written and proves
  // nothing. `tests/e2e/extension.mjs` checks it in a real browser instead, where restoring a
  // translated page must let its translation nodes go.

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
