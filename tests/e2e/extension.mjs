// 真实浏览器端到端检查（DESIGN §11）：用 Playwright 起一个装着 .output/chrome-mv3 的 Chromium（新 headless 支持扩展），
// 驱动设置页与 popup、读控制台与网络，用免费的 google-web 引擎在真实 arXiv 页面上跑一遍主流程。
// 不碰用户自己的浏览器与 API key；走 LLM 的路径只测"错 key → 降级到免费引擎 / 关掉降级后整队停下"，不花钱。
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
  let spinnersSeen = 0
  const watchSpinners = setInterval(() => {
    page.evaluate(() => document.querySelectorAll('.axt-spinner').length).then(n => { spinnersSeen = Math.max(spinnersSeen, n) }).catch(() => undefined)
  }, 200)
  page.once('close', () => clearInterval(watchSpinners))
  page.on('console', message => {
    const text = message.text()
    if (text.includes('[axt]')) logs.push({ t: Date.now(), text })
  })
  page.on('request', request => {
    if (request.url().includes(host)) requests.push({ t: Date.now(), url: request.url() })
  })
  await page.goto(`https://arxiv.org/html/${id}#axt-translate`, { waitUntil: 'domcontentloaded' })
  const originalTitle = await page.title()
  return { page, logs, requests, originalTitle, spinnersSeen: () => spinnersSeen }
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

/** 按视口翻译（§10）没有"翻完"：每次从忙到闲打一条 session idle */
const IDLE = /session idle: (\d+)\/(\d+) requested of (\d+), (\d+) failed, (\d+) cached/
const idleOf = log => { const m = IDLE.exec(log?.text ?? ''); return m ? { done: +m[1], requested: +m[2], total: +m[3], failed: +m[4], cached: +m[5], text: log.text } : null }
/** 逐屏往下滚：一次跳到底只会让最后一屏进入观察器 */
async function scrollThrough(page) {
  const step = 800
  const height = await page.evaluate(() => document.documentElement.scrollHeight)
  for (let y = 0; y < height; y += step) {
    await page.evaluate(top => window.scrollTo(0, top), y)
    await sleep(120)
  }
}
const countDom = page => page.evaluate(() => ({
  translations: document.querySelectorAll('.axt-t:not(.axt-mirror):not(.axt-pending):not(.axt-error)').length,
  errorWidgets: document.querySelectorAll('.axt-error').length,
  pendingNodes: document.querySelectorAll('.axt-pending').length,
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

// ── 设置页：预翻译距离（配置 v3 的 preload）保存后重载仍在 ─────────────
const marginInput = 'input[type="number"] >> nth=0'
await options.fill(marginInput, '300')
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
await options.reload({ waitUntil: 'domcontentloaded' })
await options.waitForFunction(() => document.querySelector('input[type="number"]')?.value === '300', null, { timeout: 5_000 }).catch(() => undefined)
const marginBack = await options.inputValue(marginInput)
check('设置页：预翻译距离保存后重载仍是 300', marginBack === '300', `读回 ${marginBack}`)
await options.fill(marginInput, '1000')
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

// ── 设置页：目标语言（配置 v4 的 ISO 639-3 码）与自定义提示词保存后重载仍在 ──────
const langSelect = options.getByRole('combobox', { name: /^目标语言/ })
await langSelect.selectOption('jpn')
await options.getByRole('button', { name: '新建', exact: true }).click()
await options.getByLabel('名称').fill('e2e 提示词')
await options.getByRole('button', { name: '加入列表', exact: true }).click()
await options.getByRole('radio').last().check()
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
await options.reload({ waitUntil: 'domcontentloaded' })
await options.getByText('e2e 提示词').waitFor({ timeout: 5_000 }).catch(() => undefined)
const langBack = await options.getByRole('combobox', { name: /^目标语言/ }).inputValue()
const promptRow = options.getByRole('radio').last()
const promptBack = (await options.getByText('e2e 提示词').count()) === 1 && (await promptRow.isChecked())
check('设置页：目标语言 jpn 与自定义提示词保存后重载仍在且被选中', langBack === 'jpn' && promptBack, `语言 ${langBack}，提示词 ${promptBack}`)
// 删掉再存回默认：后面的错 key 段要走默认提示词
options.once('dialog', d => d.accept())
await options.getByRole('button', { name: '删除', exact: true }).click()
await options.getByRole('combobox', { name: /^目标语言/ }).selectOption('cmn')
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
const promptGone = (await options.getByText('e2e 提示词').count()) === 0
check('设置页：删除自定义提示词后选回默认', promptGone, `残留 ${promptGone ? 0 : 1}`)

// ── 设置页：译文样式预设与缓存管理（§7.5 / §9）──────────────────────────
{
  await options.bringToFront()
  await options.getByLabel('外观').selectOption('quote')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER}#axt-translate`, { waitUntil: 'domcontentloaded' })
  // 只认真正的译文：加载圆环 / 失败控件 / 镜像与拆分克隆也带 .axt-t，但预设刻意不装饰它们，
  // 轮询撞上 pending 节点会把「竖线为 0」误报成预设坏了（Codex 在 #52 指出）
  const REAL = ':not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'
  await page.waitForFunction(sel => document.querySelector(sel) !== null, `.axt-t:not([data-axt-inline])${REAL}`, { timeout: 60_000 }).catch(() => undefined)
  await page.waitForFunction(sel => document.querySelector(sel) !== null, `.axt-t[data-axt-inline]${REAL}`, { timeout: 30_000 }).catch(() => undefined)
  const styled = await page.evaluate(real => {
    const el = document.querySelector(`.axt-t:not([data-axt-inline])${real}`)
    const inline = document.querySelector(`.axt-t[data-axt-inline]${real}`)
    return {
      attr: document.documentElement.dataset.axtStyle ?? null,
      border: el ? Math.round(Number.parseFloat(getComputedStyle(el).borderInlineStartWidth)) : -1,
      // 行内标题译文不该加线（会把「Abstract 摘要」挤歪）；没等到行内译文就如实报 null，不当作通过
      inline: inline ? Math.round(Number.parseFloat(getComputedStyle(inline).borderInlineStartWidth)) : null,
    }
  }, REAL)
  check('样式预设 quote：<html> 带属性、块级译文有竖线、同行标题译文没有', styled.attr === 'quote' && styled.border > 0 && styled.inline === 0, JSON.stringify(styled))
  await page.screenshot({ path: `${SHOTS}/style-quote.png` })
  await page.close()

  // 下划线类要画到公式上：text-decoration 不传播到 math 这类原子行内盒，用户反馈过公式处虚线断掉
  await options.bringToFront()
  await options.getByLabel('外观').selectOption('dashed')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
  // 换一篇数学密集的：PAPER 首屏没有行内公式，检查会空跑
  const dashedPage = await context.newPage()
  await dashedPage.goto('https://arxiv.org/html/2609.04056v1#axt-translate', { waitUntil: 'domcontentloaded' })
  await dashedPage.waitForFunction(() => document.querySelectorAll('.axt-t math').length > 0, null, { timeout: 60_000 }).catch(() => undefined)
  const dashed = await dashedPage.evaluate(() => {
    const deco = el => { const cs = getComputedStyle(el); return `${cs.textDecorationLine}/${cs.textDecorationStyle}` }
    const maths = [...document.querySelectorAll('.axt-t math')]
    const block = document.querySelector('.axt-t:not([data-axt-inline])')
    return { count: maths.length, math: maths.slice(0, 3).map(deco), block: block ? deco(block) : null }
  })
  check('样式预设 dashed：虚线画到译文里的公式上（text-decoration 不传播到原子行内盒）',
    dashed.count > 0 && dashed.block === 'underline/dashed' && dashed.math.every(d => d === 'underline/dashed'),
    `${dashed.count} 个公式，块级 ${dashed.block}，公式 ${dashed.math.join(' ')}`)
  await dashedPage.screenshot({ path: `${SHOTS}/style-dashed.png` })
  await dashedPage.close()

}

// ── 论文 1：看到哪翻到哪（§10）：不滚动只翻首屏附近；逐屏滚到底其余跟上；标题翻译；速率 ────
{
  const { page, logs, requests, originalTitle, spinnersSeen } = await openPaper(PAPER, GOOGLE)
  const first = idleOf(await waitForLog(logs, IDLE, 120_000))
  check(`论文 ${PAPER}：不滚动只翻首屏附近（google-web）`, !!first && first.requested > 0 && first.requested < first.total && first.done === first.requested && first.failed === 0, first?.text ?? '(no idle line)')
  check('请求期间出现过加载圆环（§7.6）', spinnersSeen() > 0, `最多同时 ${spinnersSeen()} 个圆环`)
  const translated = await page.title()
  check('标签页标题被翻译', translated !== originalTitle && /[\u4e00-\u9fff]/.test(translated), `${originalTitle} → ${translated}`)
  await page.screenshot({ path: `${SHOTS}/paper-first-screen.png` })

  logs.length = 0
  await scrollThrough(page)
  // 静止的判定：最后一条 idle 行连续 3 秒没变，且页面上没有 pending 节点
  let last = null
  let stable = 0
  for (let i = 0; i < 90 && stable < 3; i++) {
    await sleep(1_000)
    const idle = idleOf(logs.findLast(l => IDLE.test(l.text)))
    const pendingNodes = (await countDom(page)).pendingNodes
    stable = idle && pendingNodes === 0 && idle.text === last?.text ? stable + 1 : 0
    last = idle
  }
  const dom = await countDom(page)
  check('逐屏滚到底：进入视口的块都翻了，没滚到的不请求', !!last && last.requested > first.requested && last.done === last.requested && last.failed === 0 && dom.pendingNodes === 0, `${last?.text ?? '(no idle after scroll)'}; DOM ${JSON.stringify(dom)}`)
  const peak = peakPerSecond(requests)
  check('google-web 速率：任一 1 秒窗口 ≤ 4 个请求（突发 2 + 每秒补 2）', requests.length > 0 && peak <= 4, `${requests.length} 个请求，峰值 ${peak}/s`)
  await page.screenshot({ path: `${SHOTS}/paper.png` })

  // ── 刷新再翻：首屏附近全部命中缓存，不再请求端点 ────────────────────
  logs.length = 0
  requests.length = 0
  // Chrome 刷新会恢复滚动位置：先回到顶部，让刷新后的首屏与第一次的首屏是同一批块
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(300)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const again = idleOf(await waitForLog(logs, IDLE, 60_000))
  // cached 按段计（表格的格各算一段）、done 按块计，两者不等是正常的；看点是没有端点请求
  check('刷新再翻：首屏附近全部命中缓存、不再请求端点', !!again && again.done === again.requested && again.cached >= again.done && requests.length === 0, `${again?.text ?? '(no idle line)'}; 端点请求 ${requests.length}`)
  await page.close()
}

// ── 论文 2：翻译中途"恢复原文"，排队与在飞的请求一起撤 ────────────────
{
  const { page, logs, requests, originalTitle } = await openPaper(PAPER2, GOOGLE)
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
  check('恢复原文后标签页标题变回原文', (await page.title()) === originalTitle, `${await page.title()}；日志：${logs.find(l => /translation stopped/.test(l.text))?.text ?? '(no stopped line)'}`)
  await popup.screenshot({ path: `${SHOTS}/popup-after-restore.png` })
  await popup.close()
  await page.close()
}

// ── 设置页：样式切回默认；缓存统计与清空（§9）──────────────────────────
{
  await options.bringToFront()
  await options.reload({ waitUntil: 'domcontentloaded' })
  await options.getByLabel('外观').selectOption('none')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

  // 前面两篇论文翻过，缓存里应当有条目；重载保证读到的是最新统计
  await options.getByText(/已缓存 [1-9]\d* 条/).waitFor({ timeout: 15_000 }).catch(() => undefined)
  const before = await options.getByText(/已缓存 \d+ 条/).textContent()
  options.once('dialog', d => d.accept())
  await options.getByRole('button', { name: '清空全部缓存' }).click()
  await options.getByText(/已删除 \d+ 条/).waitFor({ timeout: 10_000 })
  const after = await options.getByText(/已缓存 \d+ 条/).textContent()
  check('缓存管理：显示条数，清空后归零', /已缓存 [1-9]/.test(before ?? '') && /已缓存 0 条/.test(after ?? ''), `清空前「${before}」，清空后「${after}」`)
}

// ── 错 key + 降级链开启（§8.5）：LLM 报 auth 后自动切到 google-web，整页照常翻完 ──
{
  await options.bringToFront()
  await options.selectOption('select >> nth=0', 'openai-compat')
  await options.fill('input[type="password"]', 'sk-or-v1-bogus-key-for-auth-test')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

  const { page, logs, requests } = await openPaper(PAPER, 'openrouter.ai')
  const done = await waitForLog(logs, IDLE, 90_000)
  await sleep(2_000)
  const idle = idleOf(done)
  const demoted = logs.some(l => /降级/.test(l.text))
  check('错 key + 降级开启：切到免费引擎，整页照常翻完、没有致命错误',
    !!idle && idle.failed === 0 && idle.done > 0 && !/fatal:/.test(done?.text ?? '') && demoted,
    `${done?.text ?? '(no idle line)'}；OpenRouter 请求 ${requests.length} 个；日志里有降级提示 ${demoted}`)

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByText(/已降级到/).waitFor({ timeout: 10_000 }).catch(() => undefined)
  const notice = await popup.getByText(/已降级到/).count()
  check('popup 提示当前用的是降级引擎', notice > 0, `匹配到 ${notice} 处提示`)
  await popup.screenshot({ path: `${SHOTS}/popup-demoted.png` })
  await popup.close()
  await page.close()
}

// ── 错 key + 降级链关闭：恢复"401 → auth → 整队排空"的行为 ──
{
  await options.bringToFront()
  await options.getByLabel('引擎失败时自动降级').uncheck()
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

  const { page, logs, requests } = await openPaper(PAPER, 'openrouter.ai')
  const done = await waitForLog(logs, IDLE, 60_000)
  await sleep(2_000)
  // 首波只有首屏附近的几批（令牌桶突发 20 封顶）；第一个 401 回来就排空整队，不该再有第二波
  check('错 key + 降级关闭：首波 ≤ 20 个请求，auth 后整条队列停下（不重试、没有第二波）', requests.length <= 20 && /fatal: auth/.test(done?.text ?? ''), `${requests.length} 个请求；${done?.text ?? '(no idle line)'}；DOM ${JSON.stringify(await countDom(page))}`)
  const widgets = await page.evaluate(() => document.querySelectorAll('.axt-error').length)
  const idle = idleOf(done)
  check('失败块旁有重试 / 原因小部件（§7.6）', !!idle && widgets > 0 && widgets === idle.failed, `${widgets} 个小部件，${idle?.failed ?? '?'} 个失败块`)
  await page.close()
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
