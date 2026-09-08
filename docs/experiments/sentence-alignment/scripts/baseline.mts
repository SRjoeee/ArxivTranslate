import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
import { decodeText } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/text'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
function toAlpha(n: number): string { let s = ''; n += 1; while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }
interface Case { voids: number[]; tagged: string; marked: string }
const all: Case[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never)
    if (p.slots.size === 0) continue
    const flatTag = p.text.replace(/<t id="(\d+)">/g, '').replace(/<\/t>/g, '')
    const marked = decodeText(flatTag.replace(/<x id="(\d+)"\/>/g, (_, d) => '@' + toAlpha(Number(d)) + '#'))
    const voids = [...p.slots.keys()].filter(id => !p.paired.has(id))
    if (voids.length === 0) continue
    if (marked.replace(/@[a-z]+#/g, '').trim().length < 30 || marked.length > 2500) continue
    all.push({ voids, tagged: flatTag, marked })
  }
  win.close()
}
const N = Number(process.env.N ?? 90)
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)
const totalMarkers = pick.reduce((n, c) => n + c.voids.length, 0)
console.log('sample ' + pick.length + ' blocks, ' + totalMarkers + ' placeholders\n')
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
for (const [wire, pickField, find] of [
  ['current  <x id="N"/> tags', 'tagged', (id: number) => new RegExp('<x id="' + id + '"\\s*/>', 'g')],
  ['marker   @abc#', 'marked', (id: number) => new RegExp('@' + toAlpha(id) + '#', 'g')],
] as const) {
  const line: string[] = []
  for (const [ename, fn] of [['ms', microsoft], ['google', google]] as const) {
    let okBlocks = 0, lost = 0, dup = 0, blocks = 0
    for (let i = 0; i < pick.length; i += 8) {
      const chunk = pick.slice(i, i + 8)
      let outs: string[]
      try { outs = await fn(chunk.map(c => c[pickField as 'tagged'])) } catch { continue }
      chunk.forEach((c, k) => {
        blocks++
        let bad = false
        for (const id of c.voids) {
          const n = (outs[k]?.match(find(id)) ?? []).length
          if (n === 0) { lost++; bad = true } else if (n > 1) { dup++; bad = true }
        }
        if (!bad) okBlocks++
      })
      await sleep(350)
    }
    const perMarker = 100 * (1 - (lost + dup) / totalMarkers)
    line.push('blocks ' + String(Math.round(100 * okBlocks / Math.max(blocks,1))).padStart(3) + '%  per-marker ' + perMarker.toFixed(1) + '%  (lost ' + lost + ' dup ' + dup + ')')
  }
  console.log(wire.padEnd(26) + ' MS ' + line[0])
  console.log(''.padEnd(26) + ' GG ' + line[1] + '\n')
}
