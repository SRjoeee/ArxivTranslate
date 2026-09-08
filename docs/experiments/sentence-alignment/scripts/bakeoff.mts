import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
import { decodeText } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/text'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const OUT = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function toAlpha(n: number): string { let s = ''; n += 1; while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }
const SYNTAXES: Array<{ name: string; v: (id: number) => string }> = [
  { name: 'A  @N#     digits (Immersive)', v: id => '@' + id + '#' },
  { name: 'B  @xN#    letter prefix', v: id => '@x' + id + '#' },
  { name: 'C  @abc#   letters only', v: id => '@' + toAlpha(id) + '#' },
  { name: 'D  PUA U+E0xx single char', v: id => String.fromCharCode(0xe000 + id) },
  { name: 'E  [[abc]] letters only', v: id => '[[' + toAlpha(id) + ']]' },
  { name: 'F  \u2039abc\u203a guillemet', v: id => '\u2039' + toAlpha(id) + '\u203a' },
]
interface Case { file: string; voids: number[]; text: string }
const all: Case[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never)
    if (p.slots.size === 0) continue
    const marked = p.text.replace(/<t id="(\d+)">/g, '$1').replace(/<\/t>/g, '').replace(/<x id="(\d+)"\/>/g, '$1')
    const plain = decodeText(marked)
    if (plain.replace(/\d+/g, '').trim().length < 30 || plain.length > 2500) continue
    all.push({ file: f, voids: [...p.slots.keys()], text: plain })
  }
  win.close()
}
const N = Number(process.env.N ?? 90)
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)
console.log('sample ' + pick.length + ' blocks (of ' + all.length + ')\n')
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
const report: Record<string, unknown> = {}
for (const syn of SYNTAXES) {
  const line: string[] = []
  for (const [ename, fn] of [['ms', microsoft], ['google', google]] as const) {
    let ok = 0, lost = 0, dup = 0, total = 0, sample = ''
    for (let i = 0; i < pick.length; i += 8) {
      const chunk = pick.slice(i, i + 8)
      const items = chunk.map(c => c.text.replace(/(\d+)/g, (_, d) => syn.v(Number(d))))
      let outs: string[]
      try { outs = await fn(items) } catch { continue }
      chunk.forEach((c, k) => {
        total++
        let bad = false
        for (const id of c.voids) {
          const n = (outs[k]?.match(new RegExp(esc(syn.v(id)), 'g')) ?? []).length
          if (n === 0) { lost++; bad = true } else if (n > 1) { dup++; bad = true }
        }
        if (!bad) ok++; else if (!sample) sample = (outs[k] ?? '').replace(/\s+/g, ' ').slice(0, 110)
      })
      await sleep(350)
    }
    line.push(String(Math.round((ok / Math.max(total, 1)) * 100)).padStart(3) + '%  lost ' + String(lost).padStart(3) + '  dup ' + String(dup).padStart(2))
    report[syn.name + '|' + ename] = { ok, total, lost, dup, sample }
  }
  console.log(syn.name.padEnd(30) + ' MS ' + line[0] + '    Google ' + line[1])
}
writeFileSync(OUT + '/bakeoff.json', JSON.stringify(report, null, 1))
