// 插句边界标签让 Google 的译文变了多少？用编辑距离（顺序敏感）量，并打印最差的几例供人工判读。
// 绝不用 quality.mts 里那个字符频次 sim()——它对语序完全盲，见 README 的 2026-09-09 更正。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function lev(a: string, b: string): number {
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j), cur = new Array<number>(n + 1)
  for (let i = 1; i <= m; i++) {
    cur[0] = i
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    ;[prev, cur] = [cur, prev]
  }
  return prev[n]!
}
const all: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window(); win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never); if (p.slots.size === 0) continue
    const flat = p.text.replace(/<t id="\d+">/g, '').replace(/<\/t>/g, '')
    if (flat.replace(/<x id="\d+"\/>/g, '').trim().length < 80 || flat.length > 2000) continue
    all.push(flat.replace(/\s+/g, ' ').trim())   // 归一化空白：不归一化的话微软会在硬换行处断句（README 第四节）
  }
  win.close()
}
const N = Number(process.env.N ?? 60)
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)
const msSent = async (items: string[]) => {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error('ms ' + r.status)
  return await r.json() as Array<{ translations: Array<{ text: string; sentLen?: { srcSentLen: number[] } }> }>
}
const google = async (items: string[]) => {
  const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', { method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520' },
    body: JSON.stringify([[items, 'en', 'zh-CN'], 'wt_lib']) })
  if (!r.ok) throw new Error('google ' + r.status)
  return (await r.json() as string[][])[0]!
}
const sents: string[][] = []
for (let i = 0; i < pick.length; i += 20) {
  const chunk = pick.slice(i, i + 20); const res = await msSent(chunk)
  chunk.forEach((text, k) => {
    const lens = res[k]?.translations[0]?.sentLen?.srcSentLen
    if (!lens || lens.length < 2) { sents.push([text]); return }
    const out: string[] = []; let at = 0
    for (const L of lens) { out.push(text.slice(at, at + L)); at += L }
    if (at < text.length) out[out.length - 1] += text.slice(at)
    sents.push(out)
  })
  await sleep(400)
}
const multi = pick.map((_, i) => i).filter(i => sents[i]!.length >= 2)
const tagged = multi.map(i => sents[i]!.map((s, k) => `<y id="${k}"/>` + s).join(''))
const plain = multi.map(i => pick[i]!)
const A: string[] = [], B: string[] = []
for (let i = 0; i < tagged.length; i += 20) { A.push(...await google(tagged.slice(i, i + 20))); await sleep(400) }
for (let i = 0; i < plain.length; i += 20) { B.push(...await google(plain.slice(i, i + 20))); await sleep(400) }
const rows = multi.map((srcIdx, k) => {
  const a = A[k]!.replace(/<y id="\d+"\/>/g, '').replace(/\s+/g, '')
  const b = B[k]!.replace(/\s+/g, '')
  return { srcIdx, k, d: lev(a, b), len: Math.max(a.length, b.length), a, b }
}).sort((x, y) => (y.d / y.len) - (x.d / x.len))
const rel = rows.map(r => r.d / r.len).sort((x, y) => x - y)
const q = (p: number) => rel[Math.min(rel.length - 1, Math.floor(p * rel.length))]!
console.log(`${rows.length} 个多句块，插 <y/> 句标签 vs 不插，去标签去空白后逐字比较：`)
console.log(`  完全相同        ${rel.filter(r => r === 0).length}/${rows.length}`)
console.log(`  相对编辑距离    中位 ${(q(0.5) * 100).toFixed(1)}% · p90 ${(q(0.9) * 100).toFixed(1)}% · 最大 ${(rel.at(-1)! * 100).toFixed(1)}%`)
console.log(`  差异 <2% 的块   ${rel.filter(r => r < 0.02).length}/${rows.length}`)
console.log(`\n—— 差异最大的 3 例，人工判读 ——`)
for (const r of rows.slice(0, 3)) {
  console.log(`\n[块#${r.srcIdx}] 相对距离 ${(r.d / r.len * 100).toFixed(1)}%`)
  console.log(`  原文  ${pick[r.srcIdx]!.replace(/<x id="\d+"\/>/g, '⟦⟧').slice(0, 220)}`)
  console.log(`  插标签 ${A[r.k]!.replace(/<y id="\d+"\/>/g, '│').replace(/<x id="\d+"\/>/g, '⟦⟧').slice(0, 220)}`)
  console.log(`  不插   ${B[r.k]!.replace(/<x id="\d+"\/>/g, '⟦⟧').slice(0, 220)}`)
}
