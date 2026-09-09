import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CLAUDE.md hard rule 2: ltx_* selectors belong only in src/core/rules/latexml.ts.
// Other TypeScript modules use that rule module; only src/styles/*.css may use them for declarative layout.
// This formerly documentation-only rule allowed five selectors to accumulate in renderer/side-layout.ts (Codex #22).

const SRC = join(import.meta.dirname, '../../src')
const RULES_MODULE = join(SRC, 'core/rules/latexml.ts')

/**
 * Strip comments but preserve strings. Regex alone is unsafe (Codex #79):
 * a slash-star comment regex mistakes the wildcard in https://arxiv.org/html/* for a block-comment opener,
 * consuming through the next terminator. In the 240-line content/index.ts, lines 18–37 disappeared,
 * including defineContentScript and initialization, leaving a 20-line hole in the guard.
 *
 * This state machine identifies real comments and retains strings, including templates, where selectors are written.
 * Regex literals need no separate handling here: reading slash as division still retains their ltx_ text, as required;
 * a regex ending in star-slash is not a comment opener because its opening slash is followed by neither star nor slash.
 */
/** A slash after these keywords begins a regex rather than division */
const EXPR_KEYWORDS = ['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'yield', 'await', 'delete', 'void', 'new', 'throw']
/** Closing these control-statement parentheses also expects an expression, as in if (ready) /re/.test(x) */
const CONTROL_KEYWORDS = ['if', 'while', 'for', 'switch', 'catch', 'with']

const wordBefore = (out: string) => /[A-Za-z$_][A-Za-z0-9$_]*$/.exec(out.trimEnd())?.[0]

/**
 * Strip comments but preserve strings. Regex alone is unsafe (Codex #79):
 * a slash-star comment regex mistakes the wildcard in https://arxiv.org/html/* for a block-comment opener,
 * consuming through the next terminator. In the 240-line content/index.ts, lines 18–37 disappeared,
 * including defineContentScript and initialization, leaving a 20-line hole in the guard.
 *
 * Real comment detection must first recognize regex literals, whose character classes can contain slash-star.
 * A slash begins a regex where an expression is expected: after punctuation, arrows, return-like keywords,
 * or closing parentheses of control statements such as if and while. mirror.ts uses return followed by a regex.
 * Codex #79 / #81 found these cases across three rounds, so track which construct owns each parenthesis rather than just the previous character.
 *
 * Heuristics may still miss cases, so two safeguards remain: never consume an unterminated apparent block comment,
 * which could otherwise swallow the rest of a file, and assert that each file retains its final executable code.
 * A comment-ratio check proved ineffective: legitimate files here can be 67% comments, such as side-layout.ts.
 */
function stripComments(text: string): string {
  let out = ''
  let i = 0
  /** Previous significant character */
  let prev = ''
  /** Whether each parenthesis level belongs to a control statement such as if, while, or for */
  const parens: boolean[] = []
  /** Whether the previous closing parenthesis ended a control statement */
  let afterControlParen = false
  const expectsExpression = () =>
    prev === '' || '(,=:[!&|?+-*%~^{};'.includes(prev) || out.trimEnd().endsWith('=>')
    || EXPR_KEYWORDS.includes(wordBefore(out) ?? '') || afterControlParen
  while (i < text.length) {
    const c = text[i]!
    const next = text[i + 1]
    if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      continue
    }
    if (c === '/' && next !== '*' && expectsExpression()) {
      out += c
      i++
      let inClass = false
      while (i < text.length) {
        const r = text[i]!
        if (r === '\\') { out += r + (text[i + 1] ?? ''); i += 2; continue }
        out += r
        i++
        if (r === '[') inClass = true
        else if (r === ']') inClass = false
        else if (r === '/' && !inClass) break
        else if (r === '\n') break // Without a terminator, treat it as nonregex rather than swallowing the whole file.
      }
      prev = '/'
      afterControlParen = false
      continue
    }
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++
      // No closing delimiter likely means an unrecognized regex, not a comment. Do not consume it:
      // swallowing the rest of a file is the worst failure, silently passing all violations (Codex #79 / #81).
      if (j >= text.length) { out += c; i++; if (!/\s/.test(c)) prev = c; continue }
      i = j + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c
      out += c
      i++
      while (i < text.length) {
        if (text[i] === '\\') { out += text[i]! + (text[i + 1] ?? ''); i += 2; continue }
        out += text[i]!
        if (text[i] === quote) { i++; break }
        i++
      }
      prev = quote
      afterControlParen = false
      continue
    }
    if (c === '(') parens.push(CONTROL_KEYWORDS.includes(wordBefore(out) ?? ''))
    out += c
    i++
    if (c === ')') afterControlParen = parens.pop() ?? false
    else if (!/\s/.test(c)) afterControlParen = false
    if (!/\s/.test(c)) prev = c
  }
  return out
}

const ltxIn = (text: string) => [...new Set(stripComments(text).match(/ltx_[A-Za-z0-9_-]*/g) ?? [])]


function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = join(dir, e.name)
    if (e.isDirectory()) return walk(full)
    return /\.tsx?$/.test(e.name) ? [full] : []
  })
}

describe('ltx_* selectors belong only in the rules module (CLAUDE.md hard rule 2)', () => {
  const files = walk(SRC).filter(f => f !== RULES_MODULE)

  it('TypeScript and TSX outside the rules module contain no ltx_ literals', () => {
    const offenders = files
      .map(f => ({ file: f.slice(SRC.length + 1), hits: ltxIn(readFileSync(f, 'utf8')) }))
      .filter(x => x.hits.length > 0)
      .map(x => `${x.file}: ${x.hits.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('The scanned file count is plausible, preventing an empty scan from passing.', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('every file retains its final code line; swallowing through EOF indicates misclassification', () => {
    // Misreading slash-star can swallow the rest of a file; check the final executable content of each file.
    const truncated = files
      .map(f => ({ file: f.slice(SRC.length + 1), text: readFileSync(f, 'utf8') }))
      .map(x => ({ ...x, tail: x.text.trimEnd().split('\n').at(-1)?.trim() ?? '' }))
      .filter(x => x.tail !== '' && !stripComments(x.text).includes(x.tail))
      .map(x => `${x.file}: trailing code ${JSON.stringify(x.tail.slice(0, 40))} was swallowed`)
    expect(truncated).toEqual([])
  })
})

describe('comment stripping must preserve code (Codex #79)', () => {
  it('ignores ltx_ in comments but detects it in code', () => {
    expect(ltxIn('// mentions .ltx_para\nconst a = 1')).toEqual([])
    expect(ltxIn('/** description of .ltx_note */\nconst b = 2')).toEqual([])
    expect(ltxIn("const c = '.ltx_p'")).toEqual(['ltx_p'])
    // template literals also count as strings
    expect(ltxIn('const d = `.ltx_td`')).toEqual(['ltx_td'])
  })

  it('slash-star inside strings does not start a comment and subsequent code survives', () => {
    // The regex version consumed from the URL wildcard through the next comment terminator, including the entire const e line.
    const src = "const url = 'https://arxiv.org/html/*'\n/* ordinary comment */\nconst e = '.ltx_abstract'"
    expect(ltxIn(src)).toEqual(['ltx_abstract'])
    expect(stripComments(src)).toContain('const e')
    expect(stripComments(src)).not.toContain('ordinary comment')
  })

  it('preserves real source content, including the content entrypoint defineContentScript call', () => {
    // The regex version swallowed lines 18–37 here, including the complete defineContentScript call.
    const text = readFileSync(join(SRC, 'entrypoints/content/index.ts'), 'utf8')
    expect(text).toContain('defineContentScript')
    expect(stripComments(text)).toContain('defineContentScript')
    // Comments really were removed.
    expect(stripComments(text)).not.toContain('Inject on arxiv.org/html/*')
  })

  it('regex literals and division are not mistaken for comments', () => {
    expect(stripComments('const r = /a*/\nconst s = 1')).toContain('const s')
    expect(ltxIn('const r = /ltx_[a-z]+/')).toEqual(['ltx_'])
    expect(stripComments('const q = a / b\nconst t = 2')).toContain('const t')
  })

  it('recognizes regexes after return and arrows (Codex #81, round 2)', () => {
    // mirror.ts contains this return-followed-by-regex pattern.
    for (const prefix of ['return', 'const f = () =>', 'if (x) return', 'yield']) {
      const src = `${prefix} /[/*]/\nconst z = '.ltx_theorem'`
      expect(stripComments(src)).toContain('const z')
      expect(ltxIn(src)).toEqual(['ltx_theorem'])
    }
  })

  it('slash-star inside regex character classes does not consume later code (Codex #81)', () => {
    // A slash-star character class can look like a comment opener; without a later terminator this would swallow the entire file.
    const src = "const re = /[/*]/\nconst z = '.ltx_theorem'"
    expect(stripComments(src)).toContain('const z')
    expect(ltxIn(src)).toEqual(['ltx_theorem'])
  })

  it('closing control-statement parentheses also permits regex literals (Codex #81, round 3)', () => {
    // Follow with a real comment so the unterminated-comment safeguard cannot rescue a misread regex:
    // the character-class slash-star would consume through the real comment terminator and erase the intervening code.
    for (const prefix of ['if (ready)', 'while (x)', 'for (;;)', 'if (a && b)']) {
      const src = `${prefix} /[/*]/.test(v)\nconst z = '.ltx_theorem'\n/* real comment */`
      expect(stripComments(src)).toContain('const z')
      expect(ltxIn(src)).toEqual(['ltx_theorem'])
    }
  })

  it('never consumes unterminated block comments, preventing missed heuristic cases from discarding whole files', () => {
    // Valid source cannot contain unterminated block comments; this almost certainly means a misread regex.
    // A false positive from retaining comment text is preferable to silently swallowing later violations (Codex #79 / #81).
    const src = "const a = 1\n/* no closing delimiter here\nconst z = '.ltx_p'"
    expect(stripComments(src)).toContain('const z')
  })

  it('slashes after function-call parentheses are division, not regexes', () => {
    // The slash in f(x) / 2 must be division or later code would be consumed as a regex.
    const src = "const n = f(x) / 2\nconst z = '.ltx_caption'"
    expect(ltxIn(src)).toEqual(['ltx_caption'])
  })

  it('an unterminated slash does not consume the whole file', () => {
    const src = "const a = 1 / 2\nconst b = '.ltx_caption'"
    expect(ltxIn(src)).toEqual(['ltx_caption'])
  })

  it('escaped quotes do not end strings early', () => {
    expect(ltxIn(`const a = 'it\\'s /* not a comment */ .ltx_p'`)).toEqual(['ltx_p'])
  })
})
