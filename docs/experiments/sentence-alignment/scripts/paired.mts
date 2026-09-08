import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
import { decodeText } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/text'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function A(n: number): string { let s = ''; n += 1; while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }
interface Case { voids: number[]; pairs: number[]; flat: string; paired: string }
const all: Case[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never)
    if (p.paired.size === 0) continue
    const vd = (s: string) => s.replace(/<x id="(\d+)"\/>/g, (_, d) => '@' + A(Number(d)) + '#')
    const flat = decodeText(vd(p.text.replace(/<t id="(\d+)">/g, '').replace(/<\/t>/g, '')))
    const paired = decodeText(vd(p.text.replace(/<t id="(\d+)">/g, (_, d) => '@' + A(Number(d)) + '{').replace(/<\/t>/g, '}@')))
    if (paired.length > 2500 || paired.replace(/@[a-z]+[#{]|\}@/g, '').trim().length < 30) continue
    all.push({ voids: [...p.slots.keys()].filter(i => !p.paired.has(i)), pairs: [...p.paired], flat, paired })
  }
  win.close()
}
const N = Number(process.env.N ?? 80)
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)
console.log('sample ' + pick.length + ' blocks with paired slots (of ' + all.length + ')')
console.log('void ' + pick.reduce((n,c)=>n+c.voids.length,0) + ', paired ' + pick.reduce((n,c)=>n+c.pairs.length,0) + '\n')
const microsoft = async (items: string[]) => {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error('ms ' + r.status)
  return (await r.json() as Array<{ translations: Array<{ text: string }> }>).map(x => x.translations[0]!.text)
}
const google = async (items: string[]) => {
  const r = await fetch('https://translate-pa.googleapis.com/v1/translateHtml', { method: 'POST', headers: { 'Content-Type': 'application/json+protobuf', 'X-Goog-API-Key': 'AIzaSyATBXajvzQLTDHEQbcpq0Ihe0vWDHmO520' }, body: JSON.stringify([[items, 'en', 'zh-CN'], 'wt_lib']) })
  if (!r.ok) throw new Error('google ' + r.status)
  return (await r.json() as string[][])[0]!
}
for (const mode of ['flat', 'paired'] as const) {
  for (const [ename, fn] of [['MS    ', microsoft], ['Google', google]] as const) {
    let okB = 0, blocks = 0, vLost = 0, vDup = 0, pLost = 0, pBroken = 0, vTot = 0, pTot = 0
    for (let i = 0; i < pick.length; i += 8) {
      const chunk = pick.slice(i, i + 8)
      let outs: string[]
      try { outs = await fn(chunk.map(c => c[mode])) } catch { continue }
      chunk.forEach((c, k) => {
        blocks++; let bad = false; const o = outs[k] ?? ''
        for (const id of c.voids) { vTot++; const n = (o.match(new RegExp('@' + A(id) + '#', 'g')) ?? []).length; if (n === 0) { vLost++; bad = true } else if (n > 1) { vDup++; bad = true } }
        if (mode === 'paired') for (const id of c.pairs) { pTot++; const open = (o.match(new RegExp('@' + A(id) + '\\{', 'g')) ?? []).length; if (open !== 1) { pLost++; bad = true; continue } ; const at = o.indexOf('@' + A(id) + '{'); if (o.indexOf('}@', at) < 0) { pBroken++; bad = true } }
        if (!bad) okB++
      })
      await sleep(350)
    }
    const vRate = vTot ? (100 * (1 - (vLost + vDup) / vTot)).toFixed(1) : '-'
    const pRate = pTot ? (100 * (1 - (pLost + pBroken) / pTot)).toFixed(1) : '-'
    console.log(mode.padEnd(7) + ename + '  blocks ' + String(Math.round(100*okB/Math.max(blocks,1))).padStart(3) + '%   void ' + vRate + '%   paired ' + pRate + '%  (void lost ' + vLost + '/dup ' + vDup + ', paired lost ' + pLost + '/unclosed ' + pBroken + ')')
  }
}
