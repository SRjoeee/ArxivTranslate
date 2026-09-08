// 纯文本记号方案的往返完整性：真实 fixture 的块 × 两种语法 × 两个引擎
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
import { decodeText } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/text'

const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const OUT = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

interface Case { file: string; voids: number[]; pairs: number[]; flat: string; paired: string; len: number }

// ── 取样：从 12 篇里挑出有代表性的块 ────────────────────────────────────
const cases: Case[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never)
    if (p.slots.size === 0) continue
    const voids = [...p.slots.keys()].filter(id => !p.paired.has(id))
    const pairs = [...p.paired]
    const toWire = (keepPairs: boolean) => decodeText(
      p.text
        .replace(/<x id="(\d+)"\/>/g, '@$1#')
        .replace(/<t id="(\d+)">/g, keepPairs ? '@$1{' : '')
        .replace(/<\/t>/g, keepPairs ? '}@' : ''))
    const flat = toWire(false)
    const paired = toWire(true)
    if (flat.replace(/@\d+#/g, '').trim().length < 25) continue // 几乎没文字的块不参与
    if (paired.length > 3000) continue
    cases.push({ file: f, voids, pairs, flat, paired, len: paired.length })
  }
  win.close()
}
// 分层取样：按占位符数量分档，每档取若干
cases.sort((a, b) => (a.voids.length + a.pairs.length) - (b.voids.length + b.pairs.length))
const pick: Case[] = []
const N = Number(process.env.N ?? 120)
for (let i = 0; i < N; i++) pick.push(cases[Math.floor((i / N) * cases.length)]!)
console.log(`候选块 ${cases.length}，取样 ${pick.length}；含成对占位符的 ${pick.filter(c => c.pairs.length > 0).length}`)
console.log(`占位符数量分布：中位 ${pick[Math.floor(pick.length / 2)]!.voids.length + pick[Math.floor(pick.length / 2)]!.pairs.length}，最多 ${Math.max(...pick.map(c => c.voids.length + c.pairs.length))}`)

// ── 校验 ────────────────────────────────────────────────────────────
function check(c: Case, out: string, variant: 'flat' | 'paired') {
  const problems: string[] = []
  for (const id of c.voids) {
    const n = (out.match(new RegExp(`@${id}#`, 'g')) ?? []).length
    if (n !== 1) problems.push(`void@${id}×${n}`)
  }
  if (variant === 'paired') {
    for (const id of c.pairs) {
      const open = (out.match(new RegExp(`@${id}\\{`, 'g')) ?? []).length
      if (open !== 1) problems.push(`open@${id}×${open}`)
    }
    const closes = (out.match(/\}@/g) ?? []).length
    if (closes !== c.pairs.length) problems.push(`close×${closes}≠${c.pairs.length}`)
    // 配对顺序：每个 @N{ 后面必须有 }@
    for (const id of c.pairs) {
      const o = out.indexOf(`@${id}{`)
      if (o >= 0 && out.indexOf('}@', o) < 0) problems.push(`unclosed@${id}`)
    }
  }
  // 残渣：形如 @数字 但后面既不是 # 也不是 {
  const junk = out.match(/@\d+(?![#{])/g)
  if (junk) problems.push(`残渣 ${junk.slice(0, 3).join(',')}`)
  return problems
}

// ── 两个引擎 ────────────────────────────────────────────────────────
async function microsoft(items: string[]): Promise<string[]> {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error(`微软 ${r.status}`)
  const j = await r.json() as Array<{ translations: Array<{ text: string }> }>
  return j.map(x => x.translations[0]!.text)
}
async function google(items: string[]): Promise<string[]> {
  const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520' },
    body: JSON.stringify([[items, 'en', 'zh-CN'], 'wt_lib']),
  })
  if (!r.ok) throw new Error(`Google ${r.status}`)
  const j = await r.json() as string[][]
  return j[0]!
}

const engines = { 微软: microsoft, Google: google }
const results: Record<string, unknown> = {}
for (const [ename, fn] of Object.entries(engines)) {
  for (const variant of ['flat', 'paired'] as const) {
    const subset = variant === 'paired' ? pick.filter(c => c.pairs.length > 0) : pick
    let ok = 0
    const fails: Array<{ file: string; problems: string[]; sent: string; got: string }> = []
    for (let i = 0; i < subset.length; i += 8) {
      const chunk = subset.slice(i, i + 8)
      let outs: string[]
      try { outs = await fn(chunk.map(c => c[variant])) } catch (e) { console.log(`  ${ename}/${variant} 批次失败: ${(e as Error).message}`); continue }
      chunk.forEach((c, k) => {
        const problems = check(c, outs[k] ?? '', variant)
        if (problems.length === 0) ok++
        else if (fails.length < 6) fails.push({ file: c.file, problems, sent: c[variant].slice(0, 180), got: (outs[k] ?? '').slice(0, 180) })
      })
      await sleep(400)
    }
    const key = `${ename}/${variant}`
    results[key] = { 送出 : subset.length, 完好: ok, 成功率: `${((ok / subset.length) * 100).toFixed(1)}%`, 失败样本: fails }
    console.log(`\n### ${key}：${ok}/${subset.length} 完好（${((ok / subset.length) * 100).toFixed(1)}%）`)
    for (const f of fails.slice(0, 3)) {
      console.log(`  ✗ ${f.file} ${f.problems.join(' ')}`)
      console.log(`    送: ${f.sent.replace(/\s+/g, ' ')}`)
      console.log(`    回: ${f.got.replace(/\s+/g, ' ')}`)
    }
  }
}
writeFileSync(`${OUT}/marker-results.json`, JSON.stringify(results, null, 1))
