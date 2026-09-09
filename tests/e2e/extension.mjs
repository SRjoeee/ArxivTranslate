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
/** 6 张外部 SVG 图，其中 fig_closure 有竖排轴标签（§15.5） */
const SVG_PAPER = process.env.AXT_SVG_PAPER ?? '2609.03768'
const GOOGLE = 'translate-pa.googleapis.com'
/** 请求收尾的两个事件：成功与失败都要把 end 记上，否则它会一直算在飞 */
const SETTLED_EVENTS = ['requestfinished', 'requestfailed']
/** google-web 声明的 maxConcurrent：截住端点后能同时挂住几发，也就是"槽位占满"的判据 */
const GOOGLE_SLOTS = 2

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
  // --expose-gc lets the page force a collection: the sentence-highlight registry has to let a
  // restored page drop its translations, and that is only checkable where GC actually runs
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--js-flags=--expose-gc'],
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
 * 截住发往 host 的请求：route 处理器只登记、不放行，请求就一直挂着占着一个并发槽。
 *
 * 为什么要截（issue #82，Codex 在 #95 追加）：撤销类断言必须在"队列里确实还有没发出去的活"
 * 那一刻动手，否则"撤掉之后零新请求"是空断言。这件事从 DOM 反推是推不出来的——命中缓存的块在
 * 查缓存**之前**就挂上了 pending 节点、根本不会产生请求，刚收尾还没渲染的请求也会被算漏，
 * 而且一个块不一定只对应一段（实测 215 个块发出 249 段），减法在大页上能算成负数。
 * 截住之后就不用推：**有多少发真的打出去了，直接数 route 命中次数**；
 * 也没有任何东西会完成，所以 pending 数一旦稳住，就说明查缓存那一轮已经跑完。
 */
async function stallEndpoint(host) {
  const held = []
  const pattern = `**://${host}/**`
  const handler = route => {
    // 原样留着请求体：下面靠它把"队列补上的新批次"和"同一批被重发"区分开
    const body = route.request().postData() ?? ''
    let items = 0
    try {
      const parsed = JSON.parse(body || 'null')
      if (Array.isArray(parsed?.[0]?.[0])) items = parsed[0][0].length
    } catch {
      // 不是 JSON 就记 0
    }
    // 不 continue / fulfill / abort：请求停在这里不动，占着一个并发槽
    held.push({ t: Date.now(), items, body, route })
  }
  await context.route(pattern, handler)
  return {
    held,
    /** 放开截住的请求，把并发槽腾出来。队列还活着的话，下一批马上就会补上 */
    release: async () => { for (const h of held.slice()) await h.route.abort().catch(() => undefined) },
    /**
     * 先摘处理器再把**所有**截住过的请求结掉（Codex 在 #95 指出）：撤销真出了回归时，release
     * 之后还会有请求进到处理器里被挂住，`unroute` 只是摘掉处理器、不会结掉它已经挂住的那些。
     * 留着不结就一直占着 google 那对队列的并发槽，后面的导航 / 降级 / only 模式几段会莫名其妙地挂住
     */
    off: async () => {
      await context.unroute(pattern, handler)
      for (const h of held) await h.route.abort().catch(() => undefined)
    },
  }
}

/**
 * 把页面推到"并发槽占满、队列里堆着一大批没发出去的活"，再做一次**正向验证**：
 * 放开一个槽位，看队列会不会补上一个**新的**批次——补上了才算真的观察到了未发出的批次，
 * 这条断言的前置条件才成立（Codex 在 #95 要的就是"直接观察到或造出未发出的批次"）。
 *
 * 判"新"要看请求体，不能只看请求数（Codex 在 #95 追加）：abort 掉截住的那一发时，provider 自己的
 * AbortSignal 并没有 abort，`google-web` 会把这次 fetch 失败归成可重试的 `network`，队列照默认
 * 退避重发同一批。只数请求数的话，那次重试会被当成"队列里还有活"，正向验证反而变成空的。
 * 同一批重发的请求体是逐字一样的，所以**出现没见过的请求体**才是新批次。
 */
async function fillQueue(page, stall, { slots = GOOGLE_SLOTS, timeoutMs = 40_000 } = {}) {
  await scrollThrough(page) // 端点截着，什么都完成不了，整篇的块都会停在 pending
  const t0 = Date.now()
  let samples = []
  let pending = 0
  while (Date.now() - t0 < timeoutMs) {
    await sleep(400)
    pending = await page.evaluate(() => document.querySelectorAll('.axt-pending').length)
    samples = [...samples.slice(-2), pending]
    if (stall.held.length >= slots && samples.length === 3 && samples.every(n => n === pending) && pending > 0) break
  }
  const items = stall.held.reduce((n, h) => n + h.items, 0)
  const requests = stall.held.length
  const known = new Set(stall.held.map(h => h.body))
  await stall.held[0]?.route.abort().catch(() => undefined)
  const isNew = () => stall.held.some(h => h.body && !known.has(h.body))
  for (let i = 0; i < 40 && !isNew(); i++) await sleep(200)
  return { requests, items, pending, confirmed: isNew(), extra: stall.held.length - requests }
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

// ── 设置页：悬停对照高亮的开关真的能改（#130：加了配置字段却没有 UI，用户关不掉） ────────
{
  const box = options.getByRole('checkbox', { name: /悬停时高亮对应的句子/ })
  const wasOn = await box.isChecked()
  await box.uncheck()
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
  await options.reload({ waitUntil: 'domcontentloaded' })
  const back = await options.getByRole('checkbox', { name: /悬停时高亮对应的句子/ }).isChecked()
  check('设置页：悬停对照高亮开关默认开、关掉后重载仍是关（§7.7）', wasOn === true && back === false, `默认 ${wasOn}，关掉重载读回 ${back}`)
  // 后面的检查要它开着
  await options.getByRole('checkbox', { name: /悬停时高亮对应的句子/ }).check()
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
}
await options.fill(marginInput, '1000')
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

// ── 设置页：图内文字翻译的模式闸（配置 v8，DESIGN §15）保存后重载仍在；**不再按 helper 灰掉** ──────
{
  const names = ['左右对照', '上下对照', '仅译文']
  const boxOf = name => options.getByRole('checkbox', { name, exact: true })
  // §15.5：helper 只决定位图，SVG 图不需要它，所以复选框任何时候都该可用
  const enabled = await boxOf('上下对照').isEnabled()
  const hint = await options.getByText(/helper/).first().textContent()
  check('设置页：图内文字翻译不因为没装 helper 而整节灰掉（§15.5）', enabled === true, `可用 ${enabled}`)
  check('设置页：提示语说清楚 helper 只影响位图', /SVG/.test(hint ?? ''), (hint ?? '').slice(0, 90))

  if (!process.env.AXT_E2E_IMAGES) {
    await boxOf('上下对照').check()
    await options.getByRole('button', { name: '保存', exact: true }).click()
    await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
    await options.reload({ waitUntil: 'domcontentloaded' })
    await options.getByRole('checkbox', { name: '上下对照', exact: true }).waitFor({ timeout: 5_000 })
    const states = await Promise.all(names.map(n => boxOf(n).isChecked()))
    check('设置页：图内文字翻译只勾「上下对照」保存后重载仍在', JSON.stringify(states) === JSON.stringify([false, true, false]), `读回 ${states.join(',')}`)
    await boxOf('上下对照').uncheck()
    await options.getByRole('button', { name: '保存', exact: true }).click()
    await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
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

// ── 微软引擎（#98）：markers 线上格式在**真实论文**上的唯一一次端到端验证 ──────────
// #104 只在 fixture 上验过恒等译文的往返；记号能不能扛住真的机器翻译（语序移位、
// 引擎自作主张改标点）只有这里能证。标签格式在这个端点上是 0%，所以它必须走 markers。
{
  await options.bringToFront()
  await options.selectOption('select >> nth=0', 'microsoft')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

  // 连接测试的样本要用这个引擎实际会收到的格式：微软只保得住 markers，
  // 发标签给它会被 provider 本地挡下，测试永远失败而正常翻译其实是好的（Codex 在 #115 指出）
  await options.getByRole('button', { name: /测试连接/ }).click()
  const msTest = await (await options.waitForSelector('main p[style*="background"]', { timeout: 30_000 })).textContent()
  check('微软引擎：设置页「测试连接」通过（样本按 markers 格式发，不是标签）',
    !/失败/.test(msTest ?? '') && /ms/.test(msTest ?? ''), msTest)

  const { page, logs, requests } = await openPaper(PAPER, 'edge.microsoft.com')
  const idle = idleOf(await waitForLog(logs, IDLE, 120_000))
  // **必须验证请求真的打到了微软**（Codex 在 #115 指出）：微软坏掉、Google 兜底成功时，
  // 下面那些「翻完了 / 节点数对得上 / 没有记号残留」全都照样成立——Google 也保得住 markers。
  // 不数请求的话这一轮验的就不是它声称要验的那个端点
  check('微软引擎：请求确实打到了微软端点，不是 Google 兜底顶上的（#98）',
    requests.length > 0, `edge.microsoft.com 请求 ${requests.length} 个`)
  check('微软引擎：首屏翻完、没有致命错误（#98）',
    !!idle && idle.requested > 0 && idle.done === idle.requested && idle.failed === 0 && !/fatal/.test(idle.text),
    idle?.text ?? '(no idle line)')

  // 记号方案的两条硬承诺：受保护节点一个不少，且没有记号漏进可见文字
  const shape = await page.evaluate(() => {
    const pairs = []
    for (const t of document.querySelectorAll('.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')) {
      const id = t.getAttribute('data-axt-for')
      const src = id ? document.querySelector(`[data-axt-id="${id}"]`) : null
      if (!src) continue
      pairs.push({ src: src.querySelectorAll('math, .ltx_Math, img, a.ltx_ref').length, out: t.querySelectorAll('math, .ltx_Math, img, a.ltx_ref').length })
    }
    const text = [...document.querySelectorAll('.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')].map(t => t.textContent ?? '').join('')
    return { pairs: pairs.length, mismatched: pairs.filter(p => p.src !== p.out).length, protectedNodes: pairs.reduce((n, p) => n + p.src, 0), markerLeak: (text.match(/@[a-z]+#/g) ?? []).length }
  })
  check('微软引擎：每个块的受保护节点数与原文一致（记号没丢公式 / 链接）',
    shape.pairs > 0 && shape.mismatched === 0 && shape.protectedNodes > 0,
    `${shape.pairs} 对配对，${shape.protectedNodes} 个受保护节点，对不上的 ${shape.mismatched} 个`)
  check('微软引擎：译文里没有记号残留', shape.markerLeak === 0, `残留 ${shape.markerLeak} 处`)

  // ── 悬停对照高亮（§7.7，#105）：只有这条路径能证 ─────────────────────────────
  // 单元测试把浏览器那半边全打了桩（happy-dom 没有 CSS.highlights，Range 也读不回来），
  // 而对齐只有微软会报，所以「真的画在了两侧对应的那一句上」只能在这里验。
  const hover = await page.evaluate(async () => {
    const at = document.querySelector('.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')
    const id = at?.getAttribute('data-axt-for')
    const src = id ? document.querySelector(`[data-axt-id="${id}"]`) : null
    if (!at || !src) return { reason: 'no translated block' }
    const before = document.documentElement.outerHTML
    // 指针放在译文里第一行文字上
    const rect = at.getBoundingClientRect()
    at.dispatchEvent(new PointerEvent('pointermove', { clientX: rect.left + 8, clientY: rect.top + 6, bubbles: true }))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const textOf = name => [...(CSS.highlights.get(name) ?? [])].map(r => r.toString()).join('')
    return {
      source: textOf('axt-sentence-source'),
      target: textOf('axt-sentence-target'),
      registries: CSS.highlights.size,
      // 高亮一个 DOM 节点都不许碰（§7.1）
      domUnchanged: before === document.documentElement.outerHTML,
      inSource: src.textContent?.includes(textOf('axt-sentence-source')) ?? false,
      inTarget: at.textContent?.includes(textOf('axt-sentence-target')) ?? false,
    }
  })
  check('悬停对照高亮：原文与译文两侧同时亮起（§7.7 / #105）',
    hover.registries === 2 && (hover.source?.length ?? 0) > 0 && (hover.target?.length ?? 0) > 0,
    `注册表 ${hover.registries} 个，原文 ${hover.source?.length ?? 0} 字、译文 ${hover.target?.length ?? 0} 字${hover.reason ? ` (${hover.reason})` : ''}`)
  check('悬停对照高亮：两侧选中的都是各自块里的文字，没有跨块',
    hover.inSource === true && hover.inTarget === true, `原文命中 ${hover.inSource}、译文命中 ${hover.inTarget}`)
  check('悬停对照高亮：一个 DOM 节点都没动（§7.1）',
    hover.domUnchanged === true, `DOM ${hover.domUnchanged ? '未变' : '变了'}`)

  // 悬停高亮的注册表不能因为原块还在文档里就把摘掉的译文永远留住（Codex 在 #130 指出）。
  // happy-dom 不释放任何已摘除的节点——对照实验里连什么都不引用的 <p> 都收不掉——所以这条只有
  // 在真浏览器里才测得了。
  //
  // 判据是「残留数不随译文数增长」，不是「一个都不剩」：实测有 1 个块（S1.p2.1）被页面里别的
  // 东西吊着，从头到尾不悬停也一样，与注册表无关。用旧写法量过对照——**14 个全部留住**，
  // 所以这条阈值分得开修好与没修。
  const retained = await page.evaluate(async () => {
    if (typeof gc !== 'function') return { skipped: true }
    const nodes = [...document.querySelectorAll('.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')]
    if (nodes.length < 8) return { reason: `只有 ${nodes.length} 个译文，样本太小` }
    const watch = nodes.map(n => new WeakRef(n))
    const before = watch.length
    nodes.length = 0
    // 译文节点全部摘掉、原块留在文档里，正是会把注册表条目吊住的那种情形
    for (const n of [...document.querySelectorAll('[data-axt-for]')]) n.remove()
    CSS.highlights.clear()
    for (let i = 0; i < 8; i++) { gc(); await new Promise(r => setTimeout(r, 30)) }
    return { before, alive: watch.filter(w => w.deref() !== undefined).length }
  })
  check('悬停对照高亮：摘掉译文后注册表不再吊住它们（#130 的内存回归）',
    retained.skipped === true || (retained.alive !== undefined && retained.alive <= 2),
    retained.skipped ? '跳过（没有 gc）' : retained.reason ?? `摘掉 ${retained.before} 个译文节点后仍存活 ${retained.alive} 个（旧写法是 ${retained.before} 个全留）`)

  await page.screenshot({ path: `${SHOTS}/microsoft.png` })
  await page.close()

  // 切回 google-web，后面的检查沿用原来的引擎
  await options.bringToFront()
  await options.selectOption('select >> nth=0', 'google-web')
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
}

// ── SVG 图翻译（§15.5，#121）：不需要 helper，所以这里跑而不是在 e2e:image 里 ────────────
// 唯一能证明整条几何链路成立的地方：viewBox 坐标 → 归一化 → 主文档里的百分比 / 容器单位。
// 单元测试把 <object> 的 contentDocument 打了桩，真实的嵌套文档只有真浏览器里有
{
  await options.bringToFront()
  const svgModeBox = options.getByRole('checkbox', { name: '上下对照', exact: true })
  await svgModeBox.check()
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })

  const { page, logs } = await openPaper(SVG_PAPER, GOOGLE)
  await waitForLog(logs, IDLE, 120_000)
  // 图是按视口调度的，滚一遍把它们都放出来，然后**等图片这一轮自己报完**——
  // 上面那条 `session idle` 只说明正文翻完了，图是滚动之后才排进去的。
  // 固定睡 3 秒在慢一点或被限流的端点上会让合法的叠加层晚于断言到达，测试就间歇性失败
  //（Codex 在 #134 指出）
  await scrollThrough(page)
  /**
   * 等到**每一张有字的 SVG 图都拿到叠加层**，而不是等一个日志或者等计数「看起来稳了」。
   *
   * 前一版等 `images idle` 再看计数连着两次不变：图是分批放出来的，`waitForLog` 用 `find` 扫全表、
   * 会匹配到更早的那次部分完成（实测跑出过 `1/1 of 9`），而两次采样之间如果完成间隔超过 500ms
   * 也会提前退出（Codex 在 #134 指出）。应有的数量能在页内按图自己算出来，就不必猜
   */
  const expected = await page.evaluate(() => {
    const CODE = /->|=>|==|!=|::|>>|<<|&&|\|\||\w_\w|[;{}]\s*$|^\d+\s{2,}/
    let n = 0
    for (const o of document.querySelectorAll('object[type="image/svg+xml"]')) {
      const d = o.contentDocument
      if (!d) continue
      const words = [...d.querySelectorAll('use[data-text]')].map(u => u.getAttribute('data-text') ?? '').join('')
      if (/\p{L}{2,}/u.test(words) && !CODE.test(words)) n++
    }
    return n
  })
  // 两个条件都要：**至少**达到这个下界，**并且**连着两次采样不再变。
  // 页内那个判断是把整张图的 data-text 拼起来一把过的粗判，会少数（实测 5 张图它只算出 4 张），
  // 所以它只是下界；而单靠「稳定」在完成间隔大于采样间隔时会提前退出。两条一起才夹得住
  let overlays = -1
  let stable = 0
  for (let i = 0; i < 80; i++) {
    const now = await page.evaluate(() => document.querySelectorAll('.axt-img').length)
    stable = now === overlays ? stable + 1 : 0
    overlays = now
    if (overlays >= expected && stable >= 2) break
    await sleep(800)
  }
  check('SVG 图：每张有字的图都拿到了叠加层（下面的断言以它为前提）',
    expected > 0 && overlays >= expected && stable >= 2, `${overlays} 个叠加层，下界 ${expected}，稳定 ${stable} 次`)

  const svg = await page.evaluate(() => {
    const objs = [...document.querySelectorAll('object[type="image/svg+xml"]')]
    const out = { objects: objs.length, reachable: 0, overlays: 0, sibling: 0, aligned: 0, rotated: 0, labels: [], covered: [] }
    for (const o of objs) {
      if (o.contentDocument?.querySelector('svg')) out.reachable++
      const next = o.nextElementSibling
      if (!next?.classList.contains('axt-img')) continue
      out.overlays++
      out.sibling++
      const a = o.getBoundingClientRect()
      const b = next.getBoundingClientRect()
      // 锚点定位：叠加层的矩形应当与 <object> 的矩形重合
      if (Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2) out.aligned++
      for (const span of next.querySelectorAll('span')) {
        const style = span.getAttribute('style') ?? ''
        if (style.includes('rotate(')) out.rotated++
        if (out.labels.length < 8) out.labels.push(span.getAttribute('title'))
        // **整条几何链路的端到端检查**：白框应当正好盖住它译的那段原文字。
        // 把叠加层的框换成图的归一化坐标，与内文档里那几个字形的实际范围比——
        // 两者都归一化到 <object> 的框，所以 viewBox → 归一化 → 主文档百分比 / 容器单位
        // 这一整串只要有一处错，差值就会露出来
        const title = span.getAttribute('title') ?? ''
        const d = o.contentDocument
        const chars = [...(d?.querySelectorAll('use[data-text]') ?? [])]
        if (title && d) {
          const iw = d.defaultView.innerWidth, ih = d.defaultView.innerHeight
          const s = span.getBoundingClientRect()
          const box = { l: (s.left - a.left) / a.width, r: (s.right - a.left) / a.width, t: (s.top - a.top) / a.height, b: (s.bottom - a.top) / a.height }
          // 同一串文字可能在图里出现多次（`epoch` 也是 `wall time per epoch [ms]` 的一部分），
          // 取**最贴合的那一处**：找错了实例会报出一个与产品无关的巨大差值
          let best = null
          for (let i = 0; i + title.length <= chars.length; i++) {
            if (chars.slice(i, i + title.length).map(c => c.getAttribute('data-text')).join('') !== title) continue
            const rs = chars.slice(i, i + title.length).map(c => c.getBoundingClientRect())
            const g = { l: Math.min(...rs.map(r => r.left)) / iw, r: Math.max(...rs.map(r => r.right)) / iw, t: Math.min(...rs.map(r => r.top)) / ih, b: Math.max(...rs.map(r => r.bottom)) / ih }
            const slack = Math.max(box.l - g.l, g.r - box.r, box.t - g.t, g.b - box.b)
            if (best === null || slack < best) best = slack
          }
          if (best !== null) out.covered.push({ title, slack: +best.toFixed(4) })
        }
      }
    }
    return out
  })
  check('SVG 图：嵌套文档全部可达（§15.5）',
    svg.objects > 0 && svg.reachable === svg.objects, `${svg.reachable}/${svg.objects} 张可读`)
  check('SVG 图：叠加层作为 <object> 的下一个兄弟插入，没装 helper 也照翻',
    svg.overlays > 0 && svg.sibling === svg.overlays, `${svg.overlays} 个叠加层，全部是下一个兄弟`)
  check('SVG 图：叠加层的矩形与图重合（锚点定位对 <object> 成立）',
    svg.overlays > 0 && svg.aligned === svg.overlays, `${svg.aligned}/${svg.overlays} 张对齐`)
  check('SVG 图：标签来自图里真实的文字，不是 OCR 认出来的',
    svg.labels.some(t => /[A-Za-z]{3,}/.test(t ?? '')), JSON.stringify(svg.labels.slice(0, 4)))
  check('SVG 图：竖排的轴标签被转过来了（§15.5）',
    svg.rotated > 0, `${svg.rotated} 个竖排标签`)
  // 每个白框都要盖住它译的那段原文字：正的 slack 表示某一边露了出来
  // 0.002 是亚像素：实测最大 0.0009，抗锯齿与四舍五入的量级
  const uncovered = svg.covered.filter(c => c.slack > 0.002)
  check('SVG 图：白框盖住它译的那段原文字（viewBox → 屏幕的整条几何链路）',
    svg.covered.length > 0 && uncovered.length === 0,
    `${svg.covered.length} 个标签比对，最大露出 ${Math.max(0, ...svg.covered.map(c => c.slack)).toFixed(4)}；${JSON.stringify(uncovered.slice(0, 3))}`)

  await page.screenshot({ path: `${SHOTS}/svg-figures.png`, fullPage: false })

  const after = await page.evaluate(() => {
    const r = { before: document.querySelectorAll('.axt-img').length }
    return r
  })
  check('SVG 图：确实插了叠加层（恢复检查的前置）', after.before > 0, `${after.before} 个`)
  await page.close()

  await options.bringToFront()
  await svgModeBox.uncheck()
  await options.getByRole('button', { name: '保存', exact: true }).click()
  await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
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
  const stall = await stallEndpoint(GOOGLE)
  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER2}#axt-translate`, { waitUntil: 'domcontentloaded' })
  // 队列里得真有还没发出去的活，关掉之后才谈得上"还会不会发请求"；不这么做断言等于空转
  // （首次写这条时首屏正好全命中缓存，只发出 2 个请求，测不出任何东西）
  const q = await fillQueue(page, stall)
  const before = stall.held.length
  await page.close()
  await sleep(500)
  await stall.release() // 把槽位腾出来：队列还活着的话，下一批立刻就会打出来
  await sleep(6_000)
  const late = stall.held.length - before
  await stall.off()
  check('关掉标签页后 background 不再发新请求（会话随标签页撤掉）',
    q.confirmed && q.requests === GOOGLE_SLOTS && late === 0,
    `${q.pending} 个块待译，只有 ${q.requests} 发（${q.items} 段）打到过端点；放开一个槽位后队列补上 ${q.extra} 发、其中${q.confirmed ? '有没见过的请求体（确有排队的新批次，不是同一批重发）' : '全是同一批重发——队列里没有排队的活，这条断言无效'}；关掉标签页再放开全部槽位后新增 ${late} 个`)
}

// ── 导航离开：tabs.onRemoved 不覆盖这种情况（Codex 在 #59 指出）──────────
{
  const stall = await stallEndpoint(GOOGLE)
  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER3}#axt-translate`, { waitUntil: 'domcontentloaded' })
  const q = await fillQueue(page, stall)
  const before = stall.held.length
  // 跳到非 arXiv 页面：content script 没了，也永远不会再发新的 scope 过来
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' })
  await sleep(500)
  await stall.release()
  await sleep(6_000)
  const late = stall.held.length - before
  await stall.off()
  await page.close()
  check('导航离开后 background 不再发新请求（会话随导航撤掉）',
    q.confirmed && q.requests === GOOGLE_SLOTS && late === 0,
    `${q.pending} 个块待译，只有 ${q.requests} 发（${q.items} 段）打到过端点；放开一个槽位后队列补上 ${q.extra} 发、其中${q.confirmed ? '有没见过的请求体（确有排队的新批次，不是同一批重发）' : '全是同一批重发——队列里没有排队的活，这条断言无效'}；导航离开再放开全部槽位后新增 ${late} 个`)
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
  // 401 到达的**那一刻已经发出过几个请求**。用序号切、不用时间切（Codex 在 #95 指出）：
  // 时间上留任何容差，都会把"槽位一腾出就立刻补发"的那些划到 401 之前、两个判据都管不到。
  // 已经在飞的请求，它们的 `request` 事件必然早于这个 401 的 `response` 事件，序号就是精确的分界
  let sentAtAuth = -1
  // 401 与 403 都算（Codex 在 #95 指出）：网关用 403 拒掉假 key 时，`openai-compat` 一样归成 auth、
  // retry-policy 一样按整队排空处理，只听 401 会让这条断言在产品行为正确时反而红
  const onAuthResponse = response => {
    if (!response.url().includes('openrouter.ai')) return
    if (response.status() !== 401 && response.status() !== 403) return
    if (Number.isFinite(firstAuthFailure)) return
    firstAuthFailure = Date.now()
    sentAtAuth = requests.length
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
  // idle 那行的时刻取自 console 监听器、请求时刻取自 request 监听器，各自 Date.now()，先后可能差几毫秒。
  // 这点容差在这里遮不住任何东西：401 之后的请求已经由下面按序号切出来的 afterAuth 全数管着，
  // 这一条只负责"滚一遍之后还有没有"，那种请求会落在 idle 之后好几秒
  const EVENT_JITTER_MS = 50
  const idle = idleOf(done)
  await scrollThrough(page)
  await sleep(3_000)
  context.off('response', onAuthResponse)
  // 首个 401 到 idle 之间那一段（Codex 在 #95 追加）。#96 修好之后这里是**零**：
  // 那之前 `failQueue` 只排空当下排在 RequestQueue 里的任务，剩下的块还在 BatchQueue 里攒批、不在场，
  // 攒完照常派发，于是必然还有一波（实测 +75~279 ms、7 个请求）。现在致命状态黏在引擎的队列对上，
  // 后到的批次在 executeBatch 里当场拒掉，一个端点请求都不发。
  // 这条同时卡住两种回归：队列没排空的话批次会随槽位腾出陆续摊开；批次被重试的话退避至少 1 秒。
  // 两种都会让 afterAuth 非空。
  const beforeAuth = requests.slice(0, Math.max(sentAtAuth, 0))
  const afterAuth = requests.slice(Math.max(sentAtAuth, 0))
  const afterIdle = requests.filter(r => r.t > (done?.t ?? 0) + EVENT_JITTER_MS)
  const offsets = requests.map(r => Math.round(r.t - firstAuthFailure)).sort((a, b) => a - b)
  check('错 key + 降级关闭：401 之后整个会话停下，滚到底也不再发请求',
    Number.isFinite(firstAuthFailure) && sentAtAuth >= 0 && /fatal: auth/.test(done?.text ?? '')
      && (idle?.requested ?? 0) < (idle?.total ?? 0) // 还有没请求过的块，滚一遍才证伪得了
      && afterAuth.length === 0 // 401 之后一个请求都不再发（#96）
      && afterIdle.length === 0,
    `${idle?.requested}/${idle?.total} 个块请求过，共 ${requests.length} 个请求（相对首个 401 的时刻 ${offsets.join('/')} ms）；401 之前 ${beforeAuth.length} 个、之后 ${afterAuth.length} 个（应为 0，#96）；报 fatal 后整篇滚一遍新增 ${afterIdle.length} 个；${done?.text ?? '(no idle line)'}；DOM ${JSON.stringify(await countDom(page))}`)
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
