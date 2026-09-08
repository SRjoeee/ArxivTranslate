// 归一化空白对 sentLen 的影响：同一批 60 段，两种输入各测一次
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const raw: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window(); win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    const p = serialize(b.el as never); if (p.slots.size === 0) continue
    const flat = p.text.replace(/<t id="\d+">/g, '').replace(/<\/t>/g, '')
    if (flat.replace(/<x id="\d+"\/>/g, '').trim().length < 80 || flat.length > 2000) continue
    raw.push(flat)
  }
  win.close()
}
const N = 60
const pick = Array.from({ length: N }, (_, i) => raw[Math.floor((i / N) * raw.length)]!)
const call = async (items: string[]) => {
  const r = await fetch('https://edge.microsoft.com/translate/translatetext?from=en&to=zh-Hans&isEnterpriseClient=false',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(items) })
  if (!r.ok) throw new Error('ms ' + r.status)
  return await r.json() as Array<{ translations: Array<{ text: string; sentLen: { srcSentLen: number[]; transSentLen: number[] } }> }>
}
const run = async (texts: string[]) => {
  const out: Array<{ n: number; lens: number[]; text: string; src: string }> = []
  for (let i = 0; i < texts.length; i += 20) {
    const c = texts.slice(i, i + 20); const res = await call(c)
    c.forEach((s, k) => { const t = res[k]!.translations[0]!; out.push({ n: t.sentLen.srcSentLen.length, lens: t.sentLen.srcSentLen, text: t.text, src: s }) })
    await sleep(400)
  }
  return out
}
const A = await run(pick)                                  // 未归一化（我上次测的口径）
const B = await run(pick.map(s => s.replace(/\s+/g, ' ').trim()))  // 归一化
// 判据：切点落在句末标点之后 = 真句边界；落在别处 = 假边界
const boundaryQuality = (rows: typeof A) => {
  let good = 0, total = 0
  for (const r of rows) {
    let at = 0
    for (let i = 0; i < r.lens.length - 1; i++) {   // 最后一个切点是文本末尾，不算
      at += r.lens[i]!
      total++
      const before = r.src.slice(Math.max(0, at - 3), at).trimEnd()
      if (/[.!?][)"'\]]?$/.test(before)) good++
    }
  }
  return { good, total }
}
const nlCount = pick.filter(s => /\n/.test(s)).length
const qa = boundaryQuality(A), qb = boundaryQuality(B)
console.log(`60 段真实块，${nlCount} 段含硬换行\n`)
console.log(`                       未归一化      归一化`)
console.log(`总句数                 ${A.reduce((n, r) => n + r.n, 0).toString().padEnd(13)}${B.reduce((n, r) => n + r.n, 0)}`)
console.log(`切点落在句末标点后     ${(qa.good + '/' + qa.total).padEnd(13)}${qb.good + '/' + qb.total}`)
console.log(`  即假边界             ${((qa.total - qa.good) + ' 处').padEnd(13)}${(qb.total - qb.good) + ' 处'}`)
const diff = A.map((a, i) => ({ i, a: a.n, b: B[i]!.n })).filter(x => x.a !== x.b)
console.log(`\n两种输入下句数不同的块 ${diff.length}/60`)
console.log(diff.slice(0, 8).map(x => `  块#${x.i}: 未归一化 ${x.a} 句 → 归一化 ${x.b} 句`).join('\n'))
