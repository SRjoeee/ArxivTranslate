// Phase 0 task 2: the rule coverage audit.
// Parses tests/fixtures/arxiv/*.html one by one, classifies every text node with the rules of src/core/rules/latexml.ts,
// and writes a Markdown report to stdout; --json <path> saves the full data as well. Usage: pnpm fixtures:stats [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Window, type Document, type Element, type Text } from 'happy-dom'
import {
  DOCUMENT_ROOT, FIGURE_SELECTORS, LTX_CLASS_PREFIX, PROTECT_RULES, RULES_VERSION, SKIP_RULES, TABLE_RULES, UNIT_RULES,
  classify, type Classification,
} from '../src/core/rules/latexml'

const FIXTURE_DIR = join(import.meta.dirname, '../tests/fixtures/arxiv')
const ELEMENT_NODE = 1
const TEXT_NODE = 3
const SAMPLE_LEN = 60
const CHAIN_DEPTH = 5

type Kind = 'unit' | 'protected' | 'skipped' | 'uncovered'
type Counter = Record<string, number>

interface FixtureStats {
  id: string
  parseMs: number
  textNodes: number
  byKind: Record<Kind, number>
  byRule: Counter                 // rule id → text nodes attributed (unit / protected / skipped)
  ruleElements: Counter           // rule id → elements matched in the whole document (for (a))
  multi: Counter                  // combinations of rules one unit element matches at once → text nodes
  histogram: Counter              // elements with direct text: tag.ltx_* → count
  uncovered: Record<string, { count: number; sample: string }>
  outside: Counter                // text nodes outside the root, by their nearest recognisable ancestor
  classes: string[]               // the ltx_* class names seen inside the root
  svg: { total: number; withText: number; graphics: number; figures: number }
}

const inc = (c: Counter, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n }
const ltxClasses = (el: Element) => Array.from(el.classList).filter(c => c.startsWith(LTX_CLASS_PREFIX)).sort()
const label = (el: Element) => {
  const cls = ltxClasses(el)
  return `${el.tagName.toLowerCase()}${cls.length ? `.${cls.join('.')}` : ''}`
}
const hasText = (t: Text) => /\S/.test(t.data)

function parse(html: string): Document {
  const window = new Window({
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  })
  return new window.DOMParser().parseFromString(html, 'text/html')
}

/** Collect every text node of a subtree depth first (an explicit stack, no deep recursion) */
function* textNodes(root: Element): Generator<Text> {
  const stack: Element[] = [root]
  while (stack.length) {
    const el = stack.pop()!
    const tag = el.tagName.toLowerCase()
    if (tag === 'script' || tag === 'style') continue
    const children = Array.from(el.childNodes)
    for (let i = children.length - 1; i >= 0; i--) {
      const n = children[i]
      if (!n) continue
      if (n.nodeType === ELEMENT_NODE) stack.push(n as Element)
      else if (n.nodeType === TEXT_NODE) yield n as Text
    }
  }
}

function auditFixture(file: string): FixtureStats {
  const id = basename(file, '.html')
  const t0 = performance.now()
  const doc = parse(readFileSync(file, 'utf8'))
  const parseMs = Math.round(performance.now() - t0)
  const root = doc.querySelector(DOCUMENT_ROOT)
  if (!root) throw new Error(`${id}: translation root ${DOCUMENT_ROOT} not found`)

  const s: FixtureStats = {
    id, parseMs, textNodes: 0,
    byKind: { unit: 0, protected: 0, skipped: 0, uncovered: 0 },
    byRule: {}, ruleElements: {}, multi: {}, histogram: {}, uncovered: {}, outside: {}, classes: [],
    svg: { total: 0, withText: 0, graphics: 0, figures: 0 },
  }

  // Every element is classified once; the logic is entirely the rule module's classify(), so the audit and the runtime agree
  const classCache = new WeakMap<Element, Classification | null>()
  const classOf = (el: Element): Classification | null => {
    // The script uses happy-dom's own Element type, which differs from the rule module's DOM type at the type level only
    if (!classCache.has(el)) classCache.set(el, classify(el as unknown as globalThis.Element))
    return classCache.get(el) ?? null
  }

  // The elements a rule matches go through classify() too: counted by selector alone, tags with an environment name (the 368 isNamedTag lets through)
  // would be recorded as protect/tag, and the audit would drift from the runtime (Codex on #53)
  for (const r of [...UNIT_RULES, ...SKIP_RULES, ...PROTECT_RULES]) s.ruleElements[r.id] = 0
  s.ruleElements.table = 0
  for (const el of Array.from(doc.querySelectorAll('*'))) {
    const c = classOf(el)
    if (c) inc(s.ruleElements, c.rule)
  }

  const classSet = new Set<string>()
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const c of ltxClasses(el)) classSet.add(c)
    if (Array.from(el.childNodes).some(n => n.nodeType === TEXT_NODE && hasText(n as Text))) inc(s.histogram, label(el))
  }
  s.classes = Array.from(classSet).sort()

  for (const t of textNodes(root)) {
    if (!hasText(t)) continue
    s.textNodes++
    let stop: { el: Element; rule: string } | null = null // the nearest skip / protect ancestor
    let unit: { el: Element; rule: string } | null = null // the nearest unit / table ancestor
    for (let el: Element | null = t.parentElement; el; el = el === root ? null : el.parentElement) {
      const c = classOf(el)
      if (c) {
        // Under protect-but-descend (a footnote container), a unit already found means the text belongs to a nested block, and the container is no stop
        const isStop = c.kind === 'skip' || (c.kind === 'protect' && !(c.descend && unit))
        if (!stop && isStop) stop = { el, rule: c.rule }
        if (!unit && (c.kind === 'unit' || c.kind === 'table')) unit = { el, rule: c.rule }
      }
      if (stop && unit) break
    }
    let kind: Kind
    if (unit && (!stop || (stop.el !== unit.el && unit.el.contains(stop.el)))) {
      kind = stop ? 'protected' : 'unit'
      inc(s.byRule, (stop ?? unit).rule)
      const hits = UNIT_RULES.filter(r => unit!.el.matches(r.selector))
      if (hits.length > 1) inc(s.multi, hits.map(r => r.id).join('+'))
    } else if (stop) {
      kind = 'skipped'
      inc(s.byRule, stop.rule)
    } else {
      kind = 'uncovered'
      const chain: string[] = []
      for (let el = t.parentElement; el && el !== root; el = el.parentElement) chain.push(label(el))
      const sig = chain.slice(0, CHAIN_DEPTH).join(' < ') + (chain.length > CHAIN_DEPTH ? ' < …' : '')
      s.uncovered[sig] ??= { count: 0, sample: t.data.trim().slice(0, SAMPLE_LEN) }
      const entry = s.uncovered[sig]!
      entry.count++
    }
    s.byKind[kind]++
  }

  // Text outside the root: by the nearest ancestor with an ltx_* class or a class/id
  for (const t of textNodes(doc.body as Element)) {
    if (!hasText(t) || root.contains(t)) continue
    let key = '(no recognisable ancestor)'
    for (let el = t.parentElement; el; el = el.parentElement) {
      if (ltxClasses(el).length) { key = label(el); break }
      if (el.id || el.classList.length) { key = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : `.${el.classList[0]}`}`; break }
    }
    inc(s.outside, key)
  }

  const svgs = Array.from(root.querySelectorAll('svg'))
  s.svg = {
    total: svgs.length,
    withText: svgs.filter(v => v.querySelector('text')).length,
    graphics: root.querySelectorAll(FIGURE_SELECTORS.graphics).length,
    figures: root.querySelectorAll(FIGURE_SELECTORS.figure).length,
  }
  return s
}

// ---------- The report ----------
const pct = (n: number, d: number) => (d ? `${((100 * n) / d).toFixed(1)}%` : '-')
const row = (...cells: (string | number)[]) => `| ${cells.join(' | ')} |`
const table = (head: string[], rows: (string | number)[][]) =>
  [row(...head), row(...head.map(() => '---')), ...rows.map(r => row(...r))].join('\n')

function report(all: FixtureStats[]): string {
  const out: string[] = []
  const n = all.length
  const totalText = all.reduce((a, s) => a + s.textNodes, 0)
  out.push(`## Rule coverage audit (RULES_VERSION ${RULES_VERSION}, ${n} papers, ${totalText} text nodes)`, '')

  out.push('### Per paper', '', table(
    ['fixture', 'parse ms', 'text nodes', 'unit', 'protected', 'skipped', 'uncovered'],
    all.map(s => [s.id, s.parseMs, s.textNodes, pct(s.byKind.unit, s.textNodes), pct(s.byKind.protected, s.textNodes), pct(s.byKind.skipped, s.textNodes), `${s.byKind.uncovered} (${pct(s.byKind.uncovered, s.textNodes)})`]),
  ), '')

  const sumBy = (pick: (s: FixtureStats) => Counter) => {
    const c: Counter = {}
    for (const s of all) for (const [k, v] of Object.entries(pick(s))) inc(c, k, v)
    return c
  }
  const byRule = sumBy(s => s.byRule)
  const ruleElements = sumBy(s => s.ruleElements)
  out.push('### Rule hits (text nodes / matched elements)', '', table(
    ['kind', 'id', 'selector', 'text nodes', 'elements'],
    [...UNIT_RULES.map(r => ['unit', r.id, `\`${r.selector}\``, byRule[r.id] ?? 0, ruleElements[r.id] ?? 0]),
     ['table', 'table', `\`${TABLE_RULES.root}\``, byRule.table ?? 0, ruleElements.table ?? 0],
     ...SKIP_RULES.map(r => ['skip', r.id, `\`${r.selector}\``, byRule[r.id] ?? 0, ruleElements[r.id] ?? 0]),
     ...PROTECT_RULES.map(r => ['protect', r.id, `\`${r.selector}\``, byRule[r.id] ?? 0, ruleElements[r.id] ?? 0])],
  ), '')

  const dead = [...UNIT_RULES, ...SKIP_RULES, ...PROTECT_RULES, { id: 'table', selector: TABLE_RULES.root }]
    .filter(r => (ruleElements[r.id] ?? 0) === 0)
  out.push('### (a) Rules matching no element in any fixture', '', dead.length ? dead.map(r => `- \`${r.selector}\` (${r.id})`).join('\n') : '(none)', '')

  const unc: Record<string, { count: number; sample: string; fixtures: Set<string> }> = {}
  for (const s of all) for (const [sig, e] of Object.entries(s.uncovered)) {
    unc[sig] ??= { count: 0, sample: e.sample, fixtures: new Set() }
    const u = unc[sig]!
    u.count += e.count; u.fixtures.add(s.id)
  }
  const uncRows = Object.entries(unc).sort((a, b) => b[1].count - a[1].count)
  out.push('### (b) Text nodes covered by no rule (by the signature of the nearest ancestor chain, nearest first)', '', table(
    ['signature', 'text nodes', 'fixtures', 'sample'],
    uncRows.map(([sig, u]) => [`\`${sig}\``, u.count, u.fixtures.size, u.sample.replace(/\|/g, '\\|')]),
  ), '')

  const multi = sumBy(s => s.multi)
  out.push('### Combinations of several unit rules matching one unit element', '', Object.keys(multi).length
    ? table(['combination', 'text nodes'], Object.entries(multi).sort((a, b) => b[1] - a[1]))
    : '(none)', '')

  const presence: Record<string, string[]> = {}
  for (const s of all) for (const c of s.classes) {
    presence[c] ??= []
    presence[c]!.push(s.id)
  }
  const partial = Object.entries(presence).filter(([, f]) => f.length < n).sort((a, b) => a[1].length - b[1].length)
  out.push(`### (c) ltx_* class names present in only some fixtures (${Object.keys(presence).length} class names in all, ${partial.length} not in every fixture; every fixture is oxide 0.7.6 alike, so this reflects content distribution, not version differences)`, '', table(
    ['class name', 'papers', 'fixture'],
    partial.map(([c, f]) => [`\`${c}\``, f.length, f.join(' ')]),
  ), '')

  out.push('### Share of SVG figures (§15.1, inside the translation root only)', '', table(
    ['fixture', 'svg', 'svg with <text>', 'img.ltx_graphics', '.ltx_figure'],
    all.map(s => [s.id, s.svg.total, s.svg.withText, s.svg.graphics, s.svg.figures]),
  ), '')

  const outside = sumBy(s => s.outside)
  out.push('### Text nodes outside the translation root (should be only the navigation bar and arXiv\'s header and footer)', '', table(
    ['nearest recognisable ancestor', 'text nodes'], Object.entries(outside).sort((a, b) => b[1] - a[1]),
  ), '')

  const hist = sumBy(s => s.histogram)
  out.push(`### Histogram of elements with direct text (tag.ltx_* → count, ${Object.keys(hist).length} kinds in all)`, '', table(
    ['element', 'count', 'papers'],
    Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`\`${k}\``, v, all.filter(s => s.histogram[k]).length]),
  ), '')
  return out.join('\n')
}

// ---------- Main ----------
const jsonIdx = process.argv.indexOf('--json')
const jsonPath = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null
const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort().map(f => join(FIXTURE_DIR, f))
const results: FixtureStats[] = []
for (const f of files) {
  process.stderr.write(`auditing ${basename(f)} … `)
  const s = auditFixture(f)
  process.stderr.write(`${s.parseMs} ms, ${s.textNodes} text nodes, uncovered ${s.byKind.uncovered}\n`)
  results.push(s)
}
process.stdout.write(`${report(results)}\n`)
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  process.stderr.write(`full data written to ${jsonPath}\n`)
}
process.exit(0)
