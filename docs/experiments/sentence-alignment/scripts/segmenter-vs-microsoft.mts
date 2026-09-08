// 本地切句器 vs 微软 sentLen（当基准）。决定 Google 那条路能不能做好。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '../../../../src/core/extractor'
import { serialize } from '../../../../src/core/protector/serialize'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

// 缩写守卫：句号后面若是这些词/单字母，不算句末
const ABBR = /\b(?:[A-Z]|Fig|Figs|Eq|Eqs|Sec|Secs|Ref|Refs|Thm|Def|Lem|Prop|Cor|Rev|Phys|Lett|Nucl|Astron|Astrophys|Mon|Not|Proc|Conf|Int|J|vs|etc|cf|e\.g|i\.e|al|approx|resp|Dr|Prof|St|No|Vol|pp|Ed|Eds)\.$/
function localSplit(text: string): number[] {
  const seg = new Intl.Segmenter('en', { granularity: 'sentence' })
  const raw = [...seg.segment(text)].map(s => s.segment)
  const out: string[] = []
  for (const piece of raw) {
    const prev = out[out.length - 1]
    // 上一段以缩写结尾 → 与本段合并
    if (prev !== undefined && ABBR.test(prev.trimEnd())) out[out.length - 1] = prev + piece
    else out.push(piece)
  }
  return out.map(s => s.length)
}
const all: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window(); win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    // §5.4 的参考文献块不做句子切分——期刊缩写（Sci. Rep. / Phys. Rev.）是切句器的主要错误来源
    if (process.env.SKIP_BIB && (b.el as unknown as Element).closest('.ltx_bibblock, .ltx_bibitem, .ltx_biblist')) continue
    const p = serialize(b.el as never, 'markers')
    if (p.slots.size === 0) continue
    if (p.text.replace(/@[a-z]+#/g, '').trim().length < 80 || p.text.length > 2000) continue
    all.push(p.text)
  }
  win.close()
}
const N = Number(process.env.N ?? 60)
const pick = Array.from({ length: N }, (_, i) => all[Math.floor((i / N) * all.length)]!)
const call = async (items: string[]) => {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error('ms ' + r.status)
  return await r.json() as Array<{ translations: Array<{ sentLen: { srcSentLen: number[] } }> }>
}
const cuts = (lens: number[]) => { const out: number[] = []; let at = 0; for (let i = 0; i < lens.length - 1; i++) { at += lens[i]!; out.push(at) } return out }
let exact = 0, sameCount = 0, tp = 0, fp = 0, fn = 0
const bad: string[] = []
for (let i = 0; i < pick.length; i += 20) {
  const c = pick.slice(i, i + 20); const res = await call(c)
  c.forEach((text, k) => {
    const want = cuts(res[k]!.translations[0]!.sentLen.srcSentLen)
    const got = cuts(localSplit(text))
    const W = new Set(want), G = new Set(got)
    if (want.length === got.length) sameCount++
    if (want.length === got.length && want.every((v, j) => v === got[j])) exact++
    for (const g of G) (W.has(g) ? tp++ : fp++)
    for (const w of W) if (!G.has(w)) fn++
    if (bad.length < 3 && !(want.length === got.length && want.every((v, j) => v === got[j]))) {
      const extra = [...G].filter(g => !W.has(g)).slice(0, 2)
      if (extra.length) bad.push(`  多切于: ${extra.map(o => JSON.stringify(text.slice(Math.max(0, o - 34), o + 14))).join('  ')}`)
    }
  })
  await sleep(400)
}
console.log(`${pick.length} 段，基准 = 微软 srcSentLen`)
console.log(`  切点完全一致的段        ${exact}/${pick.length}`)
console.log(`  句数相同的段            ${sameCount}/${pick.length}`)
console.log(`  切点  命中 ${tp}   多切 ${fp}   漏切 ${fn}`)
console.log(`  precision ${(tp / (tp + fp) * 100).toFixed(1)}%   recall ${(tp / (tp + fn) * 100).toFixed(1)}%`)
if (bad.length) console.log('\n多切的样子：\n' + bad.join('\n'))
