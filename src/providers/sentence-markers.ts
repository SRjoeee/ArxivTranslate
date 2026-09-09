// Sentence alignment for engines that do not report their own (issue #105).
//
// Microsoft returns `sentLen` and an LLM can report boundaries through its schema. Google reports
// nothing, so the boundaries have to be *put into* the request and read back out: split the wire
// text ourselves (`@/core/sentences`), insert a marker at each cut, and find where the markers
// landed in the translation.
//
// **The marker is `<x id="N"/>` — the void placeholder the `tags` protocol already uses.** Measured
// against the live endpoint before writing any of this, sending four sentences separated by three
// markers:
//
// | marker | sent | returned | placed |
// |---|---|---|---|
// | `<x id="N"/>` | 3 | **3** | exactly at the sentence boundaries |
// | `<s id="N"/>` | 3 | 3 | kept, but Google appends `</s></s></s>` |
// | `<wbr id="N">` | 3 | **0** | dropped entirely |
//
// So the shape we already rely on is the one that works, and nothing new has to survive
// translation. Ids are allocated above every id the block itself uses, so a marker can never be
// mistaken for one of the block's own placeholders.
//
// **Why not just count sentences on both sides.** Splitting the translation with `Intl.Segmenter`
// and pairing by position needs no protocol at all, and was measured first: over 37 real blocks the
// counts agreed on 67.6% — but on the blocks that matter, the ones with more than one sentence,
// only **8 of 20 (40%)**. Chinese output splits clauses the English source did not. That is too
// little coverage for the blocks the highlight exists for.
//
// Anything that does not come back exactly right produces no alignment, and no alignment costs only
// the highlight (`alignment.ts`).

import { sentenceCuts } from '@/core/sentences'

/** `<x id="N"/>`, the same void placeholder `serialize` writes. */
const MARKER = (id: number) => `<x id="${id}"/>`
const ID_IN_TEXT = /<[xt]\s+id="(\d+)"/g

/** One id above everything the block uses, so a marker is never confused with the block's own. */
function firstFreeId(text: string): number {
  let max = 0
  for (const m of text.matchAll(ID_IN_TEXT)) max = Math.max(max, Number(m[1]))
  return max + 1
}

export interface MarkedText {
  /** What to send */
  text: string
  /** Sentence lengths of the original text, in order */
  source: number[]
  /** The marker ids in the order they were inserted */
  ids: number[]
}

/**
 * Splits `text` into sentences and returns it with a marker at each interior boundary.
 *
 * Only ever called for the `tags` render path: `markers` has no marker that survives translation,
 * and `runs` sends fragments of a block that `joinRuns` reassembles without wire offsets, so an
 * alignment there would have nothing to attach to. Returns undefined for a single sentence, and the
 * caller then sends the text unchanged.
 */
export function markSentences(text: string): MarkedText | undefined {
  const cuts = sentenceCuts(text, 'tags')
  if (cuts.length === 0) return undefined

  const first = firstFreeId(text)
  const ids = cuts.map((_, i) => first + i)
  const source: number[] = []
  let out = ''
  let prev = 0
  cuts.forEach((cut, i) => {
    out += text.slice(prev, cut) + MARKER(ids[i]!)
    source.push(cut - prev)
    prev = cut
  })
  out += text.slice(prev)
  source.push(text.length - prev)
  return { text: out, source, ids }
}

/**
 * Removes the markers from a translation and reports the sentence lengths they delimit.
 *
 * Returns undefined unless every marker came back exactly once and in the order it was sent. A
 * dropped or reordered marker means the boundaries cannot be trusted, and a wrong boundary puts the
 * highlight on the wrong sentence — worse than no highlight at all.
 */
export function unmarkSentences(translated: string, ids: readonly number[]): { text: string; target: number[] } | undefined {
  const target: number[] = []
  let text = ''
  let at = 0
  for (const id of ids) {
    const marker = MARKER(id)
    const found = translated.indexOf(marker, at)
    if (found < 0) return undefined
    // A second copy of the same marker makes "where the boundary is" ambiguous
    if (translated.indexOf(marker, found + marker.length) >= 0) return undefined
    text += translated.slice(at, found)
    target.push(found - at)
    at = found + marker.length
  }
  text += translated.slice(at)
  target.push(translated.length - at)
  // An engine that returned an empty sentence has not given us a usable partition
  if (target.some(n => n <= 0)) return undefined
  return { text, target }
}

/**
 * Removes every marker, wherever it ended up, without claiming to know the boundaries.
 *
 * The fallback for a translation `unmarkSentences` refused. There is no alignment to be had from
 * it, but the text still has to be cleaned: a leftover `<x id="N"/>` would reach `validate`, which
 * would see a placeholder the block has no slot for and fail the whole block — trading a missing
 * highlight for a missing translation.
 */
export function stripMarkers(translated: string, ids: readonly number[]): string {
  let text = translated
  for (const id of ids) text = text.split(MARKER(id)).join('')
  return text
}
