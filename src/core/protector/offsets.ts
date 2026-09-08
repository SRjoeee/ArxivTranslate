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
      /** True for `</t>`, whose boundary is *after* the element rather than before it */
      closing?: boolean
    }

/** Wire offset to offset within the node. Anchors are 1:1 in between, so take the last one at or before it. */
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
  return Math.min(node + (clamped - wire), span.node.data.length)
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

/**
 * Wire interval `[from, to)` as a `Range`.
 *
 * A boundary inside a placeholder resolves to that node's own boundary, so a sentence that opens or
 * closes on a formula still contains it. Resolving such a boundary to the neighbouring text span
 * instead would drop the formula, and an interval covering only a placeholder would collapse
 * (Codex pointed this out on #123).
 *
 * Returns undefined only when there is nothing to select: no spans, an empty interval, or an
 * interval past the end of the wire text.
 */
export function rangeOf(spans: readonly WireSpan[], from: number, to: number): Range | undefined {
  if (spans.length === 0 || to <= from) return undefined
  const start = spanAt(spans, from)
  const end = spanAt(spans, to - 1)
  if (!start || !end) return undefined
  // The range must come from the nodes' own document; building it from another one silently
  // yields an empty toString().
  const range = (start.node.ownerDocument ?? end.node.ownerDocument)?.createRange()
  if (!range) return undefined
  if (start.kind === 'text') range.setStart(start.node, nodeOffsetAt(start, from))
  else if (start.closing) range.setStartAfter(start.node)
  else range.setStartBefore(start.node)
  if (end.kind === 'text') range.setEnd(end.node, nodeOffsetAt(end, to))
  else if (end.closing) range.setEndAfter(end.node)
  else range.setEndBefore(end.node)
  return range
}
