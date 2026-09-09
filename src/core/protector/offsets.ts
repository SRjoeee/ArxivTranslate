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

import { INJECTED_SELECTOR, isInjected } from '@/core/marks'

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
      /**
       * Which part of the node this run stands for. A `void` run stands for the whole node, so an
       * interval ending on it must end *after* the node; `open` and `close` are the two halves of a
       * `<t id="N">` pair and bracket the element's content instead.
       */
      role: 'void' | 'open' | 'close'
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
 * The node, minus the injected subtrees inside it, as one range per surviving stretch. Keeps the
 * parts a reader should see — a footnote marker, the original note text — while leaving our own
 * translation of it outside the highlight.
 */
function carveInjected(node: Element): Range[] {
  const doc = node.ownerDocument
  const injected = Array.from(node.querySelectorAll(INJECTED_SELECTOR))
  if (!doc || injected.length === 0) return []
  const out: Range[] = []
  let anchorNode: Node = node
  let anchorAfter = false
  for (const stale of injected) {
    // Skip one nested inside another we have already stepped over
    if (out.length > 0 && anchorAfter && (anchorNode as Element).contains(stale)) continue
    const range = doc.createRange()
    if (anchorAfter) range.setStartAfter(anchorNode)
    else range.setStartBefore(anchorNode)
    range.setEndBefore(stale)
    out.push(range)
    anchorNode = stale
    anchorAfter = true
  }
  const tail = doc.createRange()
  if (anchorAfter) tail.setStartAfter(anchorNode)
  else tail.setStartBefore(anchorNode)
  tail.setEndAfter(node)
  out.push(tail)
  return out
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
/** The next node in document order after this whole subtree, never leaving `scope`. */
function afterSubtree(node: Node, scope: Node): Node | undefined {
  let current: Node | null = node
  while (current && current !== scope) {
    if (current.nextSibling) return current.nextSibling
    current = current.parentNode
  }
  return undefined
}

/** The next node in document order, never leaving `scope`'s subtree. */
function nextInOrder(node: Node, scope: Node): Node | undefined {
  return node.firstChild ?? afterSubtree(node, scope)
}

/** Nearest node containing both, so a walk between them cannot escape into the rest of the page. */
function commonAncestor(a: Node, b: Node): Node {
  const chain = new Set<Node>()
  for (let node: Node | null = a; node; node = node.parentNode) chain.add(node)
  for (let node: Node | null = b; node; node = node.parentNode) if (chain.has(node)) return node
  return a.ownerDocument?.documentElement ?? a
}

/**
 * Whether a node we injected lies between these two runs right now.
 *
 * **Asked at range time, not recorded at serialize time.** `planBatches` serialises every selected
 * block before `processBatch` inserts the pending node and later the translation, so a flag written
 * during serialisation cannot know about a nested block that finished afterwards — and that is
 * exactly the flow this guards (Codex pointed this out on #123).
 *
 * The walk is bounded by the common ancestor. `b` is frequently an *ancestor* of `a` — the last text
 * inside a paired element and that element's own closing slot — and a preorder walk never returns to
 * an ancestor, so an unbounded one runs off the end of the block, meets the block's own translation
 * sibling, and reports a discontinuity at every ordinary closing tag. Scanning the rest of the page
 * once per closing tag also makes building a highlight quadratic in the document (Codex on #123).
 */
function injectedBetween(from: WireSpan, to: WireSpan): boolean {
  const a = from.node
  const b = to.node
  if (a === b) return false
  const scope = commonAncestor(a, b)
  // A closing slot stands for the boundary *after* its element, so that subtree is already behind
  // us. Descending into it walks the element a second time — quadratic on nested markup — and
  // rediscovers any injected descendant as if it came after the close (Codex on #123).
  let node = from.kind === 'slot' && from.role === 'close' ? afterSubtree(a, scope) : nextInOrder(a, scope)
  while (node) {
    if (node === b) return false
    if (node.nodeType === 1 && isInjected(node as Element)) return true
    node = nextInOrder(node, scope)
  }
  return false
}

/**
 * Wire interval `[from, to)` as ranges.
 *
 * **Usually one range, but not always.** `serialize` skips nodes we injected ourselves, and more
 * arrive after serialisation, so two runs that are adjacent in wire coordinates can have a
 * translation sitting between them in the DOM. One range spanning that gap would contain the inner
 * translation and highlight it as if it were source text, so the interval is cut at every such
 * discontinuity. `Highlight` takes any number of ranges, so the caller just spreads them.
 *
 * A boundary inside a placeholder resolves to that node's own boundary, so a sentence that opens or
 * closes on a formula still contains it.
 *
 * Returns an empty array when there is nothing to select: no spans, an empty interval, or an
 * interval reaching outside the tiled wire text. Out-of-bounds is checked **before** any range is
 * built, so a malformed request yields nothing rather than a truncated prefix.
 */
export function rangesOf(spans: readonly WireSpan[], from: number, to: number): Range[] {
  if (spans.length === 0 || to <= from) return []
  const first = spans[0]!
  const last = spans[spans.length - 1]!
  if (from < first.from || to > last.to) return []

  const out: Range[] = []
  let segmentStart = from
  let previous = spanAt(spans, from)
  const flush = (end: number) => {
    if (end <= segmentStart) return
    const range = oneRange(spans, segmentStart, end)
    if (range) out.push(range)
  }
  for (const span of spans) {
    if (span.to <= from || span.from >= to) continue
    // A *void* slot holding our own translation — a footnote whose content was translated in place
    // — is covered by carved pieces instead of one range enclosing the whole node (Codex on #123).
    //
    // Only void. A paired element is represented by its open and close runs with text spans in
    // between, so carving on either half would cover the whole element however little of it the
    // interval asked for, and both halves would carve it again. Injected content inside a pair sits
    // between those text spans, where injectedBetween already finds it.
    const holds = span.kind === 'slot' && span.role === 'void' && span.node.nodeType === 1 && (span.node as Element).querySelector(INJECTED_SELECTOR)
    if (holds) {
      flush(span.from)
      out.push(...carveInjected(span.node as Element))
      segmentStart = span.to
      previous = span
      continue
    }
    if (span.from > from && previous && injectedBetween(previous, span)) {
      flush(span.from)
      segmentStart = span.from
    }
    previous = span
  }
  flush(to)
  return out
}
