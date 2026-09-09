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

import { TAG_RE } from '@/core/protector'

/** `<x id="N"/>`, the same void placeholder `serialize` writes. */
const MARKER = (id: number) => `<x id="${id}"/>`

/** The id of a `<x id="N"/>` this occurrence of `TAG_RE` matched, or undefined for anything else. */
function voidIdOf(m: RegExpMatchArray): number | undefined {
  const raw = m[1] ?? m[2] ?? m[3]
  return raw === undefined ? undefined : Number(raw)
}

/** One id above everything the block uses, so a marker is never confused with the block's own. */
function firstFreeId(text: string): number {
  let max = 0
  TAG_RE.lastIndex = 0
  for (const m of text.matchAll(TAG_RE)) {
    for (const raw of [m[1], m[2], m[3], m[4], m[5], m[6]]) if (raw !== undefined) max = Math.max(max, Number(raw))
  }
  return max + 1
}

/**
 * Every occurrence of one of our marker ids, however it is spelled.
 *
 * Matching the exact string we generated is not enough. An LLM can hand back `<x id="1" />` or
 * `<x id='1'/>`, which `TAG_RE` — and therefore `validate` — recognises as the same placeholder,
 * so a variant that slips past here reaches validation as a placeholder the block has no slot for
 * and fails the whole block (Codex pointed this out on #137). What counts as a marker is decided
 * by the same regex the protector uses, not by our own spelling of it.
 */
function occurrences(text: string, ids: ReadonlySet<number>): { at: number; length: number; id: number }[] {
  const out: { at: number; length: number; id: number }[] = []
  TAG_RE.lastIndex = 0
  for (const m of text.matchAll(TAG_RE)) {
    const id = voidIdOf(m)
    if (id !== undefined && ids.has(id)) out.push({ at: m.index ?? 0, length: m[0].length, id })
  }
  return out
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
 * Puts a marker at each of the given cuts.
 *
 * **The cuts come from the caller**, not from calling the splitter here. Choosing them needs the
 * block: `sentenceCuts` takes a `SplitContext` built from its placeholder slots to tell an
 * annotation from a formula, and its measured precision explicitly excludes bibliography blocks,
 * which callers must not run it on. None of that is knowable from wire text alone (Codex pointed
 * both out on #137), so the decision belongs in the pipeline and only the mechanism lives here.
 *
 * Only ever called for the `tags` render path: `markers` has no marker that survives translation,
 * and `runs` sends fragments of a block that `joinRuns` reassembles without wire offsets, so an
 * alignment there would have nothing to attach to. Returns undefined for a single sentence, and the
 * caller then sends the text unchanged.
 */
export function markSentences(text: string, cuts: readonly number[]): MarkedText | undefined {
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
  const wanted = new Set(ids)
  const found = occurrences(translated, wanted)
  // Exactly one of each, in the order they were sent. Anything else and the boundaries cannot be
  // trusted, and a wrong boundary puts the highlight on the wrong sentence — worse than none.
  if (found.length !== ids.length) return undefined
  if (found.some((f, i) => f.id !== ids[i])) return undefined

  const target: number[] = []
  let text = ''
  let at = 0
  for (const f of found) {
    text += translated.slice(at, f.at)
    target.push(f.at - at)
    at = f.at + f.length
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
  const found = occurrences(translated, new Set(ids))
  if (found.length === 0) return translated
  let text = ''
  let at = 0
  for (const f of found) {
    text += translated.slice(at, f.at)
    at = f.at + f.length
  }
  return text + translated.slice(at)
}
