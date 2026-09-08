import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
import { decodeText } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/text'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const S = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function A(n: number): string { let s = ''; n += 1; while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }
const ABBR = /(?:et al|e\.g|i\.e|cf|Fig|Eq|Sec|Ref|Thm|Def|approx|vs|resp|No|Vol|pp|Dr|Prof|Rev|Phys|Lett|Nucl|Astron|Astrophys|Math|Proc|J|Ann|Int|Mod|Sci|Nat|Comput|Trans|Rep|Sov|Z|Suppl)\.$/i
function sentences(t: string): string[] {
  const out: string[] = []; let cur = ''
  for (const piece of t.split(/(?<=[.!?])\s+/)) {
    cur += (cur ? ' ' : '') + piece
    if (ABBR.test(cur.trim()) || /\b[A-Z]\.$/.test(cur.trim())) continue
    out.push(cur.trim()); cur = ''
  }
  if (cur.trim()) out.push(cur.trim())
  return out.filter(Boolean)
}
interface Item { file: string; kind: string; tagged: string; marked: string; plain: string; slots: number }
const pool: Item[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const el = b.el as unknown as { textContent: string; className: string; closest: (s: string) => unknown }
    const cls = String(el.className ?? '')
    if (/ltx_bibitem|ltx_bibblock/.test(cls) || el.closest('.ltx_bibliography')) continue
    const p = serialize(b.el as never)
    const flatTag = p.text.replace(/<t id="(\d+)">/g, '').replace(/<\/t>/g, '')
    const plain = decodeText(flatTag.replace(/<x id="\d+"\/>/g, ' [] ')).replace(/\s+/g, ' ').trim()
    if (plain.length < 180 || plain.length > 900) continue
    if (sentences(plain).length < 2) continue
    const marked = decodeText(flatTag.replace(/<x id="(\d+)"\/>/g, (_, d) => '@' + A(Number(d)) + '#'))
    const kind = /ltx_abstract/.test(cls) || el.closest('.ltx_abstract') ? 'abstract' : el.closest('figure') ? 'caption' : el.closest('.ltx_theorem') ? 'theorem' : 'body'
    pool.push({ file: f.replace('.html',''), kind, tagged: flatTag, marked, plain, slots: p.slots.size })
  }
  win.close()
}
// \u5206\u5c42\uff1a\u6bcf\u7bc7\u53d6\u51e0\u6761\uff0c\u517c\u987e\u6709\u65e0\u516c\u5f0f\u4e0e\u5757\u578b
const byFile = new Map<string, Item[]>()
for (const it of pool) { const a = byFile.get(it.file) ?? []; a.push(it); byFile.set(it.file, a) }
const picks: Item[] = []
for (const [, arr] of byFile) {
  const withMath = arr.filter(i => i.slots > 0), noMath = arr.filter(i => i.slots === 0)
  for (const src of [withMath, noMath]) for (let k = 0; k < 2 && k < src.length; k++) picks.push(src[Math.floor((k + 0.5) / 2 * src.length)]!)
}
console.log('\u6c60 ' + pool.length + '\uff0c\u53d6\u6837 ' + picks.length + '\uff08\u542b\u516c\u5f0f ' + picks.filter(p=>p.slots>0).length + '\uff09')
console.log('\u5757\u578b\uff1a' + JSON.stringify(picks.reduce((m: Record<string,number>, p) => (m[p.kind] = (m[p.kind] ?? 0) + 1, m), {})))
const ms = async (items: string[]) => { const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(items) }); return (await r.json() as any[]).map(x => x.translations[0].text) }
const gg = async (items: string[]) => { const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', { method:'POST', headers:{'Content-Type':'application/json+protobuf','X-Goog-API-Key':'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520'}, body: JSON.stringify([[items,'en','zh-CN'],'wt_lib']) }); return (await r.json() as string[][])[0]! }
// Google\uff1a\u6574\u6bb5 + \u6807\u7b7e\uff08\u751f\u4ea7\u73b0\u72b6\uff09
const gOut: string[] = []
for (let i = 0; i < picks.length; i += 8) { gOut.push(...await gg(picks.slice(i, i + 8).map(p => p.tagged))); await sleep(300) }
// \u5fae\u8f6f\uff1a\u6309\u53e5\u5207 + \u8bb0\u53f7
const mOut: string[] = []
for (const p of picks) { const ss = sentences(p.marked); const outs: string[] = []; for (let i = 0; i < ss.length; i += 8) { outs.push(...await ms(ss.slice(i, i + 8))); await sleep(200) } mOut.push(outs.join('')) }
// \u5c55\u793a\u524d\u5f52\u4e00\u5360\u4f4d\u7b26\uff0c\u907f\u514d\u8bed\u6cd5\u6cc4\u5e95
const norm = (s: string) => s.replace(/<x id="(\d+)"\s*\/>/g, (_, d) => '\u27e6' + d + '\u27e7').replace(/@([a-z]+)#/g, (_, a) => '\u27e6' + a + '\u27e7').replace(/\s+/g, ' ').trim()
const key: Array<{ i: number; A: string; B: string }> = []
const sheet: string[] = []
picks.forEach((p, i) => {
  const flip = Math.random() < 0.5
  key.push({ i, A: flip ? 'microsoft' : 'google', B: flip ? 'google' : 'microsoft' })
  const a = flip ? mOut[i] : gOut[i], b = flip ? gOut[i] : mOut[i]
  sheet.push('## ' + (i + 1) + '  [' + p.file + ' / ' + p.kind + ' / \u5360\u4f4d\u7b26 ' + p.slots + ']')
  sheet.push('EN: ' + norm(p.plain))
  sheet.push('A : ' + norm(a ?? ''))
  sheet.push('B : ' + norm(b ?? ''))
  sheet.push('')
})
writeFileSync(S + '/eval-sheet.md', sheet.join('\n'))
writeFileSync(S + '/eval-key.json', JSON.stringify(key, null, 1))
console.log('\u5df2\u5199 eval-sheet.md \u4e0e eval-key.json')
