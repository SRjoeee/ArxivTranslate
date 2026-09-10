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
 * How much longer than the label its translation may be. This is what turns a separator that moved
 * — an ellipsis for `..`, a colon the engine dropped — into "leave it alone". Han, kana and hangul
 * run shorter than English, so for them a few characters cover a spaced separator; scripts that
 * run longer (French `Avertissement :` for `Warning:`, German, Russian) get twice the label
 * (Codex on #151). Decided from the prefix itself, so no target language has to be threaded in.
 */
const SLACK = 4
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
/**
 * Sentence-ending marks across the target languages the extension offers, so a label's period
 * is found when the engine writes the script's own full stop: `。` and `．` (CJK), `।` / `॥`
 * (danda: Hindi, Bengali, …), `۔` (Urdu), `։` (Armenian), `።` (Ethiopic), `။` (Myanmar),
 * `།` (Tibetan). An ASCII `.` counts only before whitespace or at the end — `3.5` is not a
 * boundary (Codex on #151).
 */
const FULL_STOP = /[。．।॥۔։።။།]|\.(?=\s|$)/
/** Question and exclamation marks, the Arabic question mark included */
const EXCLAIM = /[！？!?؟]/
const COLON = /[:：]/
const bound = (label: number, prefix: string): number => {
  const cjk = (prefix.match(CJK) ?? []).length
  return cjk * 2 >= prefix.replace(/\s/g, '').length ? label + SLACK : label * 2 + SLACK
}
const TERMINATOR = new RegExp(`${FULL_STOP.source}|${EXCLAIM.source}`)
const TEXT_NODE = 3

/** Sentence lengths on each side, as the engine reported them and `verifyAlignment` confirmed. */
export interface Boundaries { source: readonly number[]; target: readonly number[] }
/** A sentence length may include the whitespace after the sentence; a boundary matches within this */
const BOUNDARY_SLACK = 2

type Separator = 'colon' | 'period' | 'whole'
interface Label {
  el: Element
  /** The label's own text, as the wire carries it */
  text: string
  separator: Separator
  /** Whether the separator is part of the label (`<b>Keywords:</b>`) or follows it (`<b>MMLU</b>:`) */
  inside: boolean
  /** Characters of label text, the yardstick for the translation's prefix */
  length: number
}

/**
 * The text of an element as the wire carries it: the text nodes outside any protected slot,
 * whitespace collapsed. `textContent` would also count what a slot hides — a formula's
 * `<annotation>` holds its whole TeX source, hundreds of characters that never go out, and a label
 * measured with them would let the bound pass a separator deep in the body (Codex on #151).
 */
function wireText(el: Element, slots: ReadonlyMap<number, Node>): string {
  const protectedNodes = Array.from(slots.values())
  const doc = el.ownerDocument
  const walker = doc.createTreeWalker(el, 4 /* NodeFilter.SHOW_TEXT */)
  let out = ''
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!protectedNodes.some(slot => slot.contains(node))) out += (node as Text).data
  }
  return out.replace(/\s+/g, ' ').trim()
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
  const text = wireText(first, slots)
  if (!text || text.split(' ').length > MAX_LABEL_WORDS) return undefined
  let rest = ''
  for (let n = first.nextSibling; n; n = n.nextSibling) rest += n.textContent ?? ''
  const length = text.length
  if (!/\S/.test(rest)) return { el: first, text, separator: 'whole', inside: true, length }
  // The separator must be the label's only one: the translation's *first* separator is what ends
  // the label, and a label carrying one inside — `J. Symbolic Comput.`, a journal name set in
  // italics — would be cut at that inner one, italicising `J.` alone (Codex on #151)
  const body = text.slice(0, -1)
  if (/[:：]$/.test(text)) return /[:：]/.test(body) ? undefined : { el: first, text, separator: 'colon', inside: true, length }
  if (/^\s*[:：]/.test(rest)) return /[:：]/.test(text) ? undefined : { el: first, text, separator: 'colon', inside: false, length }
  if (/\.$/.test(text)) return /\.\s/.test(body) ? undefined : { el: first, text, separator: 'period', inside: true, length }
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
  // An anchor exactly at `w` — the cut right after an entity — belongs to the head as well: it is
  // what makes the head's last offset map back to the wire position after the entity (Codex on #151)
  const head: WireSpan = { ...span, to: w, anchors: span.anchors.filter(([aw]) => aw <= w) }
  const shifted = span.anchors.filter(([aw]) => aw > w).map(([aw, an]) => [aw, an - at] as const)
  const tail: WireSpan = { kind: 'text', node: tailNode, from: w, to: span.to, anchors: [[w, 0] as const, ...shifted] }
  spans.splice(i, 1, head, tail)
}

/**
 * Puts the label's element back around its translation, if the translation is shaped as the
 * original was. Returns whether it did. `spans` is updated in place where a text node is split.
 */
/** The wire offset a cut in a text node stands at, before the node is split. */
function wireOffsetOfCut(spans: readonly WireSpan[], node: Text, at: number): number | undefined {
  const span = spans.find(s => s.kind === 'text' && s.node === node)
  if (!span) return undefined
  if (at === 0) return span.from
  if (at === node.data.length) return span.to
  return wireOffsetAt(indexSpans([span]), node, at)
}

/**
 * Whether the engine itself ended a sentence exactly at the label and exactly at the cut.
 *
 * A period is the one separator a body sentence also ends with, and a translation that drops the
 * label's period leaves nothing else to tell `注意 好。` (a label and a short body sentence) from
 * a label translated long: both sit inside the length bound (Codex on #151). The engine's own
 * boundaries can tell them apart — a label kept as its own sentence is reported as one, and every
 * way of merging it with the body moves a boundary or changes the count (which fails
 * verification upstream). Replayed over the 59 period labels the rules restore, all 59 have this
 * evidence; a label without a reported alignment is left alone.
 */
function endsSentences(alignment: Boundaries | undefined, labelEnd: number, cut: number): boolean {
  if (!alignment) return false
  const s0 = alignment.source[0] ?? -1
  const t0 = alignment.target[0] ?? -1
  return s0 >= labelEnd && s0 <= labelEnd + BOUNDARY_SLACK && t0 >= cut && t0 <= cut + BOUNDARY_SLACK
}

export function restoreLeadingLabel(fragment: DocumentFragment, spans: WireSpan[], block: ProtectedBlock, doc: Document, ids: ReadonlyMap<Node, number>, alignment?: Boundaries): boolean {
  const label = leadingLabel(block.root, block.slots)
  if (!label) return false
  const nodes = Array.from(fragment.childNodes)
  const wrapped: Node[] = []
  if (label.separator === 'whole') {
    wrapped.push(...nodes)
  } else {
    const SEP = label.separator === 'colon' ? COLON : FULL_STOP
    // Any other separator before the candidate means the engine changed the label's — `Note.`
    // coming back as `注意：` — and the candidate is the body's; a sentence ending there says the
    // same. Left alone rather than guessed (Codex on #151). A colon the label itself carries
    // (`Step 3: Conclusion.`) is expected in the translation and is not a change
    const stop = label.separator === 'colon' ? TERMINATOR : COLON.test(label.text) ? EXCLAIM : new RegExp(`${EXCLAIM.source}|${COLON.source}`)
    let seen = ''
    let cut: { node: Text; at: number } | undefined
    for (const n of nodes) {
      if (n.nodeType === TEXT_NODE) {
        const data = (n as Text).data
        const m = SEP.exec(data)
        const head = m ? data.slice(0, m.index) : data
        if (stop.test(head)) return false
        seen += head
        if (seen.length > bound(label.length, seen)) return false
        if (m) {
          cut = { node: n as Text, at: label.inside ? m.index + m[0].length : m.index }
          break
        }
      }
      wrapped.push(n)
    }
    if (!cut) return false
    if (label.separator === 'period') {
      let labelEnd = 0
      for (const s of block.offsets) if (label.el.contains(s.node)) labelEnd = Math.max(labelEnd, s.to)
      const w = wireOffsetOfCut(spans, cut.node, cut.at)
      if (w === undefined || !endsSentences(alignment, labelEnd, w)) return false
    }
    if (cut.at === cut.node.data.length) wrapped.push(cut.node)
    else if (cut.at > 0) {
      splitSpan(spans, cut.node, cut.at)
      wrapped.push(cut.node)
    }
  }
  // Something visible has to go in: a label whose translation vanished is not a label any more
  if (!wrapped.some(n => (n.nodeType === TEXT_NODE ? /\S/.test((n as Text).data) : true))) return false
  // The label's placeholders must all be in front of the cut, and nothing else: a separator the
  // engine put among a label's formulas — `Step 2: We next prove that Ξ…` cut after its first
  // formula — passes the length bound, since the label itself is long (replay, 2026-09-10); and
  // `validate()` allows the engine to reorder placeholders, so a body formula could stand where a
  // label formula was (Codex on #151). Compared by identity, not by count
  const inLabel = new Set<number>()
  for (const [id, slot] of block.slots) if (label.el.contains(slot)) inLabel.add(id)
  const inPrefix = wrapped.filter(n => n.nodeType !== TEXT_NODE).map(n => ids.get(n))
  if (inPrefix.length !== inLabel.size || inPrefix.some(id => id === undefined || !inLabel.has(id))) return false
  const shell = cloneWithoutIds(doc, label.el, false) as Element
  fragment.insertBefore(shell, wrapped[0]!)
  for (const n of wrapped) shell.append(n)
  return true
}
