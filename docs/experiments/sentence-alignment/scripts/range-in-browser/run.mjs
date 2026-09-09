// 在真实浏览器里验 rangesOf：happy-dom 的 Range 不可用，单测只验了「调了哪个边界方法」，
// 没验「取出来的文字对不对」。这里用真实 arXiv 页面上的真实块补上。
import { chromium } from 'playwright'
import { readFileSync } from 'node:fs'
const bundle = readFileSync(process.argv[2], 'utf8')
const browser = await chromium.launch({ channel: 'chromium', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.goto('https://arxiv.org/html/2609.04056v1', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2000)
await page.addScriptTag({ content: bundle })

const result = await page.evaluate(() => {
  const { extract, serialize, rangesOf } = globalThis.__axtProbe
  const blocks = [...extract(document)].filter(b => b.kind === 'text')
  let checked = 0, exact = 0, mismatched = [], multi = 0
  for (const b of blocks.slice(0, 400)) {
    const p = serialize(b.el, 'tags', { offsets: true })
    const texts = p.offsets.filter(s => s.kind === 'text')
    if (texts.length === 0) continue
    // 对每个文本段的中间一截取 Range，比对 toString() 与节点数据切片
    for (const span of texts.slice(0, 3)) {
      const len = span.to - span.from
      if (len < 6) continue
      const from = span.from + 1
      const to = span.to - 1
      const ranges = rangesOf(p.offsets, from, to)
      if (ranges.length === 0) continue
      if (ranges.length > 1) multi++
      // DOM 里仍是原始空白，线上文本已折叠——按同一口径折叠再比（NBSP 两侧都不动）
      const collapse = t => t.replace(/[\t\n\f\r ]+/g, ' ')
      const got = collapse(ranges.map(r => r.toString()).join(''))
      // 期望：该段线上文本解码后去掉首尾各一个字符位置对应的内容
      const wire = p.text.slice(from, to)
      const want = wire.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
      checked++
      if (got === want) exact++
      else if (mismatched.length < 4) mismatched.push({ wire: wire.slice(0, 60), got: got.slice(0, 60), want: want.slice(0, 60) })
    }
  }
  // 多段路径：把一个块的文本节点切开、插入一个假译文，再验区间被切成两段且不含它
  let injected = null
  for (const b of blocks) {
    const p0 = serialize(b.el, 'tags', { offsets: true })
    const first = p0.offsets.find(s => s.kind === 'text' && s.to - s.from > 30)
    if (!first) continue
    const tail = first.node.splitText(Math.floor(first.node.data.length / 2))
    const fake = document.createElement('span')
    fake.className = 'axt-t'
    fake.textContent = 'ZZTRANSLATIONZZ'
    tail.parentNode.insertBefore(fake, tail)
    const p1 = serialize(b.el, 'tags', { offsets: true })
    const rs = rangesOf(p1.offsets, 0, p1.text.length)
    injected = {
      ranges: rs.length,
      containsInjected: rs.some(r => r.toString().includes('ZZTRANSLATIONZZ')),
      text: rs.map(r => r.toString()).join('').slice(0, 70),
    }
    break
  }
  return { blocks: blocks.length, checked, exact, multi, injected, mismatched }
})
console.log(JSON.stringify(result, null, 2))
await browser.close()
