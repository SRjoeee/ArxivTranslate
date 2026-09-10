// A leading label under the markers wire format (DESIGN §6.3, issue #150).
//
// `markers` has no paired placeholders, so every formatting element is flattened to text before the
// block goes out, and the translation comes back as one run: `<b>Keywords:</b> large …` becomes
// `关键词：大型…` with nothing to carry the bold. That is by design — the engine that needs markers
// keeps tags 0% of the time — and it costs inline styling in general. But the one case a reader
// meets on every page is the run-in label a block opens with: `Keywords:`, `Note.`,
// `Contributions.`, an italic theorem statement. Those can be put back safely, because a label at
// the very start followed by a separator comes back at the very start followed by a separator.
// Replayed through the Edge endpoint over 115 such blocks from 13 papers (2026-09-10), the first
// separator of the translation ended the label's translation in 114; the one miss — a label ending
// in `..` that came back as an ellipsis — is what the length bound below rejects.
//
// **Under-wrap, never mis-wrap.** Every check that fails leaves the translation exactly as it is
// today. The wire text is never touched, so translations and cache keys do not change.

import { LABEL_FORMATTING } from '@/core/rules/latexml'
import { cloneWithoutIds } from './clone'
import { indexSpans, type WireSpan, wireOffsetAt } from './offsets'
import type { ProtectedBlock } from './serialize'

/** Longer than this is a sentence set in italics, not a label: past what the replay covered. */
const MAX_LABEL_WORDS = 8
/**
 * The label's translation may be this many characters longer than the label. Chinese runs shorter
 * than English, so this only has to cover a spaced separator; it is what turns a separator that
 * moved — an ellipsis for `..`, a colon the engine dropped — into "leave it alone".
 */
const SLACK = 4
const TERMINATOR = /[。！？!?]/
const TEXT_NODE = 3

type Separator = 'colon' | 'period' | 'whole'
interface Label {
  el: Element
  separator: Separator
  /** Whether the separator is part of the label (`<b>Keywords:</b>`) or follows it (`<b>MMLU</b>:`) */
  inside: boolean
  /** Characters of label text, the yardstick for the translation's prefix */
  length: number
}

/**
 * The formatting element a block opens with, if the block is shaped like `label: rest`, `label.
 * rest`, or is nothing but the label. Read from the original, which translation never changes.
 */
export function leadingLabel(root: Element, slots: ReadonlyMap<number, Node>): Label | undefined {
  const first = root.firstElementChild
  if (!first?.matches(LABEL_FORMATTING)) return undefined
  for (let n = root.firstChild; n && n !== first; n = n.nextSibling) if (/\S/.test(n.textContent ?? '')) return undefined
  // A label that went out as a placeholder — all maths, or code — comes back as one: nothing to wrap
  for (const slot of slots.values()) if (slot === first) return undefined
  const text = (first.textContent ?? '').replace(/\s+/g, ' ').trim()
  if (!text || text.split(' ').length > MAX_LABEL_WORDS) return undefined
  let rest = ''
  for (let n = first.nextSibling; n; n = n.nextSibling) rest += n.textContent ?? ''
  const length = text.length
  if (!/\S/.test(rest)) return { el: first, separator: 'whole', inside: true, length }
  // The separator must be the label's only one: the translation's *first* separator is what ends
  // the label, and a label carrying one inside — `J. Symbolic Comput.`, a journal name set in
  // italics — would be cut at that inner one, italicising `J.` alone (Codex on #151)
  const body = text.slice(0, -1)
  if (/[:：]$/.test(text)) return /[:：]/.test(body) ? undefined : { el: first, separator: 'colon', inside: true, length }
  if (/^\s*[:：]/.test(rest)) return /[:：]/.test(text) ? undefined : { el: first, separator: 'colon', inside: false, length }
  if (/\.$/.test(text)) return /\.\s/.test(body) ? undefined : { el: first, separator: 'period', inside: true, length }
  return undefined
}

/**
 * Splits the text node at `at` and its span with it, so every wire offset still maps to the same
 * character: the head keeps the anchors before the cut, the tail starts a fresh one and shifts the
 * rest by the cut. The hover highlight reads these spans; a split node with an unsplit span would
 * put its offsets past the node's end.
 */
function splitSpan(spans: WireSpan[], node: Text, at: number): void {
  const i = spans.findIndex(s => s.kind === 'text' && s.node === node)
  const span = i >= 0 ? (spans[i] as Extract<WireSpan, { kind: 'text' }>) : undefined
  const w = span ? wireOffsetAt(indexSpans([span]), node, at) : undefined
  const tailNode = node.splitText(at)
  if (!span || w === undefined) return
  const head: WireSpan = { ...span, to: w, anchors: span.anchors.filter(([aw]) => aw < w) }
  const shifted = span.anchors.filter(([aw]) => aw > w).map(([aw, an]) => [aw, an - at] as const)
  const tail: WireSpan = { kind: 'text', node: tailNode, from: w, to: span.to, anchors: [[w, 0] as const, ...shifted] }
  spans.splice(i, 1, head, tail)
}

/**
 * Puts the label's element back around its translation, if the translation is shaped as the
 * original was. Returns whether it did. `spans` is updated in place where a text node is split.
 */
export function restoreLeadingLabel(fragment: DocumentFragment, spans: WireSpan[], block: ProtectedBlock, doc: Document): boolean {
  const label = leadingLabel(block.root, block.slots)
  if (!label) return false
  const nodes = Array.from(fragment.childNodes)
  const wrapped: Node[] = []
  if (label.separator === 'whole') {
    wrapped.push(...nodes)
  } else {
    const SEP = label.separator === 'colon' ? /[:：]/ : /。|\.(?=\s|$)/
    // A sentence ending before the separator means the separator is not the label's
    const stop = label.separator === 'colon' ? TERMINATOR : /[！？!?]/
    let seen = 0
    let cut: { node: Text; at: number } | undefined
    for (const n of nodes) {
      if (n.nodeType === TEXT_NODE) {
        const data = (n as Text).data
        const m = SEP.exec(data)
        const head = m ? data.slice(0, m.index) : data
        if (stop.test(head)) return false
        seen += head.length
        if (seen > label.length + SLACK) return false
        if (m) {
          cut = { node: n as Text, at: label.inside ? m.index + m[0].length : m.index }
          break
        }
      }
      wrapped.push(n)
    }
    if (!cut) return false
    if (cut.at === cut.node.data.length) wrapped.push(cut.node)
    else if (cut.at > 0) {
      splitSpan(spans, cut.node, cut.at)
      wrapped.push(cut.node)
    }
  }
  // Something visible has to go in: a label whose translation vanished is not a label any more
  if (!wrapped.some(n => (n.nodeType === TEXT_NODE ? /\S/.test((n as Text).data) : true))) return false
  // The label's placeholders must all be in front of the cut. A separator the engine put among a
  // label's formulas — `Step 2: We next prove that Ξ…` cut after its first formula — passes the
  // length bound, since the label itself is long; the placeholder count is what catches it
  // (replay, 2026-09-10). Under markers every element at the fragment's top level is a placeholder
  let inLabel = 0
  for (const slot of block.slots.values()) if (label.el.contains(slot)) inLabel++
  if (wrapped.filter(n => n.nodeType !== TEXT_NODE).length !== inLabel) return false
  const shell = cloneWithoutIds(doc, label.el, false) as Element
  fragment.insertBefore(shell, wrapped[0]!)
  for (const n of wrapped) shell.append(n)
  return true
}
