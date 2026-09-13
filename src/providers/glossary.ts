// The glossary's text form and its structured form, both ways (DESIGN §8.2).
// The shape follows KISS's parseAITerms (reference/kiss-translator/src/libs/utils.js@c95bd46): one entry per line,
// comma-separated; added here: tabs (for pasting from a table), comment lines and per-line issue reports — a
// paper's terms are usually pasted in as a whole, and silently dropping a miswritten line would leave the reader believing the term took effect.
export interface GlossaryEntry {
  term: string
  translation: string
}

export interface GlossaryIssue {
  /** From 1, the line number the reader sees in the text box */
  line: number
  text: string
  /** Which kind of issue; the sentences live in the locale pack, and this layer knows no interface language (Codex on #161 for the same class of problem) */
  reason: 'noSeparator' | 'emptySource' | 'emptyTarget'
}

export interface ParsedGlossary {
  entries: GlossaryEntry[]
  issues: GlossaryIssue[]
}

/** The first comma (ASCII or full-width) or tab in a line separates: the translation may itself hold commas, so one cut only */
const SEPARATOR = /[,，\t]/

/**
 * Parse glossary text. Blank lines and lines starting with `#` are skipped; a later entry of the same term overrides
 * the earlier while keeping the order of **first appearance**, so changing one translation does not move it to the end
 */
export function parseGlossary(text: string): ParsedGlossary {
  const entries: GlossaryEntry[] = []
  const issues: GlossaryIssue[] = []
  const index = new Map<string, number>()

  // One entry per line. **The semicolon is no separator**: a semicolon inside a translation is normal (`kernel, 核;
  // 统计学中称核函数`), and as a record separator it would quietly split it into two unrelated mappings (Codex on #52). DESIGN §8.2 says per line too
  const lines = text.split('\n')
  let lineNumber = 0
  for (const rawLine of lines) {
    lineNumber++
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = SEPARATOR.exec(line)
    if (!match) {
      issues.push({ line: lineNumber, text: line, reason: 'noSeparator' })
      continue
    }
    const term = line.slice(0, match.index).trim()
    const translation = line.slice(match.index + 1).trim()
    if (term === '') {
      issues.push({ line: lineNumber, text: line, reason: 'emptySource' })
      continue
    }
    if (translation === '') {
      issues.push({ line: lineNumber, text: line, reason: 'emptyTarget' })
      continue
    }
    const existing = index.get(term)
    if (existing === undefined) {
      index.set(term, entries.length)
      entries.push({ term, translation })
    } else {
      entries[existing] = { term, translation }
    }
  }
  return { entries, issues }
}

/** Written back into the text box's form, one entry per line */
export function formatGlossaryText(entries: readonly GlossaryEntry[]): string {
  return entries.map(entry => `${entry.term}, ${entry.translation}`).join('\n')
}

/**
 * Only the terms **this passage really uses** are sent (DESIGN §8.2, 2026-09-11).
 *
 * Every batch used to carry the whole table: 50 terms are about 300 tokens against a batch of about 1000 characters
 * of text — the request could double, the model's attention went to a heap of words unrelated to the passage, and
 * the cache key carried the whole table (one term changed, the whole site's cache void). Matched: a request carries
 * the few relevant terms, and the cache key changes only when a term **in use** changes.
 *
 * The pitfalls of matching were taken lesson by lesson from Read Frog's `utils/glossary/matcher.ts` (they shipped two
 * fixes for them), but not its implementation: they run over 20 000 terms with one compiled giant alternation plus
 * an index; our scale is the few dozen terms one reader lists for one paper, a term-by-term scan is enough, and an
 * order of magnitude less code is one class of bug fewer.
 *
 * The lessons taken:
 * - **Whitespace inside a term means “any whitespace”**: the reader typed `neural network` with one space; the page
 *   may have two, a soft line break, a no-break space (all over HTML). Compiled to `\s+` it matches
 * - **NFC on both sides first**: `café` has a one-code-point and a two-code-point spelling, alike to the eye, unequal compared
 * - **Word boundaries by script**: `net` must not hit `network`, but there are no spaces between Chinese characters
 *   anyway, and demanding a boundary for them means never matching
 * - **Order by the glossary, not by position**: the same set of terms in different passages has to render as the same prompt, or the cache key fragments by order of appearance
 */
export interface GlossaryMatcher {
  /** The terms this text uses, in the glossary's order */
  match(text: string): GlossaryEntry[]
  size: number
}

/**
 * Scripts written without word spaces: no word boundary is demanded on that side. Beyond Chinese characters, kana
 * and Thai, the target-language table also has Khmer (khm), Lao (lao), Burmese (mya) and Tibetan (bod), written
 * unspaced too — without them a term of those languages inside body text would never match (Codex on #163)
 */
const SCRIPTS_WITHOUT_SPACES = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Khmer}\p{Script=Lao}\p{Script=Myanmar}\p{Script=Tibetan}]/u
/** Characters that count as “inside a word”: two word characters side by side are no boundary */
const WORD_CHAR = /[\p{L}\p{N}_]/u

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether a boundary is demanded on this side: only when the term's edge character is a word character of a script with word spaces */
const needsBoundary = (edge: string | undefined): boolean =>
  edge !== undefined && WORD_CHAR.test(edge) && !SCRIPTS_WITHOUT_SPACES.test(edge)

export function createGlossaryMatcher(entries: readonly GlossaryEntry[]): GlossaryMatcher {
  const compiled = entries
    .map(entry => ({ entry, source: entry.term.normalize('NFC').replace(/\s+/g, ' ').trim() }))
    .filter(({ source }) => source !== '')
    .map(({ entry, source }) => ({
      entry,
      // Whitespace inside the term → `\s+`; `g` so every hit's position is boundary-checked
      pattern: new RegExp(source.split(' ').map(escapeRegExp).join('\\s+'), 'giu'),
      left: needsBoundary(source[0]),
      right: needsBoundary(source[source.length - 1]),
    }))

  return {
    size: compiled.length,
    match(rawText: string): GlossaryEntry[] {
      if (rawText === '' || compiled.length === 0) return []
      const text = rawText.normalize('NFC')
      const out: GlossaryEntry[] = []
      for (const { entry, pattern, left, right } of compiled) {
        pattern.lastIndex = 0
        let hit = pattern.exec(text)
        while (hit !== null) {
          const before = text[hit.index - 1]
          const after = text[hit.index + hit[0].length]
          // Boundaries are demanded by the term's own ends only: `net` does not enter `network`, while `C++`, `(a)` and the like ending in symbols match as usual
          if ((!left || before === undefined || !WORD_CHAR.test(before)) && (!right || after === undefined || !WORD_CHAR.test(after))) {
            out.push(entry)
            break
          }
          // A hit with the wrong boundary: continue from the next character, not to miss the real one further on
          pattern.lastIndex = hit.index + 1
          hit = pattern.exec(text)
        }
      }
      return out
    },
  }
}
