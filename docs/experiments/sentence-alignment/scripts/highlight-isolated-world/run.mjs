import { chromium } from 'playwright'
import { createHash } from 'node:crypto'
import { rmSync } from 'node:fs'
const EXT = process.argv[2]
const PROFILE = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad/probe-hl/profile'
rmSync(PROFILE, { recursive: true, force: true })
const ctx = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 900 },
})
const page = await ctx.newPage()
await page.goto('https://arxiv.org/html/2609.04056v1', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(2500)
const probe = await page.evaluate(() => ({
  api: document.documentElement.getAttribute('data-probe-api'),
  state: document.documentElement.getAttribute('data-probe'),
}))
console.log('内容脚本自报：', probe)
if (!probe.state?.startsWith('ready:')) { console.log('探针没就绪，止步'); await ctx.close(); process.exit(1) }
const id = probe.state.slice('ready:'.length)
const el = page.locator(`[id="${id}"]`)
await el.scrollIntoViewIfNeeded()
await page.waitForTimeout(400)
const shot = async label => {
  const buf = await el.screenshot()
  return { label, hash: createHash('sha1').update(buf).digest('hex').slice(0, 12), bytes: buf.length }
}
const fire = async what => {
  await page.evaluate(w => document.dispatchEvent(new CustomEvent('axt-probe', { detail: w })), what)
  await page.waitForTimeout(350)
  return page.evaluate(() => document.documentElement.getAttribute('data-probe-state'))
}
const a0 = await shot('未注册')
console.log('  ' + JSON.stringify(await fire('set')))
const a1 = await shot('已注册')
console.log('  ' + JSON.stringify(await fire('clear')))
const a2 = await shot('已清除')
console.log('  ' + JSON.stringify(await fire('set')))
const a3 = await shot('再注册')
for (const s of [a0, a1, a2, a3]) console.log(`  ${s.label.padEnd(8)} ${s.hash}  ${s.bytes} B`)
const painted = a0.hash !== a1.hash && a1.hash !== a2.hash && a0.hash === a2.hash && a1.hash === a3.hash
console.log(`\n隔离世界注册的高亮${painted ? '**被绘制**' : '**没有被绘制**'}（注册/清除/再注册三态一致性：${painted}）`)
await ctx.close()
