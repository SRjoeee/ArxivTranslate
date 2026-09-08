import { chromium } from 'playwright'
import { rmSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
const S = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad'
const EXT = S + '/it-ext', P = S + '/.p-oracle'
const sleep = (ms) => new Promise(r => setTimeout(r, ms))
rmSync(P, { recursive: true, force: true })
const html = readFileSync(S + '/probe-page.html', 'utf8')
const server = createServer((_q, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html) })
await new Promise(r => server.listen(0, '127.0.0.1', r))
const PORT = server.address().port
const ctx = await chromium.launchPersistentContext(P, { channel: 'chromium', headless: true, args: ['--disable-extensions-except=' + EXT, '--load-extension=' + EXT], viewport: { width: 1440, height: 900 } })
const sent = []
ctx.on('request', r => { const u = r.url(); if (!/translatetext|translateHtml|translate_a|deepl/i.test(u)) return; const b = r.postData(); if (b) sent.push({ url: u.split('?')[0], body: b }) })
let [w] = ctx.serviceWorkers(); if (!w) w = await ctx.waitForEvent('serviceworker', { timeout: 30000 })
const extId = w.url().split('/')[2]
await sleep(2500)
for (const p of ctx.pages()) if (p.url() !== 'about:blank') await p.close().catch(() => {})
const page = await ctx.newPage()
await page.goto('http://127.0.0.1:' + PORT + '/', { waitUntil: 'domcontentloaded' })
await sleep(2000); sent.length = 0
const popup = await ctx.newPage()
await popup.goto('chrome-extension://' + extId + '/popup.html')
await page.bringToFront(); await sleep(2000)
await popup.getByRole('button', { name: /^\u7ffb\u8bd1/ }).first().click({ timeout: 8000 })
await page.bringToFront(); await sleep(12000)
console.log('=== \u5b83\u9001\u51fa\u53bb\u7684\u539f\u6587 ===')
for (const s of sent) { let items; try { items = JSON.parse(s.body) } catch { items = [s.body] }
  const arr = Array.isArray(items) ? (Array.isArray(items[0]) ? items[0][0] : items) : [items]
  console.log('  -> ' + s.url)
  for (const it of (arr || []).slice(0, 8)) console.log('     ' + JSON.stringify(it).slice(0, 340)) }
console.log('\n=== \u8bd1\u6587 DOM ===')
const dom = await page.evaluate(() => {
  const out = []
  for (const p of document.querySelectorAll('p[id]')) {
    const id = p.id
    const tr = p.querySelector('font.immersive-translate-target-wrapper') || p.nextElementSibling
    out.push({ id, mathIn: p.querySelectorAll('math').length,
      trText: tr ? tr.textContent.trim().slice(0, 200) : null,
      trMath: tr ? tr.querySelectorAll('math').length : 0,
      trTags: tr ? [...new Set([...tr.querySelectorAll('*')].map(e => e.tagName.toLowerCase()))].slice(0, 10) : [] })
  }
  return out
})
console.log(JSON.stringify(dom, null, 1))
writeFileSync(S + '/oracle-sent.json', JSON.stringify(sent, null, 1))
await ctx.close(); server.close()
