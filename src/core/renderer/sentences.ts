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
 * Two maps, and the split is what keeps this from leaking.
 *
 * The record is heavy — every text node of the translation and a span for every run — and it is
 * keyed by the **translation** node, which `restore()` removes, so it dies with what it describes.
 * The original element only holds a `WeakRef` to that node. Keying the record by the original
 * instead would retain it forever: `restore()` leaves the originals in the document, so the key
 * stays reachable, and a WeakMap entry whose key is reachable keeps its value alive — one detached
 * translation subtree per block, for the rest of the page's life (Codex pointed this out on #130).
 *
 * Not `nextElementSibling` in place of the WeakRef, though §7.1 does put the translation there:
 * that is where it is *inserted*, and split-figure copies and mirrors are inserted after it later.
 */
const maps = new WeakMap<Element, SentenceMap>()
/**
 * A source element's translations, newest first.
 *
 * More than one because side mode copies a whole figure into the right column and **the copy is
 * what the reader sees** — the original translation is still there, hidden, and still registered.
 * Both are kept and the first *rendered* one answers, so the highlight follows the copy while it
 * exists and falls back to the original the moment the copy is dropped (issue #139).
 */
const targetsOf = new WeakMap<Element, WeakRef<Element>[]>()

/**
 * Whether this element is the one on screen.
 *
 * Switching modes does not remove a split copy, it hides one side or the other with CSS — stack
 * hides the copy, only hides the original — so "still in the document" cannot tell them apart.
 * `checkVisibility` can, and is Chrome 105+ against a floor of 131. Where it does not exist, being
 * in the document is the best available answer.
 */
/**
 * `visibility: hidden` and `opacity: 0` count as hidden too. Both keep their layout boxes, so
 * without these options the bands would be painted over invisible text and the peek would never
 * open for it (Codex on #149). Opt-in checks: the no-argument call only sees `display: none`.
 */
const VISIBILITY: CheckVisibilityOptions = { visibilityProperty: true, opacityProperty: true }
export const rendered = (el: Element): boolean =>
  typeof el.checkVisibility === 'function' ? el.checkVisibility(VISIBILITY) : el.isConnected

/** The record reachable from either side of a block, or undefined once the translation is gone. */
function recordOf(el: Element): SentenceMap | undefined {
  const own = maps.get(el)
  if (own) return own
  const refs = targetsOf.get(el)
  if (!refs || refs.length === 0) return undefined
  // One translation, which is every block that is not a split figure: no question to ask, and no
  // style query to pay for on the way to answering it
  if (refs.length === 1) {
    const only = refs[0]!.deref()
    return only ? maps.get(only) : undefined
  }
  let fallback: SentenceMap | undefined
  for (const ref of refs) {
    const target = ref.deref()
    const map = target && maps.get(target)
    if (!map) continue
    if (rendered(target)) return map
    fallback ??= map
  }
  // Nothing on screen: hand back one anyway, so `live()` can report it as stale rather than this
  // looking like a block that was never registered
  return fallback
}

/** Remembers a translation for this source, newest first, dropping refs whose node is gone. */
function remember(source: Element, target: Element): void {
  const kept = (targetsOf.get(source) ?? []).filter(ref => ref.deref() !== undefined)
  targetsOf.set(source, [new WeakRef(target), ...kept])
}

/**
 * Registers a translated block, if it has everything the highlight needs.
 *
 * Blocks without an alignment — today every Google and LLM block, since only Microsoft reports
 * sentence boundaries — are simply not registered. Hovering them does nothing, which is the
 * intended outcome: a guessed pairing would put the highlight on the wrong sentence, and no
 * highlight is better than a wrong one (`alignment.ts`).
 */
export function registerSentences(source: Element, target: Element, sourceSpans: readonly WireSpan[], targetSpans: readonly WireSpan[] | undefined, alignment: SentenceAlignment | undefined): void {
  if (!alignment || !targetSpans) {
    // No alignment this round: everything registered before (split copies still on screen included) is void — it
    // recorded the previous round's sentence boundaries. **Removing the index is not enough** — a copy is itself a key
    // of `maps`, and a pointer landing on the copy would still find the stale record (Codex on #148)
    for (const ref of targetsOf.get(source) ?? []) {
      const previous = ref.deref()
      if (previous) maps.delete(previous)
    }
    targetsOf.delete(source)
    return
  }
  const map: SentenceMap = {
    pairs: sentencePairs(alignment),
    source: { root: source, spans: sourceSpans, index: indexSpans(sourceSpans) },
    target: { root: target, spans: targetSpans, index: indexSpans(targetSpans) },
  }
  maps.set(target, map)
  // The same original translated once more: the earlier translations — above all the split copies **still on screen,
  // unchanged in signature and so not rebuilt** — still record the previous round's sentence boundaries. With the same
  // translation text (a copy surviving shows exactly that) their spans still line up, so only the boundaries are
  // replaced by this version's; otherwise they are forgotten — no highlight beats a highlight on the wrong pairing
  // (Codex on #148)
  const span = (side: SentenceSide) => side.spans[side.spans.length - 1]?.to ?? 0
  for (const ref of targetsOf.get(source) ?? []) {
    const previous = ref.deref()
    const stale = previous && previous !== target ? maps.get(previous) : undefined
    if (!stale) continue
    if (span(stale.target) === span(map.target)) maps.set(previous!, { ...stale, pairs: map.pairs, source: map.source })
    else maps.delete(previous!)
  }
  remember(source, target)
}

/**
 * Registers the copy side mode made of a translation, so the highlight can paint on what is on
 * screen.
 *
 * `splitFigures` copies a whole figure — caption included — into the right column and hides the
 * original. The registry held the original translation, which has no boxes once hidden, so a
 * figure caption tinted on the source side and nothing at all on the other (issue #139, reported
 * from real reading).
 *
 * **The node mapping comes from the caller**, taken while the two trees were still identical.
 * Rebuilding it here would mean matching two trees that are no longer isomorphic: the copy has had
 * the original member of every pair removed from it by then.
 */
export function mirrorSentences(target: Element, copy: Element, twin: (node: Node) => Node | undefined): void {
  const map = maps.get(target)
  if (!map) return
  const moved = (span: WireSpan): WireSpan => {
    const node = twin(span.node)
    if (!node) return span
    // Branches spelled out rather than one spread: a union type widens through a spread and the literal type of
    // `kind` is lost. A text span's node is a `Text` — the same position in an isomorphic clone has the same type, but
    // **checked before use**; a mismatch keeps the old one (at worst this span does not light up, rather than offsets
    // being computed against another node)
    if (span.kind !== 'text') return { ...span, node }
    return node.nodeType === Node.TEXT_NODE ? { ...span, node: node as Text } : span
  }
  const spans = map.target.spans.map(moved)
  maps.set(copy, { pairs: map.pairs, source: map.source, target: { root: copy, spans, index: indexSpans(spans) } })
  remember(map.source.root, copy)
}

/** A span moved onto its twin, or left alone when the twin is missing or of the wrong kind. */
function movedOnto(span: WireSpan, twin: (node: Node) => Node | undefined): WireSpan {
  const node = twin(span.node)
  if (!node) return span
  // Branches spelled out rather than one spread: a union type widens through a spread and the literal type of `kind` is lost
  if (span.kind !== 'text') return { ...span, node }
  return node.nodeType === Node.TEXT_NODE ? { ...span, node: node as Text } : span
}

/**
 * Registers a copy of a whole pair — both sides cloned — so the copy highlights on its own.
 *
 * `localizeNotes` puts a footnote's translation beside the copy of its original that the
 * paragraph's translation carries (§7.2), and in side mode that copy is the only note on screen:
 * the original's box is hidden. Both halves are clones, so neither is registered; a pointer on
 * the copy walked up to the paragraph's translation and tinted the sentence the note hangs off,
 * not the note (user, 2026-09-10). The node mappings come from the caller, which knows how the
 * clones differ from what they were cloned from.
 */
export function mirrorPair(target: Element, copies: { source: Element; target: Element }, twin: { source: (node: Node) => Node | undefined; target: (node: Node) => Node | undefined }): void {
  const map = maps.get(target)
  if (!map) return
  const source = map.source.spans.map(span => movedOnto(span, twin.source))
  const moved = map.target.spans.map(span => movedOnto(span, twin.target))
  maps.set(copies.target, {
    pairs: map.pairs,
    source: { root: copies.source, spans: source, index: indexSpans(source) },
    target: { root: copies.target, spans: moved, index: indexSpans(moved) },
  })
  remember(copies.source, copies.target)
}

/**
 * This translation node's sentence registration as it stands, for the split-figure signature.
 *
 * Split figures decide by the translation text's signature whether to rebuild a copy. With the text unchanged but
 * the registration going from “none” to “some”, the copy would be left as it is, never mirrored — hovering the
 * original lands on the hidden original, hovering the copy finds nothing (Codex on #148 pointed out the reverse
 * transition). With the registration in the signature, that transition takes the normal rebuild + mirror path
 */
export function sentenceSignatureOf(el: Element): string {
  const map = maps.get(el)
  return map ? String(map.pairs.length) : ''
}

/** The record for an element, or undefined if this block has no usable alignment. */
export function sentenceMapOf(el: Element): SentenceMap | undefined {
  return recordOf(el)
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
 * Walks all the way to the root rather than stopping after a fixed number of levels. It used to
 * stop at twelve, on the theory that a miss should cost a handful of lookups rather than one per
 * level — but a lookup is a `WeakMap.get`, and the cost of going all the way up is a dozen or so of
 * them once per frame, which is nothing. The bound was not free: text nodes in the fixtures sit as
 * deep as **sixteen** element levels below their block (a `msqrt/msub/mi` in `2401.00596.html`),
 * and twelve reaches only 99.824% of them — 371 of 86409. Deep MathML nests without limit, so no
 * constant is the right answer (Codex pointed this out on #130).
 */
export function sentenceMapAt(node: Node): { map: SentenceMap; side: 'source' | 'target' } | undefined {
  let el: Element | null = node.nodeType === 1 ? (node as Element) : node.parentElement
  for (; el; el = el.parentElement) {
    const map = recordOf(el)
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
