// 不变量：rangesOf 产出的任何范围都不得包含我们注入的节点。
// 把注入节点放到各种位置（兄弟、void 槽内、成对元素内、闭合标签之后），逐块验证。
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const bundle = readFileSync(process.argv[2], 'utf8')
const b = await chromium.launch({ channel: 'chromium', headless: true })
const page = await b.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('https://arxiv.org/html/2609.04056v1', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await page.addScriptTag({ content: bundle })

const out = await page.evaluate(() => {
  const { extract, serialize, rangesOf } = globalThis.__axtProbe
  const MARK = 'ZZINJECTEDZZ'
  const mk = () => { const s = document.createElement('span'); s.className = 'axt-t'; s.textContent = MARK; return s }
  const blocks = [...extract(document)].filter(b => b.kind === 'text').slice(0, 260)

  const placements = {
    sibling: el => { el.after(mk()) },
    insideVoid: el => { const v = el.querySelector('math, .ltx_note, cite'); if (!v) return false; v.append(mk()); return true },
    insidePaired: el => { const p = el.querySelector('em, strong, span.ltx_text'); if (!p) return false; p.append(mk()); return true },
    afterPaired: el => { const p = el.querySelector('em, strong, span.ltx_text'); if (!p) return false; p.after(mk()); return true },
    firstChild: el => { el.prepend(mk()); return true },
  }
  const report = {}
  for (const [name, place] of Object.entries(placements)) {
    let checked = 0, violations = 0, ranges = 0
    const samples = []
    for (const blk of blocks) {
      const clone = blk.el.cloneNode(true)
      blk.el.parentNode.insertBefore(clone, blk.el)
      try {
        if (place(clone) === false) continue
        const p = serialize(clone, 'tags', { offsets: true })
        if (p.offsets.length === 0) continue
        const rs = rangesOf(p.offsets, 0, p.text.length)
        checked++; ranges += rs.length
        for (const r of rs) {
          if (r.toString().includes(MARK)) {
            violations++
            if (samples.length < 3) samples.push(r.toString().slice(0, 60))
            break
          }
        }
      } finally { clone.remove() }
    }
    report[name] = { checked, ranges, violations, samples }
  }
  return report
})
console.log(JSON.stringify(out, null, 1))
await b.close()
