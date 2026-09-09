// 契约：句子长度必须精确切分输入；切点不得落在占位符内部。跑遍全部 fixture、两种格式。
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '../wt-seg/src/core/extractor'
import { serialize } from '../wt-seg/src/core/protector/serialize'
import { sentenceCuts, splitSentences, visibleTextOf } from '../wt-seg/src/core/sentences'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
const PH = { tags: /<x\s+id="\d+"\/>|<\/?t(?:\s+id="\d+")?>/g, markers: /@@|@[a-z]+#/g }
let blocks = 0, badSum = 0, badZero = 0, insidePh = 0, afterOpen = 0, cuts = 0
const samples: string[] = []
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window(); win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    for (const fmt of ['tags', 'markers'] as const) {
      const p = serialize(b.el as never, fmt, { offsets: true })
      if (p.text.trim().length < 20) continue
      // 用生产推荐的取文本方式供给上下文
      const textOf = (id: number) => { const n = p.slots.get(id); return n ? visibleTextOf(n) : undefined }
      const lens = splitSentences(p.text, fmt, { textOf })
      blocks++
      const sum = lens.reduce((a, c) => a + c, 0)
      if (sum !== p.text.length) { badSum++; if (samples.length < 3) samples.push(`合计 ${sum} != ${p.text.length}: ${JSON.stringify(p.text.slice(0, 50))}`) }
      if (lens.some(n => n <= 0)) badZero++
      const cs = sentenceCuts(p.text, fmt, { textOf })
      cuts += cs.length
      for (const c of cs) {
        for (const m of p.text.matchAll(PH[fmt])) {
          const st = m.index ?? 0
          if (c > st && c < st + m[0].length) { insidePh++; if (samples.length < 6) samples.push(`切点落在占位符内: ${JSON.stringify(p.text.slice(st, st + m[0].length))}`) }
        }
        // 开标签必须跟着它包裹的那一句走：切点紧跟在开标签之后，等于把成对占位符劈成两半
        if (/<t(?:\s+id="\d+")?>$/.test(p.text.slice(0, c))) {
          afterOpen++
          if (samples.length < 6) samples.push(`切点紧跟开标签: ${JSON.stringify(p.text.slice(Math.max(0, c - 24), c + 14))}`)
        }
      }
    }
  }
  win.close()
}
console.log(`${blocks} 个块×格式，切点合计 ${cuts}`)
console.log(`  切分合计不等于长度   ${badSum}`)
console.log(`  出现零长或负长句子   ${badZero}`)
console.log(`  切点落在占位符内部   ${insidePh}`)
console.log(`  切点紧跟开标签之后   ${afterOpen}`)
if (samples.length) console.log(samples.join('\n'))
