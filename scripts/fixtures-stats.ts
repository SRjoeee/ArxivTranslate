// Phase 0 任务 2：规则覆盖率审计。
// 对 tests/fixtures/arxiv/*.html 逐篇解析，用 src/core/rules/latexml.ts 的规则做逐文本节点归属判定，
// 输出 Markdown 报表到 stdout；--json <path> 另存全量数据。用法：pnpm fixtures:stats [--json out.json]
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Window, type Document, type Element, type Text } from 'happy-dom'
import {
  DOCUMENT_ROOT, FIGURE_SELECTORS, LTX_CLASS_PREFIX, RULES_VERSION, SKIP_RULES, UNIT_RULES, type Rule,
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
  byRule: Counter                 // 规则 id → 归属文本节点数（unit / protected / skipped）
  ruleElements: Counter           // 规则 id → 全文档匹配元素数（用于 (a)）
  multi: Counter                  // 同一单元元素同时命中的规则组合 → 文本节点数
  histogram: Counter              // 有直接文本的元素：tag.ltx_* → 次数
  uncovered: Record<string, { count: number; sample: string }>
  outside: Counter                // 根外文本节点按最近可识别祖先归类
  classes: string[]               // 根内出现过的 ltx_* 类名
  svg: { total: number; withText: number; graphics: number; figures: number }
}

const inc = (c: Counter, k: string, n = 1) => { c[k] = (c[k] ?? 0) + n }
const ltxClasses = (el: Element) => Array.from(el.classList).filter(c => c.startsWith(LTX_CLASS_PREFIX)).sort()
const label = (el: Element) => {
  const cls = ltxClasses(el)
  return el.tagName.toLowerCase() + (cls.length ? '.' + cls.join('.') : '')
}
const hasText = (t: Text) => /\S/.test(t.data)

function parse(html: string): Document {
  const window = new Window({
    settings: { disableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true },
  })
  return new window.DOMParser().parseFromString(html, 'text/html')
}

/** 深度优先收集子树内所有文本节点（显式栈，避免深层递归） */
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
  if (!root) throw new Error(`${id}: 找不到翻译根 ${DOCUMENT_ROOT}`)

  const s: FixtureStats = {
    id, parseMs, textNodes: 0,
    byKind: { unit: 0, protected: 0, skipped: 0, uncovered: 0 },
    byRule: {}, ruleElements: {}, multi: {}, histogram: {}, uncovered: {}, outside: {}, classes: [],
    svg: { total: 0, withText: 0, graphics: 0, figures: 0 },
  }

  // 每个元素只算一次规则匹配
  const matchCache = new WeakMap<Element, { skip: Rule[]; unit: Rule[] }>()
  const matchesOf = (el: Element) => {
    let m = matchCache.get(el)
    if (!m) {
      m = { skip: SKIP_RULES.filter(r => el.matches(r.selector)), unit: UNIT_RULES.filter(r => el.matches(r.selector)) }
      matchCache.set(el, m)
    }
    return m
  }

  for (const r of [...UNIT_RULES, ...SKIP_RULES]) s.ruleElements[r.id] = doc.querySelectorAll(r.selector).length

  const classSet = new Set<string>()
  for (const el of Array.from(root.querySelectorAll('*'))) {
    for (const c of ltxClasses(el)) classSet.add(c)
    if (Array.from(el.childNodes).some(n => n.nodeType === TEXT_NODE && hasText(n as Text))) inc(s.histogram, label(el))
  }
  s.classes = Array.from(classSet).sort()

  for (const t of textNodes(root)) {
    if (!hasText(t)) continue
    s.textNodes++
    let skipHit: { el: Element; rules: Rule[] } | null = null
    let unitHit: { el: Element; rules: Rule[] } | null = null
    for (let el: Element | null = t.parentElement; el; el = el === root ? null : el.parentElement) {
      const m = matchesOf(el)
      if (!skipHit && m.skip.length) skipHit = { el, rules: m.skip }
      if (!unitHit && m.unit.length) unitHit = { el, rules: m.unit }
      if (skipHit && unitHit) break
    }
    let kind: Kind
    if (unitHit && (!skipHit || (skipHit.el !== unitHit.el && unitHit.el.contains(skipHit.el)))) {
      kind = skipHit ? 'protected' : 'unit'
      inc(s.byRule, (skipHit ?? unitHit).rules[0]!.id)
      if (unitHit.rules.length > 1) inc(s.multi, unitHit.rules.map(r => r.id).join('+'))
    } else if (skipHit) {
      kind = 'skipped'
      inc(s.byRule, skipHit.rules[0]!.id)
    } else {
      kind = 'uncovered'
      const chain: string[] = []
      for (let el = t.parentElement; el && el !== root; el = el.parentElement) chain.push(label(el))
      const sig = chain.slice(0, CHAIN_DEPTH).join(' < ') + (chain.length > CHAIN_DEPTH ? ' < …' : '')
      const entry = (s.uncovered[sig] ??= { count: 0, sample: t.data.trim().slice(0, SAMPLE_LEN) })
      entry.count++
    }
    s.byKind[kind]++
  }

  // 根外文本：按最近的带 ltx_* 类名或带 class/id 的祖先归类
  for (const t of textNodes(doc.body as Element)) {
    if (!hasText(t) || root.contains(t)) continue
    let key = '(无可识别祖先)'
    for (let el = t.parentElement; el; el = el.parentElement) {
      if (ltxClasses(el).length) { key = label(el); break }
      if (el.id || el.classList.length) { key = el.tagName.toLowerCase() + (el.id ? '#' + el.id : '.' + el.classList[0]); break }
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

// ---------- 报表 ----------
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + '%' : '-')
const row = (...cells: (string | number)[]) => '| ' + cells.join(' | ') + ' |'
const table = (head: string[], rows: (string | number)[][]) =>
  [row(...head), row(...head.map(() => '---')), ...rows.map(r => row(...r))].join('\n')

function report(all: FixtureStats[]): string {
  const out: string[] = []
  const n = all.length
  const totalText = all.reduce((a, s) => a + s.textNodes, 0)
  out.push(`## 规则覆盖率审计（RULES_VERSION ${RULES_VERSION}，${n} 篇，${totalText} 个文本节点）`, '')

  out.push('### 每篇概览', '', table(
    ['fixture', '解析 ms', '文本节点', 'unit', 'protected', 'skipped', 'uncovered'],
    all.map(s => [s.id, s.parseMs, s.textNodes, pct(s.byKind.unit, s.textNodes), pct(s.byKind.protected, s.textNodes), pct(s.byKind.skipped, s.textNodes), `${s.byKind.uncovered} (${pct(s.byKind.uncovered, s.textNodes)})`]),
  ), '')

  const sumBy = (pick: (s: FixtureStats) => Counter) => {
    const c: Counter = {}
    for (const s of all) for (const [k, v] of Object.entries(pick(s))) inc(c, k, v)
    return c
  }
  const byRule = sumBy(s => s.byRule)
  const ruleElements = sumBy(s => s.ruleElements)
  out.push('### 规则命中（文本节点数 / 匹配元素数）', '', table(
    ['类型', 'id', 'selector', '文本节点', '元素数'],
    [...UNIT_RULES.map(r => ['unit', r.id, `\`${r.selector}\``, byRule[r.id] ?? 0, ruleElements[r.id] ?? 0]),
     ...SKIP_RULES.map(r => ['skip', r.id, `\`${r.selector}\``, byRule[r.id] ?? 0, ruleElements[r.id] ?? 0])],
  ), '')

  const dead = [...UNIT_RULES, ...SKIP_RULES].filter(r => (ruleElements[r.id] ?? 0) === 0)
  out.push('### (a) 在所有 fixture 中都没有匹配元素的规则', '', dead.length ? dead.map(r => `- \`${r.selector}\` (${r.id})`).join('\n') : '（无）', '')

  const unc: Record<string, { count: number; sample: string; fixtures: Set<string> }> = {}
  for (const s of all) for (const [sig, e] of Object.entries(s.uncovered)) {
    const u = (unc[sig] ??= { count: 0, sample: e.sample, fixtures: new Set() })
    u.count += e.count; u.fixtures.add(s.id)
  }
  const uncRows = Object.entries(unc).sort((a, b) => b[1].count - a[1].count)
  out.push('### (b) 未被任何规则覆盖的文本节点（按最近祖先链签名，近端在前）', '', table(
    ['签名', '文本节点', 'fixture 数', '样本'],
    uncRows.map(([sig, u]) => [`\`${sig}\``, u.count, u.fixtures.size, u.sample.replace(/\|/g, '\\|')]),
  ), '')

  const multi = sumBy(s => s.multi)
  out.push('### 同一单元元素命中多条 unit 规则的组合', '', Object.keys(multi).length
    ? table(['组合', '文本节点'], Object.entries(multi).sort((a, b) => b[1] - a[1]))
    : '（无）', '')

  const presence: Record<string, string[]> = {}
  for (const s of all) for (const c of s.classes) (presence[c] ??= []).push(s.id)
  const partial = Object.entries(presence).filter(([, f]) => f.length < n).sort((a, b) => a[1].length - b[1].length)
  out.push(`### (c) 只在部分 fixture 出现的 ltx_* 类名（共 ${Object.keys(presence).length} 个类名，${partial.length} 个未全覆盖；全部 fixture 同为 oxide 0.7.6，此处反映的是内容分布而非版本差异）`, '', table(
    ['类名', '出现篇数', 'fixture'],
    partial.map(([c, f]) => [`\`${c}\``, f.length, f.join(' ')]),
  ), '')

  out.push('### SVG 图占比（§15.1，仅统计翻译根内）', '', table(
    ['fixture', 'svg', '含 <text> 的 svg', 'img.ltx_graphics', '.ltx_figure'],
    all.map(s => [s.id, s.svg.total, s.svg.withText, s.svg.graphics, s.svg.figures]),
  ), '')

  const outside = sumBy(s => s.outside)
  out.push('### 翻译根之外的文本节点（应只有导航栏与 arXiv 页头页脚）', '', table(
    ['最近可识别祖先', '文本节点'], Object.entries(outside).sort((a, b) => b[1] - a[1]),
  ), '')

  const hist = sumBy(s => s.histogram)
  out.push(`### 有直接文本的元素直方图（tag.ltx_* → 次数，合计 ${Object.keys(hist).length} 种）`, '', table(
    ['元素', '次数', '出现篇数'],
    Object.entries(hist).sort((a, b) => b[1] - a[1]).map(([k, v]) => [`\`${k}\``, v, all.filter(s => s.histogram[k]).length]),
  ), '')
  return out.join('\n')
}

// ---------- 主流程 ----------
const jsonIdx = process.argv.indexOf('--json')
const jsonPath = jsonIdx > -1 ? process.argv[jsonIdx + 1] : null
const files = readdirSync(FIXTURE_DIR).filter(f => f.endsWith('.html')).sort().map(f => join(FIXTURE_DIR, f))
const results: FixtureStats[] = []
for (const f of files) {
  process.stderr.write(`审计 ${basename(f)} … `)
  const s = auditFixture(f)
  process.stderr.write(`${s.parseMs} ms，${s.textNodes} 文本节点，uncovered ${s.byKind.uncovered}\n`)
  results.push(s)
}
process.stdout.write(report(results) + '\n')
if (jsonPath) {
  writeFileSync(jsonPath, JSON.stringify(results, null, 2))
  process.stderr.write(`全量数据已写入 ${jsonPath}\n`)
}
process.exit(0)
