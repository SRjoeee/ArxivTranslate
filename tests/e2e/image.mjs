// 图片翻译的端到端检查（DESIGN §15）：真实 Chromium + 本机 helper。没装 helper 的机器打印 SKIP、退出 0（CI）。
//
// 用法：pnpm build && pnpm e2e:image   （先 helper/install.sh <扩展 id>）
// 环境变量：AXT_PAPER 换论文（默认 2507.00150v1：6 张曲线图）；AXT_HEADED=1 看着跑。
//
// 守的是 §15.2 的几条结构性承诺：叠加层是图的下一个兄弟且矩形与图重合（锚点定位）；side 下叠加层只在拆图副本里且
// 与副本的图重合；only 下可见；模式闸关着时进入视口的图不请求、切到开着的模式才翻；恢复原文一个节点、一个属性都不剩。
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile-image`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2507.00150v1'
const HOST = 'io.github.srjoeee.arxivtranslate'
/** 安装脚本写的位置；Chrome 找的是 <用户数据目录>/NativeMessagingHosts/，得复制进 Playwright 的 profile */
const INSTALLED = `${homedir()}/Library/Application Support/Chromium/NativeMessagingHosts/${HOST}.json`

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
if (!existsSync(INSTALLED)) {
  console.log(`SKIP 没有 helper 的 host manifest（${INSTALLED}），图片翻译 e2e 不跑`)
  process.exit(0)
}
mkdirSync(`${PROFILE}/NativeMessagingHosts`, { recursive: true })
copyFileSync(INSTALLED, `${PROFILE}/NativeMessagingHosts/${HOST}.json`)

const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: !process.env.AXT_HEADED,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 900 },
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]

const IDLE = /session idle: (\d+)\/(\d+) requested of (\d+)/
const IMAGES_IDLE = /images idle: (\d+)\/(\d+) of (\d+), (\d+) failed/
async function waitForLog(logs, pattern, timeoutMs, predicate = () => true) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    const hit = logs.find(entry => pattern.test(entry.text) && predicate(pattern.exec(entry.text)))
    if (hit) return hit
    await sleep(250)
  }
  return null
}
/** 逐屏往下滚，每步重读高度：译文插进来页面会变长，按初始高度滚会漏掉最后几屏 */
async function scrollThrough(page) {
  for (let y = 0; ; y += 800) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    if (y > height) break
    await page.evaluate(top => window.scrollTo(0, top), y)
    await sleep(150)
  }
}
/** 每张位图与它的叠加层（同一父元素里 data-axt-for 指向它的）的矩形与可见性 */
const PROBE = () => {
  const out = []
  for (const img of document.querySelectorAll('img.ltx_graphics')) {
    const overlay = img.nextElementSibling?.classList.contains('axt-img') ? img.nextElementSibling : null
    const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height } }
    const visible = el => !!el && getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0
    const inClone = !!img.closest('.axt-split')
    const inSplitOriginal = !!img.closest('[data-axt-split]')
    out.push({
      id: img.id || img.getAttribute('data-axt-split-of') || '',
      inClone, inSplitOriginal,
      imgVisible: visible(img),
      overlay: overlay ? { visible: visible(overlay), labels: overlay.children.length, rect: rect(overlay), labelFont: overlay.firstElementChild ? Number.parseFloat(getComputedStyle(overlay.firstElementChild).fontSize) : 0 } : null,
      imgRect: rect(img),
    })
  }
  return out
}
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol
const coincide = (a, b) => near(a.x, b.x) && near(a.y, b.y) && near(a.w, b.w) && near(a.h, b.h)

// ── 设置页：google-web，图片翻译三种模式都勾上；helper 没检测到就退出 ────────────
const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'google-web')
const stackBox = options.getByRole('checkbox', { name: '上下对照', exact: true })
await stackBox.waitFor({ timeout: 10_000 })
if (!(await stackBox.isEnabled())) {
  const hint = await options.getByText(/helper/).first().textContent()
  console.log(`SKIP 设置页说 helper 不可用：${hint}`)
  await context.close()
  process.exit(0)
}
for (const name of ['左右对照', '上下对照', '仅译文']) await options.getByRole('checkbox', { name, exact: true }).check()
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
const helperHint = await options.getByText(/已检测到 helper/).first().textContent()
check('设置页检测到 helper', /helper \d/.test(helperHint ?? ''), helperHint ?? '')

// ── stack：整页翻译，6 张图都叠上译文，叠加层与图重合 ─────────────────────────
const page = await context.newPage()
const logs = []
page.on('console', m => { const text = m.text(); if (text.includes('[axt]')) logs.push({ t: Date.now(), text }) })
await page.goto(`https://arxiv.org/html/${PAPER}#axt-translate`, { waitUntil: 'domcontentloaded' })
// 位图数从 content 的日志里取，换论文（AXT_PAPER）时期望跟着变（Codex 在 #89 指出）
const bitmaps = await waitForLog(logs, /\[axt\] images: (\d+) bitmaps/, 20_000)
const N = bitmaps ? +/(\d+) bitmaps/.exec(bitmaps.text)[1] : 0
check('content 认出了页面上的位图', N >= 1, bitmaps?.text ?? '没有 images 日志')
await scrollThrough(page)
const idle = await waitForLog(logs, IMAGES_IDLE, 90_000, m => +m[2] === N && +m[1] + +m[4] === N)
check(`stack：${N} 张位图都进入并处理完（images idle）`, !!idle, idle?.text ?? logs.filter(l => /images/.test(l.text)).map(l => l.text).join(' | '))
await sleep(500)
let probe = await page.evaluate(PROBE)
const withOverlay = probe.filter(p => p.overlay)
// 不是每张图都有叠加层：只有数字与单字母的图、译文与原文相同的（单位、变量名）不画。默认论文 2507.00150v1 的 6 张里 5 张有坐标轴文字
const minOverlays = PAPER === '2507.00150v1' ? 5 : 1
check(`stack：有可翻文字的图都有叠加层（≥ ${minOverlays} 张），每层至少一个标签`, withOverlay.length >= minOverlays && withOverlay.every(p => p.overlay.labels >= 1), probe.map(p => `${p.id}:${p.overlay?.labels ?? 0}`).join(' '))
check('stack：叠加层矩形与图重合（锚点定位）', withOverlay.every(p => p.overlay.visible && coincide(p.overlay.rect, p.imgRect)), withOverlay.map(p => `${p.id} Δ(${(p.overlay.rect.x - p.imgRect.x).toFixed(1)},${(p.overlay.rect.y - p.imgRect.y).toFixed(1)},${(p.overlay.rect.w - p.imgRect.w).toFixed(1)},${(p.overlay.rect.h - p.imgRect.h).toFixed(1)})`).join(' '))
// 字号随框高：宽扁的图上标签只有三四像素，与原图上的字一样小——不设下限，读者缩放页面时一起放大
check('stack：标签字号已按容器单位解出（> 0）', withOverlay.every(p => p.overlay.labelFont > 0), withOverlay.map(p => p.overlay.labelFont.toFixed(1)).join(' '))
await page.evaluate(() => document.querySelector('img.ltx_graphics')?.scrollIntoView({ block: 'center' }))
await sleep(200)
await page.screenshot({ path: `${SHOTS}/image-stack.png` })

// ── side：插图整块拆两份，叠加层只在副本里可见、与副本的图重合 ────────────────
const popup = await context.newPage()
await popup.goto(`chrome-extension://${extId}/popup.html`)
await page.bringToFront()
await popup.getByRole('button', { name: '左右', exact: true }).waitFor({ timeout: 10_000 })
await popup.getByRole('button', { name: '左右', exact: true }).click()
await sleep(1500)
probe = await page.evaluate(PROBE)
const clones = probe.filter(p => p.inClone && p.overlay)
// 只数有叠加层的原件：图注有译文的插图本来就会拆（Figure 1 只有单位标签、没有叠加层，但图注翻了）
const originals = probe.filter(p => p.inSplitOriginal && !p.inClone && p.overlay)
const expected = withOverlay.length
check('side：有叠加层的插图都拆了，副本里有叠加层', clones.length === expected && originals.length === expected, `副本 ${clones.length}，原件 ${originals.length}，应为 ${expected}`)
check('side：叠加层只在副本里可见，原件里的隐藏', clones.every(p => p.overlay.visible) && originals.every(p => !p.overlay?.visible), `副本可见 ${clones.filter(p => p.overlay.visible).length}/${expected}，原件隐藏 ${originals.filter(p => !p.overlay?.visible).length}/${expected}`)
check('side：副本里叠加层与副本的图重合', clones.every(p => coincide(p.overlay.rect, p.imgRect)), clones.map(p => `Δ(${(p.overlay.rect.x - p.imgRect.x).toFixed(1)},${(p.overlay.rect.y - p.imgRect.y).toFixed(1)})`).join(' '))
await page.evaluate(() => document.querySelector('.axt-split img.ltx_graphics')?.scrollIntoView({ block: 'center' }))
await sleep(200)
await page.screenshot({ path: `${SHOTS}/image-side.png` })

// ── only：副本显示、叠加层可见 ─────────────────────────────────────────────
await popup.getByRole('button', { name: '仅译文', exact: true }).click()
await sleep(800)
probe = await page.evaluate(PROBE)
const visibleOnly = probe.filter(p => p.overlay?.visible)
check('only：叠加层可见（跟着显示的那份走）', visibleOnly.length === expected && visibleOnly.every(p => coincide(p.overlay.rect, p.imgRect)), `可见 ${visibleOnly.length}，应为 ${expected}`)

// ── 恢复原文：叠加层与属性一个不剩 ──────────────────────────────────────────
await popup.getByRole('button', { name: '恢复原文', exact: true }).click()
await sleep(800)
const after = await page.evaluate(() => ({
  overlays: document.querySelectorAll('.axt-img').length,
  injected: document.querySelectorAll('.axt-t, .axt-img').length,
  attrs: [document.documentElement, ...document.querySelectorAll('*')].reduce((n, el) => n + el.getAttributeNames().filter(a => a.startsWith('data-axt-')).length, 0),
}))
check('恢复原文：零叠加层、零注入节点、零 data-axt-* 属性', after.overlays === 0 && after.injected === 0 && after.attrs === 0, JSON.stringify(after))
await popup.close()

// ── 模式闸：只勾 side，stack 下进入视口的图停着不请求；切到 side 才翻 ───────────
await options.bringToFront()
await options.getByRole('checkbox', { name: '上下对照', exact: true }).uncheck()
await options.getByRole('checkbox', { name: '仅译文', exact: true }).uncheck()
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
const page2 = await context.newPage()
const logs2 = []
page2.on('console', m => { const text = m.text(); if (text.includes('[axt]')) logs2.push({ t: Date.now(), text }) })
await page2.goto(`https://arxiv.org/html/${PAPER}#axt-translate`, { waitUntil: 'domcontentloaded' })
await waitForLog(logs2, /\[axt\] images: (\d+) bitmaps/, 20_000)
await scrollThrough(page2)
await waitForLog(logs2, IDLE, 90_000)
await sleep(1000)
const parked = await page2.evaluate(() => document.querySelectorAll('.axt-img').length)
const noImagesIdle = !logs2.some(l => IMAGES_IDLE.test(l.text))
check('模式闸：stack 没勾时进入视口的图不请求、没有叠加层', parked === 0 && noImagesIdle, `叠加层 ${parked}，images idle 日志 ${noImagesIdle ? '无' : '有'}`)
const popup2 = await context.newPage()
await popup2.goto(`chrome-extension://${extId}/popup.html`)
await page2.bringToFront()
await popup2.getByRole('button', { name: '左右', exact: true }).waitFor({ timeout: 10_000 })
await popup2.getByRole('button', { name: '左右', exact: true }).click()
const resumed = await waitForLog(logs2, IMAGES_IDLE, 90_000, m => +m[1] + +m[4] >= 1)
await sleep(1500)
const afterResume = await page2.evaluate(PROBE)
const resumedClones = afterResume.filter(p => p.inClone && p.overlay?.visible)
check('模式闸：切到 side 后停着的图放出去翻、副本里出现叠加层', !!resumed && resumedClones.length >= 1, `${resumed?.text ?? '无 images idle'}；副本叠加层 ${resumedClones.length}`)
await popup2.close()

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
