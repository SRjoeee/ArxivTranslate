// Wire-text offsets mapped onto DOM ranges (companion to DESIGN §6.2).
//
// Sentence alignment is expressed in wire-text coordinates — Microsoft's `sentLen` is measured on
// the exact string we send (issue #105). Turning an interval of that string into a highlightable
// `Range` needs a mapping from wire offset to DOM position.
//
// Wire text and node content are not character-for-character: `escapeText` turns `&` into `&amp;`
// and, for markers, `@` into `@@`, and `serialize` collapses HTML whitespace on the way out (#119).
// Both transforms are per-character and context-free, so rather than storing a table per character
// a text span records an anchor only where one input character did not produce exactly one output
// character; between anchors the mapping is addition.

/** One run of wire text and where it came from. Text and slot spans together tile the whole string. */
export type WireSpan =
  | {
      kind: 'text'
      node: Text
      /** Interval `[from, to)` in the wire text */
      from: number
      to: number
      /**
       * Divergence points as `[wireOffset, nodeOffset]`. The mapping is strictly 1:1 between
       * consecutive anchors, so a lookup is a search plus an addition.
       */
      anchors: readonly (readonly [number, number])[]
      /** A node was skipped just before this run, so it is not DOM-adjacent to the previous one */
      breakBefore?: boolean
    }
  | {
      /**
       * A placeholder: `<x id="N"/>`, `@abc#`, or one of the `<t id="N">` / `</t>` pair.
       * Its wire run has no character-level correspondence to anything in the DOM, so a range
       * boundary landing inside it resolves to the node's own boundary rather than an offset.
       */
      kind: 'slot'
      node: Node
      from: number
      to: number
      /**
       * Which part of the node this run stands for. A `void` run stands for the whole node, so an
       * interval ending on it must end *after* the node; `open` and `close` are the two halves of a
       * `<t id="N">` pair and bracket the element's content instead.
       */
      role: 'void' | 'open' | 'close'
      /** A node was skipped just before this run, so it is not DOM-adjacent to the previous one */
      breakBefore?: boolean
    }

/**
 * Wire offset to offset within the node. Anchors are 1:1 in between, so take the last one at or
 * before the offset and add the difference.
 *
 * The result is clamped to the next anchor because an expanded escape is indivisible: `&` occupies
 * five wire characters but one node character, and interpolating through them walks the node
 * offset past where the escape ends. Without the clamp the mapping is not monotone — for `&Z`,
 * wire 4 gave node 2 while wire 5 gave node 1, which collapsed `rangeOf(4, 6)` and dropped the `Z`
 * (Codex pointed this out on #123). Clamping snaps any offset inside an escape to the position just
 * after the character it encodes.
 */
export function nodeOffsetAt(span: Extract<WireSpan, { kind: 'text' }>, wireOffset: number): number {
  const clamped = Math.max(span.from, Math.min(wireOffset, span.to))
  let lo = 0
  let hi = span.anchors.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (span.anchors[mid]![0] <= clamped) lo = mid
    else hi = mid - 1
  }
  const [wire, node] = span.anchors[lo]!
  const ceiling = span.anchors[lo + 1]?.[1] ?? span.node.data.length
  return Math.min(node + (clamped - wire), ceiling)
}

/** The span covering this wire offset. Spans tile the wire text, so this only misses past the end. */
export function spanAt(spans: readonly WireSpan[], wireOffset: number): WireSpan | undefined {
  let lo = 0
  let hi = spans.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const span = spans[mid]!
    if (wireOffset < span.from) hi = mid - 1
    else if (wireOffset >= span.to) lo = mid + 1
    else return span
  }
  return undefined
}

function oneRange(spans: readonly WireSpan[], from: number, to: number): Range | undefined {
  const start = spanAt(spans, from)
  const end = spanAt(spans, to - 1)
  if (!start || !end) return undefined
  // The range must come from the nodes' own document; building it from another one silently
  // yields an empty toString().
  const range = (start.node.ownerDocument ?? end.node.ownerDocument)?.createRange()
  if (!range) return undefined
  if (start.kind === 'text') range.setStart(start.node, nodeOffsetAt(start, from))
  else if (start.role === 'close') range.setStartAfter(start.node)
  else range.setStartBefore(start.node)
  // A void run stands for the whole node, so ending on it has to end *after* it — ending before
  // would collapse a formula-only interval and drop a trailing formula (Codex on #123). The `open`
  // half of a pair is the opposite: an interval ending there stops before the element's content.
  if (end.kind === 'text') range.setEnd(end.node, nodeOffsetAt(end, to))
  else if (end.role === 'open') range.setEndBefore(end.node)
  else range.setEndAfter(end.node)
  return range
}

/**
 * Wire interval `[from, to)` as ranges.
 *
 * **Usually one range, but not always.** `serialize` skips nodes we injected ourselves, so when an
 * inner block finished translating first its translation sits in the DOM between two runs that are
 * adjacent in wire coordinates. One range spanning that gap would contain the inner translation and
 * highlight it as if it were source text (Codex pointed this out on #123), so the interval is cut
 * at every such discontinuity. `Highlight` takes any number of ranges, so the caller just spreads
 * them.
 *
 * A boundary inside a placeholder resolves to that node's own boundary, so a sentence that opens or
 * closes on a formula still contains it.
 *
 * Returns an empty array when there is nothing to select: no spans, an empty interval, or an
 * interval past the end of the wire text.
 */
export function rangesOf(spans: readonly WireSpan[], from: number, to: number): Range[] {
  if (spans.length === 0 || to <= from) return []
  const out: Range[] = []
  let segmentStart = from
  for (const span of spans) {
    if (span.from <= from || span.from >= to || !span.breakBefore) continue
    const range = oneRange(spans, segmentStart, span.from)
    if (range) out.push(range)
    segmentStart = span.from
  }
  const last = oneRange(spans, segmentStart, to)
  if (last) out.push(last)
  return out
}
