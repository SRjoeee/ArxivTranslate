// 真实浏览器端到端检查（DESIGN §11）：用 Playwright 起一个装着 .output/chrome-mv3 的 Chromium（新 headless 支持扩展），
// 驱动设置页与 popup、读控制台与网络，用免费的 google-web 引擎在真实 arXiv 页面上跑一遍主流程。
// 不碰用户自己的浏览器与 API key；走 LLM 的路径只测"错 key → 降级到免费引擎 / 关掉降级后整队停下"，不花钱。
//
// 用法：pnpm build && pnpm e2e        （首次先 npx playwright install chromium）
// 环境变量：AXT_PAPER / AXT_PAPER2 换论文；AXT_HEADED=1 看着跑。
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
const PAPER2 = process.env.AXT_PAPER2 ?? '2312.17527'
/** 第三篇：前面的用例都没碰过它，缓存是冷的——导航那条要靠真实积压才测得出东西 */
const PAPER3 = process.env.AXT_PAPER3 ?? '2312.17141'
/** 第四篇：12 篇 fixture 里指向翻译块的锚点最多的一篇（64 个），只译文模式的锚点用例靠它 */
const PAPER4 = process.env.AXT_PAPER4 ?? '2609.00246'
const GOOGLE = 'translate-pa.googleapis.com'
/** 请求收尾的两个事件：成功与失败都要把 end 记上，否则它会一直算在飞 */
const SETTLED_EVENTS = ['requestfinished', 'requestfailed']
/** 撤销类断言用的高视口：要攒出一批**装不进在飞请求**的待译块，900 px 的首屏不够 */
const BACKLOG_VIEWPORT = { width: 1440, height: 3000 }
/** 排队量要到这个数才算“确实有没发出去的活”：等待与断言用同一个门槛，超时没攒够就带着数字失败 */
const MIN_QUEUED = 5

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

/**
 * 打开一篇论文并自动开始翻译（#axt-translate），收集 [axt] 日志与发往 host 的请求。
 *
 * 请求听在 **context** 上而不是 page 上：2026-09-06 起翻译的 fetch 由 background service worker 发出
 *（DESIGN §8.0），page 级事件一个都看不到。圆环同理不能靠轮询——首屏全命中缓存时 38 ms 就结束了，
 * 200 ms 的轮询必然扑空；改成页面里挂一个 MutationObserver 记录峰值。
 */
async function openPaper(id, host) {
  const page = await context.newPage()
  const logs = []
  const requests = []
  page.on('console', message => {
    const text = message.text()
    if (text.includes('[axt]')) logs.push({ t: Date.now(), text })
  })
  const inFlight = new Map()
  // 监听挂在 **context** 上：2026-09-06 起翻译的 fetch 由 background service worker 发出（DESIGN §8.0），
  // page 级事件一个都看不到。页面关闭时摘掉，免得多篇论文互相串
  const onRequest = request => {
    if (!request.url().includes(host)) return
    // translateHtml 的请求体是 [[items, from, to], client]：数出这一发装了多少段（攒批的直接证据）
    let items = 0
    try {
      const body = JSON.parse(request.postData() ?? 'null')
      if (Array.isArray(body?.[0]?.[0])) items = body[0][0].length
    } catch {
      // 不是 JSON（或 LLM 端点，段落在 prompt 里数不出来）就记 0
    }
    const entry = { t: Date.now(), url: request.url(), items, end: Number.POSITIVE_INFINITY }
    inFlight.set(request, entry)
    requests.push(entry)
  }
  const onSettled = request => {
    const entry = inFlight.get(request)
    if (entry) { entry.end = Date.now(); inFlight.delete(request) }
  }
  context.on('request', onRequest)
  for (const event of SETTLED_EVENTS) context.on(event, onSettled)
  page.once('close', () => {
    context.off('request', onRequest)
    for (const event of SETTLED_EVENTS) context.off(event, onSettled)
  })
  // 圆环不能靠轮询：首屏全命中缓存时 36 ms 就结束了，200 ms 的轮询必然扑空。挂个 MutationObserver。
  // **数插入次数，不采样实时数量**（issue #82）：MutationObserver 的回调在微任务检查点批量触发，
  // 插入与移除落在同一批里时，回调里 querySelectorAll 数到的已经是 0——峰值就永远是 0。
  // 记录被插入过的圆环节点数与时序无关
  await page.addInitScript(() => {
    window.__axtSpinnersSeen = 0
    const count = node => {
      if (node.nodeType !== 1) return 0
      const el = node
      return (el.classList?.contains('axt-spinner') ? 1 : 0) + (el.querySelectorAll?.('.axt-spinner').length ?? 0)
    }
    const start = () => new MutationObserver(list => {
      for (const m of list) for (const node of m.addedNodes) window.__axtSpinnersSeen += count(node)
    }).observe(document.documentElement, { childList: true, subtree: true })
    if (document.documentElement) start()
    else document.addEventListener('readystatechange', start, { once: true })
  })
  await page.goto(`https://arxiv.org/html/${id}#axt-translate`, { waitUntil: 'domcontentloaded' })
  const originalTitle = await page.title()
  return { page, logs, requests, originalTitle, spinnersSeen: () => page.evaluate(() => window.__axtSpinnersSeen ?? 0).catch(() => 0) }
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

/**
 * 在 context 上记下发往 host 的请求（含攒批段数与收尾时刻），**不随页面关闭摘掉**：
 * 撤销类断言要观察的正是页面消失之后还有没有请求
 */
function trackRequests(host) {
  const requests = []
  const live = new Map()
  const onRequest = request => {
    if (!request.url().includes(host)) return
    let items = 0
    try {
      const body = JSON.parse(request.postData() ?? 'null')
      if (Array.isArray(body?.[0]?.[0])) items = body[0][0].length
    } catch {
      // 不是 JSON 就记 0
    }
    const entry = { t: Date.now(), items, end: Number.POSITIVE_INFINITY }
    live.set(request, entry)
    requests.push(entry)
  }
  const onSettled = request => {
    const entry = live.get(request)
    if (entry) { entry.end = Date.now(); live.delete(request) }
  }
  context.on('request', onRequest)
  for (const event of SETTLED_EVENTS) context.on(event, onSettled)
  return {
    requests,
    off: () => {
      context.off('request', onRequest)
      for (const event of SETTLED_EVENTS) context.off(event, onSettled)
    },
  }
}

/**
 * 把页面推到**确实有还没发出去的活**的状态再返回（issue #82）：撤销类断言要在队列真有积压的
 * 那一刻动手，而不是滚一遍、等几个请求、然后碰运气去读 pending。
 *
 * 只数 pending 节点不够（Codex 在 #95 指出）：google-web 允许两个请求同时在飞、单发最多 100 段，
 * 看到的 pending 有可能整个都装在已经发出去的请求里，那"关掉之后零新请求"就是空断言。
 * 判据改成 **pending 块数 − 在飞段数**：这些块被标了 pending 却不在任何一个已发出的请求里，
 * 只能是排在队列里等着发。在飞段数取与采样窗口有交叠的全部请求之和，宁可高估——判据只会更严。
 * 一个块对 google-web 正好对应一段（markup 路径整块发一次），两个数字可比。
 *
 * 返回 { pending, inFlight, queued }；始终没攒起来 queued 记 0，让断言带着数字失败而不是静默通过
 */
async function awaitBacklog(page, { requests, minQueued = MIN_QUEUED, ready = () => true, timeoutMs = 40_000 } = {}) {
  const t0 = Date.now()
  let top = 0
  let last = { pending: 0, inFlight: 0, queued: 0 }
  while (Date.now() - t0 < timeoutMs) {
    const before = Date.now()
    const state = await page.evaluate(y => {
      window.scrollTo(0, y)
      return { pending: document.querySelectorAll('.axt-pending').length, height: document.documentElement.scrollHeight }
    }, top)
    const after = Date.now()
    const inFlight = requests.filter(r => r.t <= after && r.end >= before).reduce((n, r) => n + r.items, 0)
    last = { pending: state.pending, inFlight, queued: state.pending - inFlight }
    // 两个条件要**同时**成立：翻译已经真的跑起来（ready，通常是"已发出够多请求"），且此刻有**没发出去**的活。
    // 只等其中一个都测不出东西——pending 节点先于第一个请求出现（renderPending 跑在发请求之前）
    if (last.queued >= minQueued && ready()) return last
    top = top + 700 > state.height ? 0 : top + 700 // 滚到底就回顶上再来一轮，直到两个条件对齐
    await sleep(120)
  }
  return ready() ? last : { ...last, queued: 0 }
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
  // 恢复原文那条断言靠这个数字。**不能只列举几个属性**：渲染层还会注入 data-axt-mode /
  // -inline / -partial / -note / -fit / -split / -for / -on，漏掉任何一个，残留就检查不出来
  // （Codex 在 #34 指出）。这里扫每个元素的属性名前缀，连 <html> 一起数
  marked: [document.documentElement, ...document.querySelectorAll('*')]
    .reduce((n, el) => n + el.getAttributeNames().filter(a => a.startsWith('data-axt-')).length, 0),
  markedNames: [...new Set([document.documentElement, ...document.querySelectorAll('*')]
    .flatMap(el => el.getAttributeNames().filter(a => a.startsWith('data-axt-'))))].sort(),
  on: document.documentElement.hasAttribute('data-axt-on'),
}))

// ── 设置页：切到 google-web，保存，测试连接（background 路径）──────────
const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'google-web')
// 图片翻译（DESIGN §15）默认三种模式都开；这台机器装了 helper 的话叠加层与拆图会扰动下面的布局 / 计数断言，
// 这里关掉，专门的 e2e:image 再开（AXT_E2E_IMAGES=1 时保留）
if (!process.env.AXT_E2E_IMAGES) {
  for (const name of ['左右对照', '上下对照', '仅译文']) {
    const box = options.getByRole('checkbox', { name, exact: true })
    if (await box.isEnabled()) await box.uncheck()
  }
}
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

// ── 设置页：图片翻译的模式闸（配置 v8，DESIGN §15）保存后重载仍在；helper 没装时整节灰掉 ──────
{
  const names = ['左右对照', '上下对照', '仅译文']
  const boxOf = name => options.getByRole('checkbox', { name, exact: true })
  const enabled = await boxOf('上下对照').isEnabled()
  if (enabled && !process.env.AXT_E2E_IMAGES) {
    await boxOf('上下对照').check()
    await options.getByRole('button', { name: '保存', exact: true }).click()
    await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
    await options.reload({ waitUntil: 'domcontentloaded' })
    await options.getByRole('checkbox', { name: '上下对照', exact: true }).waitFor({ timeout: 5_000 })
    const states = await Promise.all(names.map(n => boxOf(n).isChecked()))
    check('设置页：图片翻译只勾「上下对照」保存后重载仍在', JSON.stringify(states) === JSON.stringify([false, true, false]), `读回 ${states.join(',')}`)
    await boxOf('上下对照').uncheck()
    await options.getByRole('button', { name: '保存', exact: true }).click()
    await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
  } else {
    const hint = await options.getByText(/helper/).first().textContent()
    check('设置页：图片翻译一节在 helper 未检测到时灰掉并说明原因', !enabled && /未检测到/.test(hint ?? ''), hint ?? '')
  }
}

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
  // 两个条件都要等到（issue #82）：只等"出现第一个带公式的译文"的话，`<html>` 上的 data-axt-style
  // 可能还没写上——enable() 在 startTranslation 里写它，而 #axt-translate 触发的会话与设置页刚存的预设
  // 之间隔着一次配置读取。一次实测就撞到过：量到 22 个公式、块级 none/solid，重跑同一构建是 51 个 underline/dashed
  await dashedPage.waitForFunction(
    () => document.documentElement.dataset.axtStyle === 'dashed' && document.querySelectorAll('.axt-t math').length > 0,
    null, { timeout: 60_000 },
  ).catch(() => undefined)
  // 再等公式数稳定：翻译还在进行时读到的是半截状态
  let stableMaths = -1
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const n = await dashedPage.evaluate(() => document.querySelectorAll('.axt-t math').length)
    if (n === stableMaths && n > 0) break
    stableMaths = n
  }
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
  const spinners = await spinnersSeen()
  check('请求期间插入过加载圆环（§7.6）', spinners > 0, `插入过 ${spinners} 个圆环`)
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
  // 光信管线自己的计数不行：渲染层空转、或者译文节点被谁删掉了，这条照样会通过（Codex 在 #34 指出）。
  // 也不能只比总数——`localizeNotes` 的脚注副本保留了 axt-t（只剥了 data-axt-*），
  // 于是译文总数会超过完成数，一个丢失的普通译文正好被一个无关的脚注副本抵消掉（Codex 在 #77 指出）。
  // 改成**逐块**验证：每个标成 translated 的原块，都要能按它的 id 找到一个真译文
  const orphans = await page.evaluate(() => [...document.querySelectorAll('[data-axt-state="translated"]')]
    .filter(el => {
      const id = el.getAttribute('data-axt-id')
      return !id || !document.querySelector(`.axt-t[data-axt-for="${CSS.escape(id)}"]:not(.axt-mirror, .axt-pending, .axt-error)`)
    })
    .map(el => `${el.tagName}.${[...el.classList].filter(c => c.startsWith('ltx_'))[0] ?? ''}`)
    .slice(0, 5))
  check('逐屏滚到底：每个翻完的块都能找到自己的译文节点，没滚到的不请求',
    !!last && last.requested > first.requested && last.done === last.requested && last.failed === 0
    && dom.pendingNodes === 0 && orphans.length === 0,
    `${last?.text ?? '(no idle after scroll)'}; 没有译文的已完成块 ${JSON.stringify(orphans)}; DOM ${JSON.stringify(dom)}`)
  const peak = peakPerSecond(requests)
  // 攒批（§8.3）：整篇的段落要攒成大请求。2026-09-06 之前只有 LLM 攒批，google-web 一次调用一个请求，
  // 实测 213 块发了 65 个请求、平均 4.2 段/请求；修好后 190 块只用 21 个、平均 11.2 段
  const items = requests.reduce((n, r) => n + r.items, 0)
  const perRequest = requests.length ? items / requests.length : 0
  check('google-web 攒批：整篇的段落攒成大请求，不是一段一个', requests.length > 0 && perRequest >= 5, `${requests.length} 个请求带 ${items} 段，平均 ${perRequest.toFixed(1)} 段/请求`)
  // 并发闸（§8.3）：google-web 声明 maxConcurrent 2，同时在飞不能超过它。速率 20/s、突发 8 只兜病态情况
  const concurrent = requests.reduce((p, a) => Math.max(p, requests.filter(b => b.t <= a.t && b.end > a.t).length), 0)
  check('google-web 并发：同时在飞 ≤ 2（provider 声明的 maxConcurrent）', requests.length > 0 && concurrent <= 2, `同时在飞峰值 ${concurrent}，1 秒窗口峰值 ${peak}`)
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
  check('恢复原文后没有译文残留、没有 data-axt-*（扫全部属性名，不是只查两个）',
    after.translations === 0 && after.marked === 0 && !after.on,
    `${JSON.stringify(after)}；恢复前已有 ${partial} 段译文`)
  check('恢复原文后不再发新请求（排队的批次被撤）', late === 0, `恢复前 ${requestsBefore} 个请求，恢复 0.5 s 后新增 ${late} 个`)
  check('恢复原文后标签页标题变回原文', (await page.title()) === originalTitle, `${await page.title()}；日志：${logs.find(l => /translation stopped/.test(l.text))?.text ?? '(no stopped line)'}`)
  await popup.screenshot({ path: `${SHOTS}/popup-after-restore.png` })
  await popup.close()
  await page.close()
}

// ── 关掉标签页：background 的队列跟着撤（Codex 在 #59 指出）──────────────
// 请求搬回 background 之后，销毁 content script 不再销毁这些工作。不撤的话，关掉的标签页还会
// 继续发付费请求，直到批次耗尽预算（单批最长 180 秒）。
{
  const { requests, off } = trackRequests(GOOGLE)
  const page = await context.newPage()
  // 视口放高：默认 900 px 的首屏只攒得出十几个 pending，全塞得进两个在飞的请求里，证不出"有排队的活"
  await page.setViewportSize(BACKLOG_VIEWPORT)
  await page.goto(`https://arxiv.org/html/${PAPER2}#axt-translate`, { waitUntil: 'domcontentloaded' })
  // 队列里得真有还没发出去的活，关掉之后才谈得上"还会不会发请求"；不这么做断言等于空转
  // （首次写这条时首屏正好全命中缓存，只发出 2 个请求，测不出任何东西）。
  // 边滚边等到排队量攒起来那一刻再关，而不是滚完、等够 5 个请求、再碰运气读 pending（issue #82、#95）
  const backlog = await awaitBacklog(page, { requests, ready: () => requests.length >= 5 })
  const before = requests.length
  const tClose = Date.now()
  await page.close()
  await sleep(8_000)
  const late = requests.filter(r => r.t > tClose + 500).length
  off()
  check('关掉标签页后 background 不再发新请求（会话随标签页撤掉）', before >= 5 && backlog.queued >= MIN_QUEUED && late === 0,
    `关闭时 ${backlog.pending} 个块待译、在飞 ${backlog.inFlight} 段 → 排队 ${backlog.queued} 段，已发 ${before} 个请求；关闭 0.5 s 后新增 ${late} 个`)
}

// ── 导航离开：tabs.onRemoved 不覆盖这种情况（Codex 在 #59 指出）──────────
{
  const { requests, off } = trackRequests(GOOGLE)
  const page = await context.newPage()
  await page.setViewportSize(BACKLOG_VIEWPORT)
  await page.goto(`https://arxiv.org/html/${PAPER3}#axt-translate`, { waitUntil: 'domcontentloaded' })
  const backlog = await awaitBacklog(page, { requests, ready: () => requests.length >= 5 })
  const before = requests.length
  const tLeave = Date.now()
  // 跳到非 arXiv 页面：content script 没了，也永远不会再发新的 scope 过来
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' })
  await sleep(8_000)
  const late = requests.filter(r => r.t > tLeave + 500).length
  off()
  await page.close()
  check('导航离开后 background 不再发新请求（会话随导航撤掉）', before >= 5 && backlog.queued >= MIN_QUEUED && late === 0,
    `离开时 ${backlog.pending} 个块待译、在飞 ${backlog.inFlight} 段 → 排队 ${backlog.queued} 段，已发 ${before} 个请求；离开 0.5 s 后新增 ${late} 个`)
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

  // 「测试连接」问的是配置的那个端点通不通，必须如实报 auth：走降级链的话免费引擎会把它显示成成功，
  // 用户以为 key 没问题、整页却都在用 Google 翻（issue #42 的同一类不一致，方向相反）
  await options.getByRole('button', { name: /测试连接/ }).click()
  const bogusTest = await (await options.waitForSelector('main p[style*="background"]', { timeout: 30_000 })).textContent()
  check('错 key 时设置页测试连接如实报失败，不被降级链掩盖', /失败/.test(bogusTest ?? '') && /auth/.test(bogusTest ?? ''), bogusTest)

  const { page, logs, requests } = await openPaper(PAPER, 'openrouter.ai')
  const done = await waitForLog(logs, IDLE, 90_000)
  await sleep(2_000)
  const idle = idleOf(done)
  // 降级那条 console.warn 现在打在 background 的控制台里，页面上看不到（§8.0）；
  // 「确实试过首选引擎」改由 OpenRouter 的请求数作证，「用户看得见」由下面的 popup 检查作证
  check('错 key + 降级开启：切到免费引擎，整页照常翻完、没有致命错误',
    !!idle && idle.failed === 0 && idle.done > 0 && !/fatal:/.test(done?.text ?? '') && requests.length > 0,
    `${done?.text ?? '(no idle line)'}；OpenRouter 请求 ${requests.length} 个`)

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

  // 401 回来的时刻要记下来：断言"这之后不再有新请求"，而不是数首波有几个——
  // 首波个数取决于令牌桶的突发节奏，快一点慢一点都会让 ≤ 20 这条落空（issue #82）
  let firstAuthFailure = Number.POSITIVE_INFINITY
  const onAuthResponse = response => {
    if (response.url().includes('openrouter.ai') && response.status() === 401) {
      firstAuthFailure = Math.min(firstAuthFailure, Date.now())
    }
  }
  context.on('response', onAuthResponse)
  const { page, logs, requests } = await openPaper(PAPER, 'openrouter.ai')
  const done = await waitForLog(logs, IDLE, 60_000)
  // 报 fatal 之后**把整篇滚一遍**：这才是能证伪的做法（Codex 在 #95 指出旧写法的 1 秒窗口太宽）。
  // 旧写法只看首个 401 之后 1 秒内有没有新请求，可那一秒里本来就还有同一波在飞的批次要收尾，
  // 数字是几都说明不了问题；实测那一秒里正好还有第二波 7 个请求，被窗口整个盖住。
  //
  // 第二波本身不是重试：8 个批次占满并发槽同时挨 401，剩下的块是**之后**才攒成批入队的，
  // 队列的 failQueue 只排空当下排着的那些。真正要守的承诺是**会话整个停下**——
  // 292 个块里只碰了首屏那一小撮，剩下 200 多个再也不发。滚一遍就是对这条承诺的证伪试验：
  // fatal 没把观察器摘掉的话，剩下的块会逐屏进入视口继续烧配额。
  const EVENT_JITTER_MS = 50 // idle 那行的时刻取自 console 监听器、请求时刻取自 request 监听器，各自 Date.now()
  const idle = idleOf(done)
  await scrollThrough(page)
  await sleep(3_000)
  context.off('response', onAuthResponse)
  const afterIdle = requests.filter(r => r.t > (done?.t ?? 0) + EVENT_JITTER_MS)
  const offsets = requests.map(r => Math.round(r.t - firstAuthFailure)).sort((a, b) => a - b)
  check('错 key + 降级关闭：401 之后整个会话停下，滚到底也不再发请求',
    Number.isFinite(firstAuthFailure) && /fatal: auth/.test(done?.text ?? '')
      && (idle?.requested ?? 0) < (idle?.total ?? 0) // 还有没请求过的块，滚一遍才证伪得了
      && afterIdle.length === 0,
    `${idle?.requested}/${idle?.total} 个块请求过，共 ${requests.length} 个请求（相对首个 401 的时刻 ${offsets.join('/')} ms）；报 fatal 后整篇滚一遍新增 ${afterIdle.length} 个；${done?.text ?? '(no idle line)'}；DOM ${JSON.stringify(await countDom(page))}`)
  const widgets = await page.evaluate(() => document.querySelectorAll('.axt-error').length)
  check('失败块旁有重试 / 原因小部件（§7.6）', !!idle && widgets > 0 && widgets === idle.failed, `${widgets} 个小部件，${idle?.failed ?? '?'} 个失败块`)
  await page.close()
}

// ── only 模式的页内锚点（issue #44）─────────────────────────────────
// only 把有译文的原块 display:none，指向它们的交叉引用就没了落点。实测修复前
// 点「§7」（目标是隐藏的 p.ltx_p）scrollY 从 0 到 0，一动不动。12 篇 fixture 里
// 3374 个页内锚点有 118 个（3.5%）的目标落在翻译块内
{
  // 前面的错 key 段把 provider 改成了带假 key 的 openai-compat 且关了降级：先切回免费引擎
  await options.bringToFront()
  await options.selectOption('select >> nth=0', 'google-web')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

  const { page, logs } = await openPaper(PAPER4, 'translate-pa.googleapis.com')
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  // openPaper 用 #axt-translate 自动开翻，这里只切模式——切换只改 <html> 上的属性，不重翻
  await popup.getByRole('button', { name: '仅译文', exact: true }).waitFor({ timeout: 10_000 })
  await popup.getByRole('button', { name: '仅译文', exact: true }).click()
  await sleep(500)
  await popup.close()
  await scrollThrough(page)
  await waitForLog(logs, IDLE, 60_000)
  await page.evaluate(() => scrollTo(0, 0))
  await sleep(1500)

  const r = await page.evaluate(() => {
    const vis = el => el.getClientRects().length > 0
    const hidden = [...document.querySelectorAll('a[href^="#"]')].map(a => {
      const t = document.getElementById(decodeURIComponent(a.getAttribute('href').slice(1)))
      return t && !vis(t) ? { a, t } : null
    }).filter(Boolean)
    if (hidden.length === 0) return { candidates: 0 }
    const { a, t } = hidden[0]
    const before = scrollY
    a.click()
    const id = t.getAttribute('data-axt-id') ?? t.closest('[data-axt-id]')?.getAttribute('data-axt-id')
    const node = document.querySelector(`.axt-t[data-axt-for="${id}"]:not(.axt-mirror):not(.axt-pending):not(.axt-error)`)
    const rect = node?.getBoundingClientRect()
    return {
      candidates: hidden.length,
      href: a.getAttribute('href'),
      moved: scrollY - before,
      // 落点必须是那条译文，且落在视口里——只看"滚动了"会把滚到任意位置也算通过
      landedOnTranslation: !!rect && rect.top >= -2 && rect.top < innerHeight,
      hash: location.hash,
      // 克隆节点剥了 id：整页不该出现重复 id（issue #44 的第四条验收）
      duplicateIds: (() => {
        const seen = new Set(); const dupes = new Set()
        for (const el of document.querySelectorAll('[id]')) { if (seen.has(el.id)) dupes.add(el.id); seen.add(el.id) }
        return [...dupes].slice(0, 5)
      })(),
    }
  })
  check('only 模式下指向隐藏块的锚点落到它的译文上（issue #44）',
    r.candidates > 0 && r.moved > 0 && r.landedOnTranslation && r.hash === r.href,
    `${r.candidates} 个目标不可见的锚点；点 ${r.href} 滚了 ${r.moved}px，落在译文上 ${r.landedOnTranslation}，hash ${r.hash}`)
  check('译文克隆没有制造重复 id（issue #44）', Array.isArray(r.duplicateIds) && r.duplicateIds.length === 0, `重复 id: ${JSON.stringify(r.duplicateIds)}`)
  await page.close()
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
