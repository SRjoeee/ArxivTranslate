// #122 合入之后，用**生产的 serialize**（保留 NBSP、不 trim）重测微软 sentLen 的边界质量。
// 之前的数据是在实验脚本里手动 `\s+` 折叠的——那个写法会把 NBSP 也折掉，与线上行为不一致。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '../../../../src/core/extractor'
import { serialize } from '../../../../src/core/protector/serialize'

const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const all: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window(); win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never, 'markers')   // ← 生产路径 + 微软实际用的线上格式
    if (p.slots.size === 0) continue
    const flat = p.text
    if (flat.replace(/@[a-z]+#/g, '').trim().length < 80 || flat.length > 2000) continue
    all.push(flat)
  }
  win.close()
}
const N = 60
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)
console.log(`${pick.length} 段；含硬换行 ${pick.filter(s => /\n/.test(s)).length} 段；含 NBSP ${pick.filter(s => / /.test(s)).length} 段`)

const call = async (items: string[]) => {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error('ms ' + r.status)
  return await r.json() as Array<{ translations: Array<{ text: string; sentLen: { srcSentLen: number[]; transSentLen: number[] } }> }>
}
const rows: Array<{ src: string; lens: number[]; trans: number[]; text: string }> = []
for (let i = 0; i < pick.length; i += 20) {
  const c = pick.slice(i, i + 20); const res = await call(c)
  c.forEach((s, k) => { const t = res[k]!.translations[0]!; rows.push({ src: s, lens: t.sentLen.srcSentLen, trans: t.sentLen.transSentLen, text: t.text }) })
  await sleep(400)
}
let good = 0, total = 0, complete = 0, markersOK = 0, markerTotal = 0, markerKept = 0
for (const r of rows) {
  let at = 0
  for (let i = 0; i < r.lens.length - 1; i++) {
    at += r.lens[i]!; total++
    if (/[.!?][)"'\]]?$/.test(r.src.slice(Math.max(0, at - 3), at).trimEnd())) good++
  }
  if (r.lens.reduce((a, b) => a + b, 0) === r.src.length) complete++
  const want = new Set(r.src.match(/@[a-z]+#/g) ?? [])
  const got = new Set(r.text.match(/@[a-z]+#/g) ?? [])
  markerTotal += want.size
  for (const m of want) if (got.has(m)) markerKept++
  if ([...want].every(m => got.has(m))) markersOK++
}
console.log(`总句数              ${rows.reduce((n, r) => n + r.lens.length, 0)}`)
console.log(`切点落在句末标点后  ${good}/${total}  (${(good / total * 100).toFixed(1)}%)`)
console.log(`切分完整（合计==长度）${complete}/${rows.length}`)
console.log(`记号完好的块          ${markersOK}/${rows.length}  (${(markersOK / rows.length * 100).toFixed(0)}%)`)
console.log(`记号逐个存活          ${markerKept}/${markerTotal}  (${(markerKept / markerTotal * 100).toFixed(1)}%)`)
