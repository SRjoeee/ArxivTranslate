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
  return alignment
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
