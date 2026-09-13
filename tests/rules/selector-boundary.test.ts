import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CLAUDE.md hard rule 2: any ltx_* selector may be written only in src/core/rules/latexml.ts,
// and other TS files go through the rule module; the one exception is src/styles/*.css (layout is written declaratively in the style sheets).
// The rule used to live in the documentation only, and renderer/side-layout.ts quietly accumulated 5 of them (Codex on #22).

const SRC = join(import.meta.dirname, '../../src')
const RULES_MODULE = join(SRC, 'core/rules/latexml.ts')

/**
 * Strip comments, keep strings. **Not with a regex** (Codex on #79):
 * `/\/\*[\s\S]*?\*\//` takes the `/*` inside `'https://arxiv.org/html/*'` for the start of a block comment
 * and swallows everything up to the next `*​/` — measured: lines 18–37 of the 240-line `src/entrypoints/content/index.ts` vanished whole,
 * `defineContentScript` and the initialisation code with them, and the guard opened itself a 20-line skylight.
 *
 * This state machine does one thing: recognise real comments. Strings (template strings included) are left as they are, because the selectors are written there.
 * Regex literals need no separate handling — reading `/` as division leaves the `ltx_` inside in the output, exactly the wanted result;
 * and a `/a*​/` is not mistaken for the start of a comment either (what follows `/` is neither `*` nor `/`).
 */
/** A `/` after these words opens a regex, not a division */
const EXPR_KEYWORDS = ['return', 'typeof', 'instanceof', 'in', 'of', 'case', 'do', 'else', 'yield', 'await', 'delete', 'void', 'new', 'throw']
/** After these' closing parenthesis an expression is expected too: `if (ready) /re/.test(x)` */
const CONTROL_KEYWORDS = ['if', 'while', 'for', 'switch', 'catch', 'with']

const wordBefore = (out: string) => /[A-Za-z$_][A-Za-z0-9$_]*$/.exec(out.trimEnd())?.[0]

/**
 * Strip comments, keep strings. **Not with a regex** (Codex on #79):
 * `/\/\*[\s\S]*?\*\//` takes the `/*` inside `'https://arxiv.org/html/*'` for the start of a block comment
 * and swallows everything up to the next `*​/` — measured: lines 18–37 of the 240-line `src/entrypoints/content/index.ts` vanished whole,
 * `defineContentScript` and the initialisation code with them, and the guard opened itself a 20-line skylight.
 *
 * Recognising real comments means recognising **regex literals** first, whose character classes may contain `/*` (`/[/*]/`). The criterion is the standard one:
 * a slash is a regex only where an **expression is expected** — after punctuation, after an arrow, after a keyword like `return`
 * (mirror.ts in this repository writes `return /\S/.test(…)`), and after the closing parenthesis of `if (…)` / `while (…)`
 * (Codex on #79 / #81 found one entry each in three rounds, so the parentheses are tracked by owner here rather than by the previous character alone).
 *
 * A heuristic may still miss an entry, so there are two more safety nets: a block comment with no end is **not swallowed** (the worst
 * consequence of a misreading is exactly swallowing to the end of the file), and a per-file assertion that “the code at the end is still there”.
 * A ratio criterion was tried and has no discriminating power — a normal file of this project reaches 67% comments (side-layout.ts).
 */
function stripComments(text: string): string {
  let out = ''
  let i = 0
  /** The previous meaningful character */
  let prev = ''
  /** Whether each parenthesis level was opened by a control statement such as if / while / for */
  const parens: boolean[] = []
  /** Whether the last `)` closed a control statement's parenthesis */
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
        else if (r === '\n') break // unclosed, it is taken for no regex, so the whole file is not swallowed
      }
      prev = '/'
      afterControlParen = false
      continue
    }
    if (c === '/' && next === '*') {
      let j = i + 2
      while (j < text.length && !(text[j] === '*' && text[j + 1] === '/')) j++
      // No end found means this is no comment — most likely some regex literal not recognised. **Not swallowed**:
      // swallowing to the end of the file is exactly the worst failure (guard all green, violations all missed; Codex on #79 / #81 repeatedly)
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

describe('ltx_* selectors may appear only in the rule module (CLAUDE.md hard rule 2)', () => {
  const files = walk(SRC).filter(f => f !== RULES_MODULE)

  it('no ltx_ literal in TS / TSX code outside the rule module', () => {
    const offenders = files
      .map(f => ({ file: f.slice(SRC.length + 1), hits: ltxIn(readFileSync(f, 'utf8')) }))
      .filter(x => x.hits.length > 0)
      .map(x => `${x.file}: ${x.hits.join(', ')}`)
    expect(offenders).toEqual([])
  })

  it('the number of files scanned is plausible — the walker must not run empty', () => {
    expect(files.length).toBeGreaterThan(30)
  })

  it('every file\'s last line of code is still there — swallowed to the end means a misreading', () => {
    // The worst consequence of misreading one `/*` is swallowing to the end of the file. Check per file that the executable content at the end is still there
    const truncated = files
      .map(f => ({ file: f.slice(SRC.length + 1), text: readFileSync(f, 'utf8') }))
      .map(x => ({ ...x, tail: x.text.trimEnd().split('\n').at(-1)?.trim() ?? '' }))
      .filter(x => x.tail !== '' && !stripComments(x.text).includes(x.tail))
      .map(x => `${x.file}: the trailing ${JSON.stringify(x.tail.slice(0, 40))} was swallowed`)
    expect(truncated).toEqual([])
  })
})

describe('stripping comments must not swallow code (Codex on #79)', () => {
  it('ltx_ inside a comment is no violation; in code it must be caught', () => {
    expect(ltxIn('// 这里说 .ltx_para\nconst a = 1')).toEqual([])
    expect(ltxIn('/** .ltx_note 的说明 */\nconst b = 2')).toEqual([])
    expect(ltxIn("const c = '.ltx_p'")).toEqual(['ltx_p'])
    // A template string counts as a string too
    expect(ltxIn('const d = `.ltx_td`')).toEqual(['ltx_td'])
  })

  it('a /* inside a string is no comment start: the code after it must stay', () => {
    // The regex version swallows from the /* in the URL to the next */, eating the whole const e line
    const src = "const url = 'https://arxiv.org/html/*'\n/* 普通注释 */\nconst e = '.ltx_abstract'"
    expect(ltxIn(src)).toEqual(['ltx_abstract'])
    expect(stripComments(src)).toContain('const e')
    expect(stripComments(src)).not.toContain('普通注释')
  })

  it('no content lost on a real file: the content entry\'s defineContentScript is still there', () => {
    // The regex version swallowed lines 18–37 of this file, the whole defineContentScript call among them
    const text = readFileSync(join(SRC, 'entrypoints/content/index.ts'), 'utf8')
    expect(text).toContain('defineContentScript')
    expect(stripComments(text)).toContain('defineContentScript')
    // And the comments were really stripped
    expect(stripComments(text)).not.toContain('Injected into arxiv.org/html/*')
  })

  it('regex literals and division are not taken for comments', () => {
    expect(stripComments('const r = /a*/\nconst s = 1')).toContain('const s')
    expect(ltxIn('const r = /ltx_[a-z]+/')).toEqual(['ltx_'])
    expect(stripComments('const q = a / b\nconst t = 2')).toContain('const t')
  })

  it('a regex after return / an arrow must be recognised too (Codex on #81, second round)', () => {
    // mirror.ts in this repository has exactly `return /\S/.test(…)`
    for (const prefix of ['return', 'const f = () =>', 'if (x) return', 'yield']) {
      const src = `${prefix} /[/*]/\nconst z = '.ltx_theorem'`
      expect(stripComments(src)).toContain('const z')
      expect(ltxIn(src)).toEqual(['ltx_theorem'])
    }
  })

  it('a /* inside a regex character class does not swallow the code after it either (Codex on #81)', () => {
    // The character class of `/[/*]/` holds a slash-star; taken for a block comment start, with no */ after it the whole file is void
    const src = "const re = /[/*]/\nconst z = '.ltx_theorem'"
    expect(stripComments(src)).toContain('const z')
    expect(ltxIn(src)).toEqual(['ltx_theorem'])
  })

  it('after a control statement\'s parenthesis is a regex position too (Codex on #81, third round)', () => {
    // **Followed by a real comment**, so the “unclosed is not swallowed” net cannot save it: with the regex unrecognised,
    // the slash-star in the character class swallows up to the real comment's end, and the code in between is gone
    for (const prefix of ['if (ready)', 'while (x)', 'for (;;)', 'if (a && b)']) {
      const src = `${prefix} /[/*]/.test(v)\nconst z = '.ltx_theorem'\n/* 真注释 */`
      expect(stripComments(src)).toContain('const z')
      expect(ltxIn(src)).toEqual(['ltx_theorem'])
    }
  })

  it('an unclosed block comment is never swallowed: should the heuristic still miss an entry, the whole file is not voided', () => {
    // Normal code has no unclosed block comment; meeting one, it is safe to conclude some regex was misread.
    // Better to take comment text for code (a false positive at worst) than to swallow the violations after it silently (Codex on #79 / #81 repeatedly)
    const src = "const a = 1\n/* 这里没有收尾\nconst z = '.ltx_p'"
    expect(stripComments(src)).toContain('const z')
  })

  it('after a function call\'s parenthesis it is division, not a regex', () => {
    // The slash in `f(x) / 2` must be division, or the code after it is eaten into a “regex”
    const src = "const n = f(x) / 2\nconst z = '.ltx_caption'"
    expect(ltxIn(src)).toEqual(['ltx_caption'])
  })

  it('an unclosed slash does not swallow the whole file', () => {
    const src = "const a = 1 / 2\nconst b = '.ltx_caption'"
    expect(ltxIn(src)).toEqual(['ltx_caption'])
  })

  it('an escaped quote does not end the string early', () => {
    expect(ltxIn(`const a = 'it\\'s /* not a comment */ .ltx_p'`)).toEqual(['ltx_p'])
  })
})
