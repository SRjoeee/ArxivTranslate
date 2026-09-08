// CSS Custom Highlight API 能不能在不碰 DOM 的前提下高亮任意 Range（这是 §7.1 的硬约束）
import { chromium } from 'playwright'
const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1200, height: 800 } })
const page = await ctx.newPage()
await page.setContent('<p id="p">First sentence here. Second sentence follows. Third one ends it.</p>')
console.log(await page.evaluate(() => {
  const p = document.getElementById('p')
  const before = p.outerHTML
  if (!('highlights' in CSS) || typeof Highlight === 'undefined') return { supported: false }
  const tn = p.firstChild
  const r = new Range(); r.setStart(tn, 21); r.setEnd(tn, 47)
  const h = new Highlight(r)
  CSS.highlights.set('axt-sentence', h)
  const style = document.createElement('style')
  style.textContent = '::highlight(axt-sentence){background:yellow}'
  document.head.append(style)
  return {
    supported: true,
    ua: navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0],
    domUnchanged: p.outerHTML === before,
    rangeText: r.toString(),
    highlightRegistered: CSS.highlights.has('axt-sentence'),
  }
}))
await ctx.close()
