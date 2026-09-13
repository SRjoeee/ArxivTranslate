// Serialisation (DESIGN §6.2): a block → text with placeholders + the slot table. Read only, the DOM untouched.
// The void / paired decision reuses the rules module entirely: an element classify() puts in any category (skip /
// protect / unit / table) is a void — which covers nested units (footnote containers, a .ltx_p inside a paragraph) as
// well; an unmatched element with text is paired, an unmatched one without text is a void too. The one exception is a
// table cell (§5.3): the extractor does not descend into tables, so a .ltx_p or a heading inside a cell is no block of
// its own, and serialisation walks into it as an ordinary paired element — otherwise the whole cell would be one
// placeholder and its text lost (measured on Table 1 of 2410.00260; Codex on #5).
import { isInjected } from '@/core/marks'
import { FUNCTIONAL_INLINE, classify, isTableCell } from '@/core/rules/latexml'
import type { WireSpan } from './offsets'
import { type WireFormat, writeVoid } from './tokens'

export interface ProtectedBlock {
  /** Which wire format this block was serialised in; validate / rehydrate / splitRuns tokenise by it */
  format: WireFormat
  /** The text with placeholders; text nodes escaped by format (tags escape & < >, markers escape the @ that would be ambiguous) */
  text: string
  /** id → original node: the whole node for a void, the element itself for a paired one (shallow-cloned when filled back) */
  slots: Map<number, Node>
  paired: Set<number>
  /** A block beyond VOID_DENSE_THRESHOLD counts as formula-dense; the pipeline batches it on its own */
  voidCount: number
  /**
   * Wire offset to DOM position, one span per run of the text (§6.2, issue #105). Always produced:
   * measured on the heaviest fixture the bookkeeping is not distinguishable from noise (676 blocks,
   * 15.69 ms plain vs 15.71 ms tracked at min of four runs, with the tracked side faster in two of
   * them), and an optional field that production never leaves empty only buys downstream a
   * defensive branch that can never be exercised.
   */
  offsets: WireSpan[]
  /**
   * The element this block was serialised from. Untouched by translation (§7.1), so the rehydrate
   * side can read what the wire text no longer says — which formatting element the block opened
   * with, under a format that flattened it (`label.ts`, issue #150). The block lives with its
   * segment in the content script and is never sent across the message boundary, like `slots`.
   */
  root: Element
}

export const VOID_DENSE_THRESHOLD = 40

const ELEMENT_NODE = 1
const TEXT_NODE = 3

const hasText = (el: Element) => /\S/.test(el.textContent ?? '')

/**
 * Writes the wire text character by character, escaping and collapsing whitespace as it goes, and
 * records where each wire offset lands in the DOM.
 *
 * This used to be an opt-in second path beside a plain "escape the string, collapse once at the
 * end" one. It is now the only path: on the heaviest fixture the bookkeeping is not distinguishable
 * from noise (676 blocks, 15.69 ms plain vs 15.71 ms tracked at min of four runs, tracked faster in
 * two of them), and two paths that must emit byte-identical wire text are two paths that can drift.
 */
function makeTracker(format: WireFormat, parts: string[], spans: WireSpan[]) {
  let len = 0
  let afterSpace = false
  return {
    /**
     * A placeholder run. It holds no collapsible whitespace and neither starts nor ends with any,
     * so it goes out verbatim. Recording it as a span matters for ranges: a boundary landing inside
     * a placeholder has to resolve to that node's own boundary, otherwise a sentence opening or
     * closing on a formula would drop it (Codex pointed this out on #123).
     */
    raw(s: string, node: Node, role: 'void' | 'open' | 'close') {
      parts.push(s)
      spans.push({ kind: 'slot', node, from: len, to: len + s.length, role })
      len += s.length
      afterSpace = false
    },
    text(node: Text) {
      const data = node.data
      const from = len
      const anchors: [number, number][] = [[len, 0]]
      let out = ''
      // Runs of whitespace collapse to a single space, and it has to happen here rather than on
      // the string the pipeline sends: the runs path sends segments cut out of this very string
      // by `splitRuns`, so normalising `segment.text` alone would never reach them (#119).
      //
      // Why it has to happen at all: LaTeXML's HTML carries hard line breaks — 2373 of the 3847
      // body blocks across the 12 fixtures (62%) have them, 7383 in total — and Microsoft reads
      // every break as a full stop. One paragraph with breaks turned `state explosion` into a
      // province-level explosion across 5 sentences; collapsed, it is `状态爆炸` across 2. Over
      // 60 measured segments false sentence boundaries fell from 128/266 to 5/140. HTML collapses
      // this whitespace when rendering anyway, so the DOM loses no meaning.
      //
      // Safe for placeholders: `<x id="N"/>` and `<t id="N">` hold only single spaces and
      // `@abc#` holds none, so collapsing cannot touch them. `normalizeText` does the same thing
      // on the cache-key side, so keys are unchanged and old entries keep hitting —
      // `CACHE_KEY_VERSION` does not move.
      //
      // Skipped blocks (`<pre>`, code) never reach here: the rules module classifies them void
      // and the whole node goes into a slot untouched.
      //
      // **Not `\s`**: JavaScript's `\s` includes U+00A0, and `&nbsp;` is meaningful typography in
      // LaTeXML output (`Section&nbsp;1.1`, `no.&nbsp;1`, `W.&nbsp;Arendt` all rely on it to
      // forbid a break), which HTML itself does not collapse either. Only the five characters the
      // HTML spec collapses.
      //
      // **And no trim**: whitespace at a block's edges renders meaningfully between inline blocks
      // — `<span>A</span><span>B</span>` is `AB` while `<span>A </span>` is `A B`. Author names
      // and contact labels are exactly such adjacent inline blocks (§5.2), and trimming glues
      // their translations together. The bug to fix is hard breaks *inside* a block; collapsing
      // is enough for that, and trimming was never part of it.
      for (let i = 0; i < data.length; i++) {
        const c = data[i]!
        let emitted: string
        if (c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r') {
          emitted = afterSpace ? '' : ' '
          afterSpace = true
        } else {
          emitted = c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : format === 'markers' && c === '@' ? '@@' : c
          afterSpace = false
        }
        out += emitted
        // One input character did not produce exactly one output character, so the 1:1 run
        // restarts here and needs an anchor.
        if (emitted.length !== 1) anchors.push([len + out.length, i + 1])
      }
      if (out.length === 0) return
      parts.push(out)
      len += out.length
      spans.push({ kind: 'text', node, from, to: len, anchors })
    },
  }
}

export function serialize(root: Element, format: WireFormat = 'tags'): ProtectedBlock {
  const slots = new Map<number, Node>()
  const paired = new Set<number>()
  const parts: string[] = []
  const spans: WireSpan[] = []
  const tracker = makeTracker(format, parts, spans)
  let voidCount = 0
  let next = 1
  const inCell = isTableCell(root)

  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        tracker.text(child as Text)
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element
        // The translations / mirrors we inserted are not original text: on a retranslation they are already inside the block (Codex on #8)
        if (isInjected(el)) continue
        const c = classify(el)
        const isVoid = c ? !(inCell && c.kind === 'unit' && hasText(el)) : !hasText(el)
        // markers have no paired markers (Google measured at only 70.6%, see tokens.ts): except for “elements with
        // behaviour”, kept whole as voids so they stay clickable (the same decision issue #44 made on the runs path),
        // every paired element is flattened to plain text — inline styling is lost, content is not
        const flatten = format === 'markers' && !isVoid && !el.matches(FUNCTIONAL_INLINE)
        if (flatten) {
          walk(el)
          continue
        }
        const id = next++
        slots.set(id, el)
        if (isVoid || format === 'markers') {
          voidCount++
          tracker.raw(writeVoid(id, format), el, 'void')
        } else {
          paired.add(id)
          tracker.raw(`<t id="${id}">`, el, 'open')
          walk(el)
          tracker.raw('</t>', el, 'close')
        }
      }
      // Comments and other node kinds are ignored
    }
  }
  walk(root)
  // The tracker collapses whitespace as it writes, so the joined parts are already collapsed.
  return { format, text: parts.join(''), slots, paired, voidCount, offsets: spans, root }
}
