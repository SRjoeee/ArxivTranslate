// Sentence splitting for engines that do not report their own boundaries (issue #105).
//
// Microsoft returns `sentLen` and an LLM can report boundaries through its schema, so neither needs
// this. Google has nothing of the kind: aligning sentences there means choosing the boundaries
// ourselves and injecting markers at them, which is the only reason this module exists.
//
// It runs on **wire text**, after `serialize`. That is what makes it viable: formulas are already
// placeholders, so `f(x) = 0.5` cannot be mistaken for a sentence end, and the only remaining
// hazard is abbreviations.
//
// Measured against Microsoft's `srcSentLen` over 60 real blocks (see the `experiment/
// sentence-alignment` branch): 98.4% precision and 91.7% recall overall, and **100% precision** once
// bibliography blocks are excluded — both spurious cuts there were journal abbreviations such as
// `Sci. Rep. 14 (2024)`. What remains is under-splitting, 13 of 146, which makes a highlight span
// two sentences instead of one. Over-splitting, which would put a highlight on half a sentence,
// does not occur. Callers must not run this on reference blocks (§5.4 excludes them anyway).
//
// `Sci` and `Rep` were added after that measurement, which is why it saw those two cuts. Extending
// this list can only *remove* cut points, so precision cannot fall: removing a wrong cut raises it,
// removing a right one lowers recall instead. Checked offline over all 3210 fixture blocks — the
// larger list removes 5 cuts and adds none, and all 5 are journal abbreviations in bibliographies
// (`Theor. Comput. Sci.`, `J. Fac. Sci. Univ. Tokyo`, `Sci. Rep. 14`).

/**
 * A period after one of these does not end a sentence. Single capitals cover initials (`A. Turing`)
 * and the journal-volume style that produced the only failures measured; the rest are the
 * abbreviations that actually appear in arXiv prose and bibliographies.
 */
const ABBR =
  /\b(?:[A-Z]|Fig|Figs|Eq|Eqs|Sec|Secs|Ref|Refs|Thm|Def|Lem|Prop|Cor|Rev|Phys|Lett|Nucl|Astron|Astrophys|Mon|Not|Proc|Conf|Int|J|vs|etc|cf|al|approx|resp|Dr|Prof|St|No|Vol|pp|Ed|Eds|Sci|Rep|e\.g|i\.e)\.$/

/**
 * Sentence lengths, in order, summing exactly to `text.length`.
 *
 * The exact partition is the contract: `verifyAlignment` rejects anything that does not reconstruct
 * the text it describes, so a splitter that lost or duplicated a character would simply produce no
 * highlight. Returns a single length for text with no interior boundary.
 */
export function splitSentences(text: string): number[] {
  if (text.length === 0) return []
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const pieces: string[] = []
  for (const { segment } of segmenter.segment(text)) {
    const prev = pieces[pieces.length - 1]
    // The previous piece ended on an abbreviation, so the boundary between them is spurious.
    if (prev !== undefined && ABBR.test(prev.trimEnd())) pieces[pieces.length - 1] = prev + segment
    else pieces.push(segment)
  }
  return pieces.map(piece => piece.length)
}

/** Cut points inside the text, i.e. the boundaries between sentences, excluding 0 and `length`. */
export function sentenceCuts(text: string): number[] {
  const lengths = splitSentences(text)
  const cuts: number[] = []
  let at = 0
  for (let i = 0; i < lengths.length - 1; i++) {
    at += lengths[i]!
    cuts.push(at)
  }
  return cuts
}
