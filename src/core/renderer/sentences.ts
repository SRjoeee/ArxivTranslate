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
export const rendered = (el: Element): boolean =>
  typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.isConnected

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
    // 这一轮没有对齐，之前登记过的（包括还挂在屏幕上的拆图副本）就都作废了：它们记的是上一轮的
    // 句边界。**光删索引不够**——副本自己也是 `maps` 的键，指针直接落在副本上时照样查得到那份
    // 陈旧的记录（Codex 在 #148 指出）
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
  // 同一个原文重新翻了一遍：之前那些译文——尤其是**还挂在屏幕上、签名没变所以没被重建**的拆图
  // 副本——记的还是上一轮的句边界。译文正文一样时（副本能留下来正说明这一点）它们的 span 仍然
  // 对得上，只把句边界换成这一版；对不上就忘掉，宁可不高亮也不按错的配对高亮（Codex 在 #148 指出）
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
    // 分支写开而不是一把 spread：联合类型经过 spread 会被展宽，`kind` 的字面量类型就丢了。
    // 文本 span 的 node 是 `Text`——同构的克隆里对应位置一定同类型，但**查一下再用**，
    // 不合就留着原来那个（它至多让这一段不亮，而不是把偏移算到别的节点上）
    if (span.kind !== 'text') return { ...span, node }
    return node.nodeType === Node.TEXT_NODE ? { ...span, node: node as Text } : span
  }
  const spans = map.target.spans.map(moved)
  maps.set(copy, { pairs: map.pairs, source: map.source, target: { root: copy, spans, index: indexSpans(spans) } })
  remember(map.source.root, copy)
}

/**
 * 这个译文节点此刻的句子登记状况，给拆图的签名用。
 *
 * 拆图按译文正文的签名决定要不要重建副本。正文没变、但句子登记从「没有」变成「有」时，副本会被
 * 原样留下，而它从来没被镜像过——悬停原文落到藏起来的原件上、悬停副本什么也查不到（Codex 在 #148
 * 指出这个反向的转换）。把登记状况编进签名，这种转换就会走正常的重建 + 镜像那条路
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
