// Which sentence of a block is which, on both sides (issue #105).
//
// The hover highlight needs three things at pointer time: the wire spans of the source, the wire
// spans of the translation, and the sentence boundaries that pair them. All three exist only for a
// moment during rendering — the source spans come from `serialize`, the translation spans from
// `rehydrate`, the boundaries from the engine — so they are captured here as the translation is
// inserted, and looked up later by whichever element the pointer happens to be over.
//
// **A WeakMap, not DOM attributes.** §7.1 allows appending `data-axt-*` attributes to an original
// node, but these are hundreds of numbers per block and belong nowhere near the document: writing
// them would bloat the DOM the reader is reading, survive into anything that serialises the page,
// and have to be parsed back on every pointer move. A WeakMap also disappears with the nodes, so
// `restore()` needs no cleanup pass to avoid leaking a block that was removed.

import { indexSpans, type SpanIndex, type WireSpan } from '@/core/protector'
import { type SentenceAlignment, type SentencePair, sentencePairs } from '@/providers/alignment'

/** One side of a block: the element the pointer can be over, and the wire spans inside it. */
export interface SentenceSide {
  root: Element
  spans: readonly WireSpan[]
  /** `spans` keyed by node, so a pointer hit is a lookup rather than a scan (`offsets.ts`) */
  index: SpanIndex
}

/** A block whose two sides can be highlighted together. */
export interface SentenceMap {
  /** Sentence *i* of `source` corresponds to sentence *i* of `target` (`alignment.ts`) */
  pairs: readonly SentencePair[]
  source: SentenceSide
  target: SentenceSide
}

/**
 * Both elements of a block point at the same record, so a hit on either side finds the other.
 * Keyed by element, so a block re-translated into a new node simply registers again and the old
 * entry becomes unreachable along with the node it described.
 */
const registry = new WeakMap<Element, SentenceMap>()

/**
 * Registers a translated block, if it has everything the highlight needs.
 *
 * Blocks without an alignment — today every Google and LLM block, since only Microsoft reports
 * sentence boundaries — are simply not registered. Hovering them does nothing, which is the
 * intended outcome: a guessed pairing would put the highlight on the wrong sentence, and no
 * highlight is better than a wrong one (`alignment.ts`).
 */
export function registerSentences(source: Element, target: Element, sourceSpans: readonly WireSpan[], targetSpans: readonly WireSpan[] | undefined, alignment: SentenceAlignment | undefined): void {
  if (!alignment || !targetSpans) return
  const map: SentenceMap = {
    pairs: sentencePairs(alignment),
    source: { root: source, spans: sourceSpans, index: indexSpans(sourceSpans) },
    target: { root: target, spans: targetSpans, index: indexSpans(targetSpans) },
  }
  registry.set(source, map)
  registry.set(target, map)
}

/** The record for an element, or undefined if this block has no usable alignment. */
export function sentenceMapOf(el: Element): SentenceMap | undefined {
  return registry.get(el)
}

/**
 * Whether a record still describes the page.
 *
 * `restore()` removes every translation node but leaves the originals in place, so entries keyed by
 * an original element outlive the block they described. Rather than tracking registrations — which
 * would mean holding the elements strongly and defeating the point of a WeakMap — a stale entry is
 * recognised on use: its translation node is no longer in the document. One property read, and it
 * covers re-rendering and `clearTranslation` too.
 */
const live = (map: SentenceMap) => map.target.root.isConnected

/**
 * The block a node sits in, walking up until a registered element is found.
 *
 * Bounded by `limit` ancestors rather than by the document root: the walk runs on every pointer
 * move, and a miss deep inside a table should cost a handful of map lookups, not one per level up
 * to `<html>`. Blocks are shallow — a `.ltx_p` is a few levels below its section — so a bound this
 * loose still finds every real hit.
 */
export function sentenceMapAt(node: Node, limit = 12): { map: SentenceMap; side: 'source' | 'target' } | undefined {
  let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement
  for (let i = 0; el && i < limit; i++, el = el.parentElement) {
    const map = registry.get(el)
    if (map && live(map)) return { map, side: map.source.root === el ? 'source' : 'target' }
  }
  return undefined
}

/** The sentence containing this wire offset, or undefined past the last one. */
export function sentenceAt(pairs: readonly SentencePair[], side: 'source' | 'target', wireOffset: number): SentencePair | undefined {
  let lo = 0
  let hi = pairs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const span = pairs[mid]![side]
    if (wireOffset < span.from) hi = mid - 1
    else if (wireOffset >= span.to) lo = mid + 1
    else return pairs[mid]
  }
  return undefined
}
