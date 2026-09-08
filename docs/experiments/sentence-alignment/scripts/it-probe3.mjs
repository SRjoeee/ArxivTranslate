// 公式密集的论文上，沉浸式翻译把 <math> 怎么处理了
import { chromium } from 'playwright'
import { rmSync } from 'node:fs'
const S = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad'
const EXT = `${S}/it-ext`, P = `${S}/.p-it3`
const PAPER = process.env.PAPER ?? '2312.17527'
const sleep = ms => new Promise(r => setTimeout(r, ms))
rmSync(P, { recursive: true, force: true })
const ctx = await chromium.launchPersistentContext(P, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 900 },
})
const sent = []
ctx.on('request', r => { if (/translatetext/.test(r.url()) && r.postData()) sent.push(...JSON.parse(r.postData())) })
let [w] = ctx.serviceWorkers(); if (!w) w = await ctx.waitForEvent('serviceworker', { timeout: 30_000 })
const extId = w.url().split('/')[2]
await sleep(2500)
for (const p of ctx.pages()) if (p.url() !== 'about:blank') await p.close().catch(() => {})
const page = await ctx.newPage()
await page.goto(`https://arxiv.org/html/${PAPER}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await sleep(3000); sent.length = 0
const popup = await ctx.newPage()
await popup.goto(`chrome-extension://${extId}/popup.html`)
await page.bringToFront(); await sleep(2000)
await popup.getByRole('button', { name: /^翻译/ }).first().click({ timeout: 8000 })
await page.bringToFront(); await sleep(10000)
const h = await page.evaluate(() => document.documentElement.scrollHeight)
for (let y = 0; y < Math.min(h, 9000); y += 800) { await page.evaluate(t => scrollTo(0, t), y); await sleep(350) }
await sleep(8000)

import { writeFileSync as WF } from 'node:fs'
WF(`${S}/it-segments.json`, JSON.stringify(sent, null, 1))
const withMath = sent.filter(s => /[\u{1D400}-\u{1D7FF}𝑥𝜃∈≤≥∑∫√α-ω]/u.test(s))
console.log(`共送出 ${sent.length} 段；其中含数学字符的 ${withMath.length} 段`)
console.log('\n=== 含公式的段（送出去的原文）===')
for (const s of withMath.slice(0, 3)) console.log(` [${s.length}] ${s.slice(0, 260)}\n`)

console.log('=== 原文块 vs 插入的译文（含 <math> 的段落）===')
console.log(JSON.stringify(await page.evaluate(() => {
  const out = []
  for (const p of document.querySelectorAll('p.ltx_p')) {
    if (!p.querySelector('math')) continue
    const tr = p.parentElement?.querySelector('font.immersive-translate-target-wrapper')
      ?? p.nextElementSibling?.matches?.('font') ? p.nextElementSibling : null
    const near = [...p.parentElement.querySelectorAll('font.immersive-translate-target-wrapper')]
    if (near.length === 0) continue
    out.push({
      原文: p.textContent.trim().slice(0, 150),
      原文里的公式数: p.querySelectorAll('math').length,
      译文: near[near.length - 1].textContent.trim().slice(0, 150),
      译文里的公式数: near[near.length - 1].querySelectorAll('math').length,
      译文节点位置: near[near.length - 1].parentElement === p ? '插在原节点内部' : '在原节点外',
    })
    if (out.length >= 3) break
  }
  return out
}), null, 1))
await ctx.close()
