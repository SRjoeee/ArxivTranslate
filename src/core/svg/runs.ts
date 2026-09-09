// Which runs of a figure are worth translating (issue #121).
//
// `isTranslatable` in `@/core/image` already removes the numeric ticks — it wants two consecutive
// letters and no numeric cell. What is left in a plot is labels, and in a listing figure it is
// source code, which this rejects.
//
// **Why code is skipped.** DESIGN §5 skips `<pre>` and code blocks in the HTML; a listing drawn as
// a figure is the same content, and translating it would be wrong for the same reasons. It also
// happens to sidestep the one place where the glyph data is lossy: a syntax-highlighted listing
// drops the space between two differently coloured spans, so `if log_counting` arrives as
// `iflog_counting` (`docs/RESEARCH.md` §6.11). Recovering those spaces needs a per-run advance
// estimate, and skipping code means not needing it.
//
// The rules were written against the runs the two fixtures actually produce, and the test asserts
// the whole corpus both ways. They lean towards keeping: a label wrongly dropped is a reader's
// figure left untranslated, while a code line wrongly kept is one odd-looking line.

/**
 * Two or more of these reads as code.
 *
 * **No brackets of any kind are in the set**, and every exclusion was forced by a real label.
 * `wall time per epoch [ms]` and `Energy (GeV)` carry units. A rule for "the parenthesis touches
 * the name, so it is a call" looked safe and was not: measured over 428 translatable runs it was
 * the *only* thing rejecting 11 of them, and all 11 were legends — `LZwindow55–270keV(oneevent)`,
 * `conservativesolarceiling(thermalized)`, `ΓN/log(N)` (Codex pointed this out on #134). It also
 * turned out to be catching nothing: with it removed, every one of the fixture's 27 source lines is
 * still rejected by the rules below.
 */
const BRACES = /[{};]/g

/** Operators that do not occur in prose */
const OPERATORS = /->|=>|==|!=|::|>>|<<|&&|\|\|/

/** `hash_length`, `uint32_t`: an underscore joining word characters */
const SNAKE_CASE = /\w_\w/

/** A statement end, even when everything else about the line looks like words (`inti;`) */
const STATEMENT_END = /[;{}]\s*$/

/** A listing's line-number gutter that merged into the code beside it (`1   staticint`) */
const GUTTER = /^\d+\s{2,}/

/**
 * Whether a run is source code rather than prose.
 *
 * Any one signal is enough. They overlap heavily on real listings — most lines trip three or four —
 * which is what makes the set robust to a single rule being wrong about an unusual label.
 */
export function looksLikeCode(text: string): boolean {
  const trimmed = text.trim()
  if (trimmed === '') return false
  if (GUTTER.test(trimmed)) return true
  if (OPERATORS.test(trimmed)) return true
  if (SNAKE_CASE.test(trimmed)) return true
  if (STATEMENT_END.test(trimmed)) return true
  return (trimmed.match(BRACES) ?? []).length >= 2
}
