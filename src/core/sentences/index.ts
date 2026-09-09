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
/**
 * Placeholder syntax as it appears in wire text. `tags` wraps inline markup in `<t id="N">` … `</t>`
 * pairs and formulas in `<x id="N"/>`; `markers` uses `@abc#`.
 */
const PLACEHOLDER = /<x\s+id="\d+"\/>|<\/?t(?:\s+id="\d+")?>|@[a-z]+#/g

/** A `<t>` or `</t>` run: structural wrapping around inline markup, standing for no content itself */
const STRUCTURAL = /^<\/?t(?:\s+id="\d+")?>$/

/**
 * What a void placeholder projects to. It stands for real content — a formula, a link — so it has to
 * read as a word, not as space: a sentence opening on a formula and continuing in lowercase, as in
 * "@a# is continuous", loses its boundary entirely when the formula becomes whitespace, because
 * Intl.Segmenter takes the lowercase word for a continuation. Measured: that cut disappeared.
 *
 * Two characters, not one capital: `X.` would match the single-initial rule in ABBR and merge the
 * sentence into the next one instead.
 */
const VOID_TOKEN = 'Xx' 

/**
 * Segmenting the wire text directly hides sentence ends that sit against a placeholder. A run-in
 * heading serialises as `<t id="1">Motivation.</t> Concurrent programs …`, and `Intl.Segmenter`
 * sees `.` followed by `<` rather than by whitespace, so it reports no boundary at all — measured,
 * and `tests/fixtures/arxiv/2312.17527.html` alone has 18 run-in headings. The earlier comparison
 * against Microsoft ran on `markers`, which flattens pairs away, so it never exercised this.
 *
 * So segment a projection where every placeholder becomes a single space, then map the cuts back.
 * A space is the right substitute: it cannot create a sentence end that the text does not have, and
 * it lets a real one next to a placeholder be seen.
 */
function project(text: string): { visible: string; toWire: number[] } {
  let visible = ''
  // toWire[i] is the wire offset that visible offset i starts at
  const toWire: number[] = []
  let at = 0
  PLACEHOLDER.lastIndex = 0
  for (const m of text.matchAll(PLACEHOLDER)) {
    const index = m.index ?? 0
    for (let i = at; i < index; i++) {
      toWire.push(i)
      visible += text[i]
    }
    // Structural tags carry no content, so a space is right for them; a void placeholder stands for
    // content and has to read as a word. Every projected character maps back to where the run began.
    const token = STRUCTURAL.test(m[0]) ? ' ' : VOID_TOKEN
    for (let i = 0; i < token.length; i++) toWire.push(index)
    visible += token
    at = index + m[0].length
  }
  for (let i = at; i < text.length; i++) {
    toWire.push(i)
    visible += text[i]
  }
  toWire.push(text.length)
  return { visible, toWire }
}

/**
 * Sentence lengths, in order, summing exactly to `text.length`.
 *
 * The exact partition is the contract: `verifyAlignment` rejects anything that does not reconstruct
 * the text it describes, so a splitter that lost or duplicated a character would simply produce no
 * highlight. Returns a single length for text with no interior boundary.
 */
export function splitSentences(text: string): number[] {
  if (text.length === 0) return []
  const cuts = sentenceCuts(text)
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
export function sentenceCuts(text: string): number[] {
  if (text.length === 0) return []
  const { visible, toWire } = project(text)
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
    const wire = toWire[at] ?? text.length
    // A cut landing where a placeholder starts is fine; one that would not advance is dropped
    if (wire > (cuts[cuts.length - 1] ?? 0) && wire < text.length) cuts.push(wire)
  }
  return cuts
}
