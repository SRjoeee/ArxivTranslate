import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
// \u53e5\u5b50\u5207\u5206\uff1a\u907f\u5f00\u5e38\u89c1\u7f29\u5199
const ABBR = /(?:et al|e\.g|i\.e|cf|Fig|Eq|Sec|Ref|Thm|Def|approx|vs|resp|No|Vol|pp|Dr|Prof)\.$/i
function sentences(t: string): string[] {
  const out: string[] = []; let cur = ''
  for (const piece of t.split(/(?<=[.!?])\s+/)) {
    cur += (cur ? ' ' : '') + piece
    if (ABBR.test(cur.trim()) || /\b[A-Z]\.$/.test(cur.trim())) continue
    out.push(cur.trim()); cur = ''
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(s => s.length > 0)
}
const paras: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const t = (b.el as unknown as { textContent: string }).textContent.replace(/\s+/g, ' ').trim()
    if (t.length < 200 || t.length > 1200) continue
    if (/[\u{1D400}-\u{1D7FF}]/u.test(t)) continue
    if (sentences(t).length < 3) continue
    paras.push(t)
  }
  win.close()
}
const N = Number(process.env.N ?? 40)
const pick = Array.from({ length: Math.min(N, paras.length) }, (_, i) => paras[Math.floor((i / N) * paras.length)]!)
console.log('\u6837\u672c ' + pick.length + ' \u6bb5\uff08\u5019\u9009 ' + paras.length + '\uff09\uff0c\u5e73\u5747 ' + (pick.reduce((n,p)=>n+sentences(p).length,0)/pick.length).toFixed(1) + ' \u53e5/\u6bb5\n')
const ms = async (items: string[], raw = false) => { const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(items) }); const j = await r.json() as any[]; return raw ? j : j.map(x => x.translations[0].text) }
const gg = async (items: string[]) => { const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', { method:'POST', headers:{'Content-Type':'application/json+protobuf','X-Goog-API-Key':'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'}, body: JSON.stringify([[items,'en','zh-CN'],'wt_lib']) }); return (await r.json() as string[][])[0]! }
// \u5148\u770b\u5fae\u8f6f\u662f\u4e0d\u662f\u5185\u90e8\u6309\u53e5\u5207
const probe = await ms([pick[0]!], true)
console.log('\u5fae\u8f6f sentLen\uff08\u9996\u6bb5 ' + sentences(pick[0]!).length + ' \u53e5\uff09: ' + JSON.stringify((probe[0] as any).translations[0].sentLen) + '\n')
const norm = (s: string) => s.replace(/\s+/g, '').replace(/[\u3002\uff0c\uff1b\uff1a]/g, '')
function sim(a: string, b: string): number { const A = norm(a), B = norm(b); if (!A && !B) return 1; const m = new Map<string, number>(); for (const c of A) m.set(c, (m.get(c) ?? 0) + 1); let hit = 0; for (const c of B) { const n = m.get(c) ?? 0; if (n > 0) { hit++; m.set(c, n - 1) } } return (2 * hit) / (A.length + B.length) }
for (const [name, fn] of [['\u5fae\u8f6f', ms as (i: string[]) => Promise<string[]>], ['Google', gg]]) {
  const whole: string[] = []
  for (let i = 0; i < pick.length; i += 8) { whole.push(...await fn(pick.slice(i, i + 8))); await sleep(300) }
  const bySent: string[] = []
  for (const p of pick) { const ss = sentences(p); const outs: string[] = []; for (let i = 0; i < ss.length; i += 8) { outs.push(...await fn(ss.slice(i, i + 8))); await sleep(250) } bySent.push(outs.join('')) }
  let same = 0; const sims: number[] = []; const diffs: Array<[string,string,number]> = []
  pick.forEach((_, i) => { const a = whole[i] ?? '', b = bySent[i] ?? ''; const s = sim(a, b); sims.push(s); if (norm(a) === norm(b)) same++; else if (diffs.length < 3 && s < 0.95) diffs.push([a, b, s]) })
  sims.sort((x, y) => x - y)
  console.log('===== ' + name + ' =====')
  console.log('  \u9010\u5b57\u76f8\u540c        ' + same + '/' + pick.length)
  console.log('  \u5b57\u7b26\u76f8\u4f3c\u5ea6      \u4e2d\u4f4d ' + sims[Math.floor(sims.length/2)]!.toFixed(3) + '   \u6700\u4f4e ' + sims[0]!.toFixed(3) + '   p10 ' + sims[Math.floor(sims.length*0.1)]!.toFixed(3))
  for (const [a, b, s] of diffs) { console.log('  --- \u5dee\u5f02\u6837\u672c\uff08\u76f8\u4f3c\u5ea6 ' + s.toFixed(2) + '\uff09'); console.log('    \u6574\u6bb5: ' + a.slice(0, 150)); console.log('    \u6309\u53e5: ' + b.slice(0, 150)) }
  console.log('')
}
