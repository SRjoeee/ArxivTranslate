// Convert glossaries between text and structured forms (DESIGN §8.2).
// Based on KISS parseAITerms (reference/kiss-translator/src/libs/utils.js@c95bd46): one comma-separated entry per line.
// Adds tabs (for pasting from spreadsheets), comment lines and errors with line numbers. Paper glossaries are often pasted in bulk;
// silently discarding a malformed line would make users think the term was applied.
export interface GlossaryEntry {
  term: string
  translation: string
}

export interface GlossaryIssue {
  /** One-based line number, matching what the user sees in the text box. */
  line: number
  text: string
  reason: string
}

export interface ParsedGlossary {
  entries: GlossaryEntry[]
  issues: GlossaryIssue[]
}

/** Split on the first comma (ASCII or full-width) or tab only: the translation itself may contain commas. */
const SEPARATOR = /[,，\t]/

/**
 * Parse glossary text, skipping blank lines and comments starting with `#`.
 * Later entries override the same term, preserving its **first occurrence** order so editing a translation does not move it to the end.
 */
export function parseGlossary(text: string): ParsedGlossary {
  const entries: GlossaryEntry[] = []
  const issues: GlossaryIssue[] = []
  const index = new Map<string, number>()

  // One entry per line. **Semicolons are not separators**: translations may contain them (`kernel, core; a statistical kernel`).
  // Treating them as record separators silently creates two unrelated mappings (Codex #52). DESIGN §8.2 also specifies line separation.
  const lines = text.split('\n')
  let lineNumber = 0
  for (const rawLine of lines) {
    lineNumber++
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const match = SEPARATOR.exec(line)
    if (!match) {
      issues.push({ line: lineNumber, text: line, reason: 'Missing separator; use "source, translation"' })
      continue
    }
    const term = line.slice(0, match.index).trim()
    const translation = line.slice(match.index + 1).trim()
    if (term === '') {
      issues.push({ line: lineNumber, text: line, reason: 'Source term is empty' })
      continue
    }
    if (translation === '') {
      issues.push({ line: lineNumber, text: line, reason: 'Translation is empty' })
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

/** Format for the text box, one entry per line. */
export function formatGlossaryText(entries: readonly GlossaryEntry[]): string {
  return entries.map(entry => `${entry.term}, ${entry.translation}`).join('\n')
}
