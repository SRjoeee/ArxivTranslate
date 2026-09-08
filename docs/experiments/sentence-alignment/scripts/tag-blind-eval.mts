// 插句边界标签会不会让 Google 的译文变差？做成盲评：A/B 每条随机互换，我只看表、判完再对答案。
// 上一轮只人工读了 3 例就下结论（README §六），这一条补上样本量与盲法。
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '../../../../src/core/extractor'
import { serialize } from '../../../../src/core/protector/serialize'

const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const OUT = new URL('../data/', import.meta.url).pathname
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const all: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window(); win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never)
    const flat = p.text.replace(/<t id="\d+">/g, '').replace(/<\/t>/g, '')
    const bare = flat.replace(/<x id="\d+"\/>/g, '')
    if (bare.trim().length < 150 || flat.length > 1200) continue
    all.push(flat)
  }
  win.close()
}
const N = Number(process.env.N ?? 24)
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)

const ms = async (items: string[]) => {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error('ms ' + r.status)
  return await r.json() as Array<{ translations: Array<{ sentLen: { srcSentLen: number[] } }> }>
}
const google = async (items: string[]) => {
  const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', { method: 'POST',
    headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520' },
    body: JSON.stringify([[items, 'en', 'zh-CN'], 'wt_lib']) })
  if (!r.ok) throw new Error('google ' + r.status)
  return (await r.json() as string[][])[0]!
}
// 用微软的 srcSentLen 切源句
const sents: string[][] = []
for (let i = 0; i < pick.length; i += 20) {
  const c = pick.slice(i, i + 20); const res = await ms(c)
  c.forEach((t, k) => {
    const lens = res[k]?.translations[0]?.sentLen?.srcSentLen
    if (!lens || lens.length < 2) { sents.push([t]); return }
    const out: string[] = []; let at = 0
    for (const L of lens) { out.push(t.slice(at, at + L)); at += L }
    if (at < t.length) out[out.length - 1] += t.slice(at)
    sents.push(out)
  })
  await sleep(400)
}
const idx = pick.map((_, i) => i).filter(i => sents[i]!.length >= 2)
const tagged = idx.map(i => sents[i]!.map((s, k) => `<y id="${k}"/>` + s).join(''))
const plain = idx.map(i => pick[i]!)
const A: string[] = [], B: string[] = []
for (let i = 0; i < tagged.length; i += 20) { A.push(...await google(tagged.slice(i, i + 20))); await sleep(400) }
for (let i = 0; i < plain.length; i += 20) { B.push(...await google(plain.slice(i, i + 20))); await sleep(400) }

const ph = (s: string) => s.replace(/<x id="(\d+)"\/>/g, (_, d) => `⟦${d}⟧`).replace(/<y id="\d+"\/>/g, '').replace(/\s+/g, ' ').trim()
let seed = 20260909
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
const sheet: string[] = ['# 盲评：Google 插句边界标签 vs 不插\n',
  '判据：**作为这段英文的中译，哪一版更好**。看术语准确、语序自然、有无漏译错译；',
  '占位符统一显示成 ⟦n⟧，不作为判据。答「甲」「乙」或「平」。\n']
const key: Array<{ n: number; first: 'tagged' | 'plain' }> = []
idx.forEach((srcIdx, k) => {
  const taggedFirst = rand() < 0.5
  key.push({ n: k + 1, first: taggedFirst ? 'tagged' : 'plain' })
  const a = ph(A[k]!), b = ph(B[k]!)
  sheet.push(`\n## ${k + 1}\n\n**原文** ${ph(pick[srcIdx]!)}\n`,
    `**甲** ${taggedFirst ? a : b}\n`, `**乙** ${taggedFirst ? b : a}\n`)
})
writeFileSync(join(OUT, 'tag-blind-sheet.md'), sheet.join('\n'))
writeFileSync(join(OUT, 'tag-blind-key.json'), JSON.stringify(key, null, 2))
console.log(`${idx.length} 组已写入 data/tag-blind-sheet.md（答案在 tag-blind-key.json，判完再看）`)
