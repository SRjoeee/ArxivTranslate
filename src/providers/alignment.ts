// Sentence alignment (issue #105): which sentence of the translation corresponds to which sentence
// of the source. Only the engine can produce this — matching two finished texts by position is
// guesswork, because machine translation merges and splits sentences — so every provider that can
// report it does, through this one shape, and the pipeline never branches on how it was obtained.
//
// Three engines, three mechanisms, one contract:
//   - Microsoft returns `sentLen` natively, measured on the exact strings we sent.
//   - Google has no boundaries of its own, so we segment the source and inject markers.
//   - An LLM reports them through its structured output schema.
//
// **Whatever the source, the alignment is accepted only if it reconstructs.** The sentence lengths
// must partition their text exactly. Anything else is dropped, and a dropped alignment costs only
// the highlight — the translation itself is untouched. Trusting an unverified alignment would put a
// highlight on the wrong sentence, which is worse than no highlight at all.

/**
 * Sentence lengths in **wire-text coordinates**, in order. `source` describes the text we sent and
 * `target` the text that came back; entry *i* of each is one sentence pair.
 */
export interface SentenceAlignment {
  source: number[]
  target: number[]
}

/** Cumulative boundaries of a length list: `[0, l0, l0+l1, …, total]`. */
export function boundariesOf(lengths: readonly number[]): number[] {
  const out = [0]
  let at = 0
  for (const len of lengths) {
    at += len
    out.push(at)
  }
  return out
}

/**
 * Accepts the alignment only if it reconstructs both texts exactly, otherwise returns undefined.
 *
 * Equal sentence counts are required because the highlight pairs sentence *i* with sentence *i*; an
 * engine that merged two source sentences into one target sentence has no pairing to offer, and the
 * honest answer there is no highlight. Across 60 real blocks Microsoft's counts matched on every
 * one, so this rejects malformed data rather than a normal case.
 */
import { MARKER_RE, TAG_RE } from '@/core/protector'
import { ABBR } from '@/core/sentences'

/**
 * A placeholder in either wire format, plus whitespace: a boundary sitting against one of these is
 * where it belongs, and the character that decides the question is the one before it.
 *
 * Both formats are matched at once rather than the caller passing which one it used. The two
 * patterns are disjoint in practice, and the one text where they are not — a literal `@a#` on the
 * `tags` path, which `escapeText` leaves alone — errs in the safe direction: it makes a boundary
 * look *more* settled than it is, so the snap below declines to move it. `@@` comes first, as in
 * the protector's own tokenizer.
 */
const FILLER_SOURCE = `${TAG_RE.source}|${MARKER_RE.source}|\\s`
const TRAILING_FILLER = new RegExp(`(?:${FILLER_SOURCE})+$`)
const LEADING_FILLER = new RegExp(`^(?:${FILLER_SOURCE})+`)
const FILLER = new RegExp(FILLER_SOURCE, 'g')
/** Sentence-final punctuation in either language, with whatever closes the quotation after it. */
const SENTENCE_END = /[.!?。！？…]["'\u201d\u300d\u300f）)\]]*$/
/**
 * What cannot start a sentence, and therefore proves the period before it was not one.
 *
 * `Vol. 2` and `3.5` end in a period like any sentence does, and a boundary snapped onto one splits
 * a volume from its number (Codex on #145). A lowercase letter or a digit after the candidate says
 * the run continues; anything else — a capital, a bracket, any CJK character — may open a sentence.
 * An English sentence that really does open with a digit is left unsnapped, which costs a fix and
 * never causes one.
 */
const CONTINUATION = /^[a-z0-9]/
/** Just the closers, for walking to the end of a terminator that is more than one character. */
const CLOSER = /["'\u201d\u300d\u300f）)\]]/

/**
 * Whether this boundary sits right after a sentence end.
 *
 * Placeholders and spaces on either side do not count against it, and the grammar for those is the
 * **protector's own** — an engine may hand back `<x id='1' />` or `<x id=1></x>`, which `validate`
 * accepts as the same placeholder, and a narrower pattern here would read one as visible text
 * (Codex on #145).
 */
const settled = (text: string, at: number): boolean => SENTENCE_END.test(text.slice(0, at).replace(TRAILING_FILLER, ''))

/**
 * Whether a boundary may be moved *onto* this position.
 *
 * Stricter than `settled`, and only for candidates: a period with a lowercase letter or a digit
 * after it belongs to `Vol. 2` or `3.5`, not to a sentence. **Asking this of the boundary the
 * engine already reported would be wrong** — `…grafting?) |using` is punctuation-settled and not
 * ours to second-guess, and treating it as unsettled invited a snap that split `?)` in two
 * (measured, one regression before the two predicates were separated).
 */
const snappable = (text: string, at: number): boolean => {
  // 标点必须**紧贴**在前面（空格不算）。中间隔着占位符，说明下一句是从受保护内容开头的——
  // 公式之类；把边界拉到它后面等于把这个公式判给上一句，而指针落在公式里时又会选到错的那一对
  //（Codex 在 #145 指出）
  const before = text.slice(0, at).replace(/\s+$/, '')
  // 缩写的句点不是句末。`U.S. D|epartment` 后面是大写，continuation 那条看不出来，
  // 用切句器实测过的那份缩写表来判（Codex 在 #145 指出）
  if (!SENTENCE_END.test(before) || ABBR.test(before)) return false
  return !CONTINUATION.test(text.slice(at).replace(LEADING_FILLER, ''))
}

/** Whether a sentence has anything a reader can see, rather than only placeholders and spaces. */
const visible = (piece: string): boolean => piece.replace(FILLER, '').trim().length > 0

/**
 * How far a boundary may be nudged, in characters.
 *
 * Wide enough for what engines actually do — measured, every displacement seen was one or two
 * characters — and narrow enough that it can only ever cross the punctuation it is looking for,
 * never a word.
 */
const SNAP_WINDOW = 3

/**
 * Nudges a boundary that missed its sentence end onto it.
 *
 * Engines report where they think their own sentences end, and they are occasionally a character or
 * two out: Microsoft returned `…对话式工作流程。这|种新兴的…` on `arxiv.org/html/2509.10652v3`, leaving
 * the first character of one sentence tinted as part of the one before it (user report, 2026-09-09,
 * reproduced live). The partition is still exact, so nothing downstream rejects it; only the reader
 * sees it.
 *
 * **It moves nothing that is already right.** A boundary already sitting after sentence-final
 * punctuation is left alone, and one with no such punctuation within `SNAP_WINDOW` is left alone —
 * that is the whole of an author list, where an engine's "sentences" are not sentences and there is
 * nothing to snap to. Every sentence must still contain something visible afterwards, which is what
 * stops a boundary from being pulled onto a period that would leave a neighbour holding only a
 * closing tag.
 *
 * Measured over 483 real alignments from both engines — 3532 boundaries, five papers: **2 moved,
 * both onto the sentence end they had missed, 0 correct boundaries touched, and no sentence left
 * without visible text** (the count of those stayed at its baseline of 36).
 */
function snapAlignment(alignment: SentenceAlignment, sourceText: string, targetText: string): SentenceAlignment {
  const snapSide = (lengths: readonly number[], text: string): number[] => {
    const cuts: number[] = []
    let at = 0
    for (const n of lengths.slice(0, -1)) {
      at += n
      cuts.push(at)
    }
    const moved = cuts.map(cut => {
      if (settled(text, cut)) {
        // 已经落在句末标点后，但可能停在多字符终止标点的中间：`甲。|”乙` 里那个引号属于上一句
        //（Codex 在 #145 指出）。只跨收尾标点，跨不到别的东西上
        let end = cut
        while (end + 1 < text.length && CLOSER.test(text[end] ?? '') && settled(text, end + 1)) end++
        return end
      }
      for (let step = 1; step <= SNAP_WINDOW; step++) {
        if (cut - step > 0 && snappable(text, cut - step)) return cut - step
        if (cut + step < text.length && snappable(text, cut + step)) {
          // Past the *whole* terminator, not its first character: `。”` and `...` are one ending, and
          // stopping inside leaves the rest of it opening the next sentence (Codex on #145)
          let end = cut + step
          while (end + 1 < text.length && snappable(text, end + 1)) end++
          return end
        }
      }
      return cut
    })
    // **要么全用、要么全不用。** 逐个回退会让结果取决于迭代顺序：前一个因为撞上邻居被退回原位，
    // 后一个再拿这个**已经退回**的值当邻居去校验，于是两个候选吸到同一个标点上时会切出
    // `[1, 2, 4]` 这种错位（Codex 在 #145 指出）。对着候选的快照整体校验一次，不满足就整侧不动
    const ok = moved.every((cut, i) => {
      const low = moved[i - 1] ?? 0
      const high = moved[i + 1] ?? text.length
      return cut > low && cut < high && visible(text.slice(low, cut)) && visible(text.slice(cut, high))
    })
    if (!ok) return [...lengths]
    const out: number[] = []
    let prev = 0
    for (const cut of moved) {
      out.push(cut - prev)
      prev = cut
    }
    out.push(text.length - prev)
    return out
  }
  return { source: snapSide(alignment.source, sourceText), target: snapSide(alignment.target, targetText) }
}

export function verifyAlignment(
  alignment: SentenceAlignment | undefined,
  sourceText: string,
  targetText: string,
): SentenceAlignment | undefined {
  if (!alignment) return undefined
  const { source, target } = alignment
  if (source.length === 0 || source.length !== target.length) return undefined
  if (source.some(n => !Number.isInteger(n) || n <= 0) || target.some(n => !Number.isInteger(n) || n <= 0)) return undefined
  const sum = (ns: readonly number[]) => ns.reduce((a, b) => a + b, 0)
  if (sum(source) !== sourceText.length || sum(target) !== targetText.length) return undefined
  // Snapping after the checks, not before: it only ever moves a boundary inside the text it was
  // already verified against, so the partition it returns is exact by construction.
  return snapAlignment(alignment, sourceText, targetText)
}

/** One sentence as a pair of wire intervals, ready to be turned into ranges. */
export interface SentencePair {
  index: number
  source: { from: number; to: number }
  target: { from: number; to: number }
}

/** Expands an alignment into per-sentence intervals. Assumes it already passed `verifyAlignment`. */
export function sentencePairs(alignment: SentenceAlignment): SentencePair[] {
  const src = boundariesOf(alignment.source)
  const tgt = boundariesOf(alignment.target)
  return alignment.source.map((_, i) => ({
    index: i,
    source: { from: src[i]!, to: src[i + 1]! },
    target: { from: tgt[i]!, to: tgt[i + 1]! },
  }))
}
