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

import { fromAlpha, type WireFormat } from '@/core/protector'

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
/**
 * Placeholder syntax as it appears in wire text. `tags` wraps inline markup in `<t id="N">` … `</t>`
 * pairs and formulas in `<x id="N"/>`; `markers` uses `@abc#`.
 *
 * `@@` comes first, as in the protector's own tokenizer: that is how serialisation escapes a literal
 * `@`, and matching markers first reads the second `@` of `@@a#` as a placeholder and cuts a
 * sentence in the middle of ordinary text (Codex on #126).
 */
const TAGS_PLACEHOLDER = /<x\s+id="\d+"\/>|<\/?t(?:\s+id="\d+")?>/g
const MARKERS_PLACEHOLDER = /@@|@[a-z]+#/g

/**
 * The two formats use disjoint syntax, and reading one as the other invents boundaries in ordinary
 * text: `escapeText` leaves a literal `@` alone on the `tags` path, so `Done. @a# is a literal.`
 * would be projected as a placeholder there (Codex on #126). The caller knows which format it
 * serialised with, so it says.
 */
const placeholderRe = (format: WireFormat) => (format === 'markers' ? MARKERS_PLACEHOLDER : TAGS_PLACEHOLDER)

/** The slot id a placeholder run refers to, so its semantics can be looked up. */
function idOf(run: string): number | undefined {
  const tag = /id="(\d+)"/.exec(run)
  if (tag) return Number(tag[1])
  const marker = /^@([a-z]+)#$/.exec(run)
  return marker ? fromAlpha(marker[1]!) : undefined
}

/** A `<t>` or `</t>` run: structural wrapping around inline markup, standing for no content itself */
const STRUCTURAL = /^<\/?t(?:\s+id="\d+")?>$/
const OPENING = /^<t(?:\s+id="\d+")?>$/

const VOID_TOKEN = 'Xx'

/**
 * Whether the placeholder with this id annotates the text before it — a footnote or a citation —
 * rather than being content of its own.
 *
 * **This cannot be decided from the wire text.** Three rounds of review found counterexamples to
 * guessing it from the following word's case: `… method@a#. @b# We require …` is a footnote, while
 * `… relation@a#. @b# Let @c# …` is a formula opening a sentence, and both read as "punctuation,
 * placeholder, capitalised word" (Codex on #126). The caller has `classify()` for every slot, so it
 * answers rather than the splitter guessing.
 *
 * Without one, every placeholder counts as content: a sentence opening on a formula keeps its
 * boundary, and a trailing footnote lands one placeholder late.
 */
export type IsAnnotation = (id: number) => boolean

/**
 * Segmenting the wire text directly hides sentence ends that sit against a placeholder. A run-in
 * heading serialises as `<t id="1">Motivation.</t> Concurrent programs …`, and `Intl.Segmenter` sees
 * `.` followed by `<` rather than by whitespace, so it reports no boundary at all — measured, and
 * `tests/fixtures/arxiv/2312.17527.html` alone has 18 run-in headings.
 *
 * So segment a projection where each placeholder becomes whitespace, except a void that opens a
 * sentence, which becomes a word so the boundary stays visible.
 */
function project(text: string, format: WireFormat, isAnnotation?: IsAnnotation): { visible: string; toWire: number[]; openEnds: Map<number, number> } {
  let visible = ''
  // toWire[i] is the wire offset that visible offset i starts at
  const toWire: number[] = []
  // wire offset just past an opening tag -> where that tag starts
  const openEnds = new Map<number, number>()
  let at = 0
  const re = placeholderRe(format)
  re.lastIndex = 0
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0
    for (let i = at; i < index; i++) {
      toWire.push(i)
      visible += text[i]
    }
    const run = m[0]
    const after = index + run.length
    let token: string
    if (run === '@@') {
      // An escaped literal `@`: ordinary text, not a placeholder, so it projects as itself
      token = '@'
    } else if (STRUCTURAL.test(run)) {
      token = ' '
      if (OPENING.test(run)) openEnds.set(after, index)
    } else {
      // An annotation belongs to the text before it and must not open a sentence; content has to
      // read as a word so a sentence starting on a formula keeps its boundary.
      const id = idOf(run)
      token = id !== undefined && isAnnotation?.(id) ? ' ' : VOID_TOKEN
    }
    for (let i = 0; i < token.length; i++) toWire.push(index)
    visible += token
    at = after
  }
  for (let i = at; i < text.length; i++) {
    toWire.push(i)
    visible += text[i]
  }
  toWire.push(text.length)
  return { visible, toWire, openEnds }
}

/**
 * Sentence lengths, in order, summing exactly to `text.length`.
 *
 * The exact partition is the contract: `verifyAlignment` rejects anything that does not reconstruct
 * the text it describes, so a splitter that lost or duplicated a character would simply produce no
 * highlight. Returns a single length for text with no interior boundary.
 */
export function splitSentences(text: string, format: WireFormat = 'tags', isAnnotation?: IsAnnotation): number[] {
  if (text.length === 0) return []
  const cuts = sentenceCuts(text, format, isAnnotation)
  const lengths: number[] = []
  let prev = 0
  for (const cut of cuts) {
    lengths.push(cut - prev)
    prev = cut
  }
  lengths.push(text.length - prev)
  return lengths
}

/** Cut points inside the text, i.e. the boundaries between sentences, excluding 0 and `length`. */
export function sentenceCuts(text: string, format: WireFormat = 'tags', isAnnotation?: IsAnnotation): number[] {
  if (text.length === 0) return []
  const { visible, toWire, openEnds } = project(text, format, isAnnotation)
  const segmenter = new Intl.Segmenter('en', { granularity: 'sentence' })
  const pieces: string[] = []
  for (const { segment } of segmenter.segment(visible)) {
    const prev = pieces[pieces.length - 1]
    // The previous piece ended on an abbreviation, so the boundary between them is spurious.
    if (prev !== undefined && ABBR.test(prev.trimEnd())) pieces[pieces.length - 1] = prev + segment
    else pieces.push(segment)
  }
  const cuts: number[] = []
  let at = 0
  for (let i = 0; i < pieces.length - 1; i++) {
    at += pieces[i]!.length
    let wire = toWire[at] ?? text.length
    // A cut can land just past an opening tag, which leaves `<t id="N">` at the end of one sentence
    // and its content plus `</t>` in the next — the pair split across two. Walk back over any
    // opening tag ending here, and over whitespace that the segmenter took as the tag's trailing
    // space when the wrapped content itself starts with a space (Codex on #126).
    for (;;) {
      if (openEnds.has(wire)) {
        wire = openEnds.get(wire)!
        continue
      }
      const back = wire - 1
      if (back > 0 && /[\t\n\f\r ]/.test(text[back] ?? '') && openEnds.has(back)) {
        wire = back
        continue
      }
      break
    }
    // A cut landing where a placeholder starts is fine; one that would not advance is dropped
    if (wire > (cuts[cuts.length - 1] ?? 0) && wire < text.length) cuts.push(wire)
  }
  return cuts
}
