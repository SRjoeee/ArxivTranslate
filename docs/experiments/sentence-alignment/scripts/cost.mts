import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { extract, type Block } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/extractor'
import { serialize } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/serialize'
import { splitRuns } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/runs'
import { decodeText } from '/Users/cheongzhiyan/Developer/ArxivTranslate/src/core/protector/text'
const DIR = '/Users/cheongzhiyan/Developer/ArxivTranslate/tests/fixtures/arxiv'
function A(n: number): string { let s = ''; n += 1; while (n > 0) { s = String.fromCharCode(97 + ((n - 1) % 26)) + s; n = Math.floor((n - 1) / 26) } return s }
let tagChars = 0, markChars = 0, runSegs = 0, markSegs = 0, blocks = 0
let tSer = 0, tRun = 0
for (const f of readdirSync(DIR).filter(n => n.endsWith('.html'))) {
  const win = new Window()
  win.document.write(readFileSync(join(DIR, f), 'utf8'))
  for (const b of extract(win.document as never) as Block[]) {
    if (b.kind !== 'text') continue
    let t0 = performance.now()
    const p = serialize(b.el as never)
    tSer += performance.now() - t0
    blocks++
    tagChars += p.text.length
    markSegs++
    t0 = performance.now()
    const layout = splitRuns(p)
    tRun += performance.now() - t0
    runSegs += layout.runs.filter(r => r.trim()).length
    // marker 形态：把 runs 布局拼成一段，void 处插字母记号
    let s = ''
    for (const it of layout.items) {
      if (it.kind === 'text') s += layout.runs[it.run] ?? ''
      else if (it.kind === 'raw') s += it.text
      else s += '@' + A(it.id) + '#'
    }
    markChars += s.length
  }
  win.close()
}
const kb = (n: number) => (n / 1024).toFixed(0) + ' KB'
console.log('块 ' + blocks)
console.log('markup 线上载荷  ' + kb(tagChars))
console.log('marker 线上载荷  ' + kb(markChars) + '   (' + (100 * (markChars - tagChars) / tagChars).toFixed(1) + '%)')
console.log('')
console.log('markup / marker 送出的段数  ' + markSegs + '（每块一段）')
console.log('runs 路径要送的段数         ' + runSegs + '（每块 ' + (runSegs / blocks).toFixed(2) + ' 段）')
console.log('')
console.log('serialize 总耗时  ' + tSer.toFixed(0) + ' ms（12 篇全量）')
console.log('splitRuns 总耗时  ' + tRun.toFixed(0) + ' ms（marker 路径额外要跑的那一步）')
