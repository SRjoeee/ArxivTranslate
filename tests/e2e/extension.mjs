// 真实浏览器端到端检查（DESIGN §11）：用 Playwright 起一个装着 .output/chrome-mv3 的 Chromium（新 headless 支持扩展），
// 驱动设置页与 popup、读控制台与网络，用免费的 google-web 引擎在真实 arXiv 页面上跑一遍主流程。
// 不碰用户自己的浏览器与 API key；走 LLM 的路径只测"错 key → auth → 整队停下"，不花钱。
//
// 用法：pnpm build && pnpm e2e        （首次先 npx playwright install chromium）
// 环境变量：AXT_PAPER / AXT_PAPER2 换论文；AXT_HEADED=1 看着跑。
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from 'playwright'

const HERE = new URL('.', import.meta.url).pathname
const EXT = process.env.AXT_EXT_DIR ?? new URL('../../.output/chrome-mv3', import.meta.url).pathname
const PROFILE = `${HERE}.profile`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
const PAPER2 = process.env.AXT_PAPER2 ?? '2312.17527'
const GOOGLE = 'translate-pa.googleapis.com'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: !process.env.AXT_HEADED,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 900 },
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]
console.log(`extension ${extId} loaded from ${EXT}`)

/** 打开一篇论文并自动开始翻译（#axt-translate），收集 [axt] 日志与发往 host 的请求 */
async function openPaper(id, host) {
  const page = await context.newPage()
  const logs = []
  const requests = []
  page.on('console', message => {
    const text = message.text()
    if (text.includes('[axt]')) logs.push({ t: Date.now(), text })
  })
  page.on('request', request => {
    if (request.url().includes(host)) requests.push({ t: Date.now(), url: request.url() })
  })
  await page.goto(`https://arxiv.org/html/${id}#axt-translate`, { waitUntil: 'domcontentloaded' })
  return { page, logs, requests }
}

async function waitForLog(logs, pattern, timeoutMs) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const hit = logs.find(entry => pattern.test(entry.text))
    if (hit) return hit
    await sleep(250)
  }
  return null
}

/** 任一 1 秒窗口内的最多请求数 */
function peakPerSecond(requests) {
  let peak = 0
  for (const a of requests) peak = Math.max(peak, requests.filter(b => b.t >= a.t && b.t < a.t + 1000).length)
  return peak
}

const DONE = /translation (done|cancelled)/
const countDom = page => page.evaluate(() => ({
  translations: document.querySelectorAll('.axt-t:not(.axt-mirror)').length,
  failed: document.querySelectorAll('[data-axt-state="failed"]').length,
  pending: document.querySelectorAll('[data-axt-state="pending"]').length,
  marked: document.querySelectorAll('[data-axt-id], [data-axt-state]').length,
  on: document.documentElement.hasAttribute('data-axt-on'),
}))

// ── 设置页：切到 google-web，保存，测试连接（background 路径）──────────
const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'google-web')
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
await options.getByRole('button', { name: /测试连接/ }).click()
const testText = await (await options.waitForSelector('main p[style*="background"]', { timeout: 30_000 })).textContent()
check('设置页测试连接（background 路径，google-web）', /ms/.test(testText) && !/失败/.test(testText), testText)
await options.screenshot({ path: `${SHOTS}/options.png` })

// ── 论文 1：整篇翻完；速率符合 google-web 的 rateLimit（2/s、突发 2）──
{
  const { page, logs, requests } = await openPaper(PAPER, GOOGLE)
  const done = await waitForLog(logs, DONE, 180_000)
  const line = done?.text ?? '(no done line)'
  const m = /(\d+)\/(\d+) done, (\d+) failed, (\d+) cached/.exec(line)
  check(`论文 ${PAPER} 翻完（google-web）`, !!m && m[1] === m[2] && m[3] === '0', `${line}; DOM ${JSON.stringify(await countDom(page))}`)
  const peak = peakPerSecond(requests)
  check('google-web 速率：任一 1 秒窗口 ≤ 4 个请求（突发 2 + 每秒补 2）', requests.length > 0 && peak <= 4, `${requests.length} 个请求，峰值 ${peak}/s`)
  await page.screenshot({ path: `${SHOTS}/paper.png` })

  // ── 刷新再翻：全部命中缓存，不再请求端点 ─────────────────────────────
  logs.length = 0
  requests.length = 0
  await page.reload({ waitUntil: 'domcontentloaded' })
  const again = await waitForLog(logs, DONE, 60_000)
  // cached 按段计（表格的格各算一段）、done 按块计，两者不等是正常的；看点是没有端点请求、全部完成、耗时极短
  const m2 = /(\d+)\/(\d+) done, (\d+) failed, (\d+) cached, (\d+) ms/.exec(again?.text ?? '')
  check('刷新再翻：全部命中缓存、不再请求端点', !!m2 && m2[1] === m2[2] && Number(m2[4]) >= Number(m2[1]) && requests.length === 0 && Number(m2[5]) < 5_000, `${again?.text ?? '(no done line)'}; 端点请求 ${requests.length}`)
  await page.close()
}

// ── 论文 2：翻译中途"恢复原文"，排队与在飞的请求一起撤 ────────────────
{
  const { page, logs, requests } = await openPaper(PAPER2, GOOGLE)
  const t0 = Date.now()
  let partial = 0
  while (Date.now() - t0 < 30_000 && partial === 0) {
    partial = (await countDom(page)).translations
    if (partial === 0) await sleep(100)
  }
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront() // popup 查的是当前窗口的活动标签页
  await popup.getByRole('button', { name: '恢复原文' }).waitFor({ timeout: 10_000 })
  const requestsBefore = requests.length
  const tCancel = Date.now()
  await popup.getByRole('button', { name: '恢复原文' }).click()
  await sleep(4_000)
  const after = await countDom(page)
  const late = requests.filter(r => r.t > tCancel + 500).length
  check('恢复原文后没有译文残留、没有 data-axt-*', after.translations === 0 && after.marked === 0 && !after.on, `${JSON.stringify(after)}；恢复前已有 ${partial} 段译文`)
  check('恢复原文后不再发新请求（排队的批次被撤）', late === 0, `恢复前 ${requestsBefore} 个请求，恢复 0.5 s 后新增 ${late} 个`)
  await popup.screenshot({ path: `${SHOTS}/popup-after-restore.png` })
  await popup.close()
  await page.close()
}

// ── 错 key：openai-compat 走 OpenRouter，401 → auth → 整队排空，不重试 ──
{
  await options.bringToFront()
  await options.selectOption('select >> nth=0', 'openai-compat')
  await options.fill('input[type="password"]', 'sk-or-v1-bogus-key-for-auth-test')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
  const { page, logs, requests } = await openPaper(PAPER, 'openrouter.ai')
  const done = await waitForLog(logs, DONE, 60_000)
  await sleep(2_000)
  // run.ts 有 8 个 worker，首波最多 8 个请求同时在飞；第一个 401 回来就排空整队，不该再有第二波
  check('错 key：首波 ≤ 8 个请求，auth 后整条队列停下（不重试、没有第二波）', requests.length <= 8 && /fatal: auth/.test(done?.text ?? ''), `${requests.length} 个请求；${done?.text ?? '(no done line)'}；DOM ${JSON.stringify(await countDom(page))}`)
  await page.close()
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
