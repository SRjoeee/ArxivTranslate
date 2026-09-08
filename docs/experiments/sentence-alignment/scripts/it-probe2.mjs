// 从 popup 触发翻译，抓 arXiv 页面上真正的翻译请求体
import { chromium } from 'playwright'
import { rmSync, writeFileSync } from 'node:fs'
const S = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad'
const EXT = `${S}/it-ext`, P = `${S}/.p-it2`
const PAPER = process.env.PAPER ?? '2410.00260'
const sleep = ms => new Promise(r => setTimeout(r, ms))
rmSync(P, { recursive: true, force: true })

const ctx = await chromium.launchPersistentContext(P, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 900 },
})
const bodies = []
ctx.on('request', r => {
  if (!/translatetext|translate_a|deepl|api2\.immersive|translate\.google/i.test(r.url())) return
  bodies.push({ url: r.url().slice(0, 140), body: r.postData() })
})
let [w] = ctx.serviceWorkers(); if (!w) w = await ctx.waitForEvent('serviceworker', { timeout: 30_000 })
const extId = w.url().split('/')[2]
await sleep(2500)
// 关掉引导页，免得它的示例请求混进来
for (const p of ctx.pages()) if (p.url().includes('immersivetranslate.com') || p.url().startsWith('chrome-extension')) await p.close().catch(() => {})

const page = await ctx.newPage()
await page.goto(`https://arxiv.org/html/${PAPER}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await sleep(3000)
bodies.length = 0

const popup = await ctx.newPage()
await popup.goto(`chrome-extension://${extId}/popup.html`)
await page.bringToFront()
await sleep(2500)
const btns = await popup.evaluate(() => [...document.querySelectorAll('button,[role=button],a')].map(b => (b.innerText || b.getAttribute('aria-label') || '').trim()).filter(Boolean).slice(0, 25))
console.log('popup 上的按钮:', JSON.stringify(btns, null, 0))

const btn = popup.getByRole('button', { name: /^翻译/ }).first()
await btn.click({ timeout: 8000 }).catch(async e => {
  console.log('  按 role 点失败，退回按文本:', e.message.slice(0, 60))
  await popup.getByText(/^翻译/).first().click({ timeout: 8000 }).catch(x => console.log('  也失败:', x.message.slice(0, 60)))
})
await page.bringToFront()
await sleep(12000)

// 逐屏滚，触发更多块
const h = await page.evaluate(() => document.documentElement.scrollHeight)
for (let y = 0; y < Math.min(h, 6000); y += 800) { await page.evaluate(t => scrollTo(0, t), y); await sleep(400) }
await sleep(6000)

writeFileSync(`${S}/it-bodies.json`, JSON.stringify(bodies, null, 2))
console.log(`\n抓到 ${bodies.length} 条翻译请求`)
console.log('\n=== DOM：译文节点长什么样 ===')
console.log(JSON.stringify(await page.evaluate(() => {
  const t = document.querySelectorAll('[data-immersive-translate-translation-element-mark]')
  const w = document.querySelectorAll('[data-immersive-translate-walked],[data-immersive-translate-paragraph]')
  const one = t[3] ?? t[0]
  return {
    译文节点数: t.length, 被标记的原节点数: w.length,
    译文样本: one ? one.outerHTML.slice(0, 400) : null,
    父节点: one?.parentElement ? one.parentElement.tagName + '.' + one.parentElement.className : null,
    原节点属性样本: w[3] ? [...w[3].attributes].map(a => a.name).join(' ') : null,
  }
}), null, 1))
await ctx.close()
