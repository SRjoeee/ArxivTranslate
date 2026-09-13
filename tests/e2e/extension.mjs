// The end-to-end check in a real browser (DESIGN §11): Playwright launches a Chromium with .output/chrome-mv3 loaded (the new headless supports extensions),
// drives the settings page and the popup, reads the console and the network, and runs the main flow on a real arXiv page with the free google-web engine.
// The reader's own browser and API key are not touched; the LLM path is tested only as “wrong key → fallback to the free engine / with the fallback off the whole queue stops”, which costs nothing.
//
// Usage: pnpm build && pnpm e2e        (first time: npx playwright install chromium)
// Environment: AXT_PAPER / AXT_PAPER2 pick the papers; AXT_HEADED=1 watches it run.
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { copyWithGrants } from './ext-copy.mjs'
import { addService, chooseBuiltIn, chooseLanguage, chooseStyle, chooseUiLanguage, clearKeyAndReconnect, openOptions, openSection, pick, setImageMode, setPreload, setSwitch } from './options-page.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
/** The name of that row in the popup (S-P-82); the same name as the settings page's “Translation style” */
const S_STYLE = '译文样式'
/**
 * “The real translation”: the loading skeleton, the failure widget, and side mode's mirrors and split copies all carry .axt-t,
 * but the appearance does not decorate them and their geometry is another matter. The default mode is side (2026-09-11), so every assertion
 * that samples translations has to carry this exclusion, or it may pick a structural copy
 */
const REAL = ':not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'
const PAPER2 = process.env.AXT_PAPER2 ?? '2312.17527'
/** The third paper: none of the earlier cases touched it, so the cache is cold — the navigation case needs a real backlog to measure anything */
const PAPER3 = process.env.AXT_PAPER3 ?? '2312.17141'
/** The fourth paper: of the 12 fixtures the one with the most anchors pointing at translated blocks (64); the only-mode anchor case relies on it */
const PAPER4 = process.env.AXT_PAPER4 ?? '2609.00246'
/** 6 external SVG figures, fig_closure among them with vertical axis labels (§15.5) */
const SVG_PAPER = process.env.AXT_SVG_PAPER ?? '2609.03768'
const GOOGLE = 'translate-pa.googleapis.com'
/** The two events that close a request: success and failure both have to record end, or it counts as in flight for good */
const SETTLED_EVENTS = ['requestfinished', 'requestfailed']
/** The maxConcurrent google-web declares: how many can hang at once with the endpoint stalled, i.e. the criterion for “slots full” */
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
// Navigation to a real paper gets ample time: Playwright's default is 30 s, and arXiv slows down markedly after dozens of consecutive runs
// (measured: curl on the same paper took 26 s). No assertion's own wait is loosened; only the “get the page” step is
context.setDefaultNavigationTimeout(90_000)
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]
console.log(`extension ${extId} loaded from ${EXT}`)

/**
 * Open a paper and start translating of itself (#axt-translate), collecting the [axt] log and the requests sent to the host.
 *
 * Requests are listened for on the **context**, not the page: since 2026-09-06 the translation fetches leave from the background service worker
 * (DESIGN §8.0), and page-level events see none of them. The rings cannot be polled either — with the first screen all cached it is over in 38 ms,
 * and a 200 ms poll is bound to miss; a MutationObserver in the page records the peak instead.
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
  // The listener hangs on the **context**: since 2026-09-06 the translation fetches leave from the background service worker (DESIGN §8.0),
  // and page-level events see none of them. Removed when the page closes, so several papers do not bleed into each other
  const onRequest = request => {
    if (!request.url().includes(host)) return
    // translateHtml's request body is [[items, from, to], client]: count how many passages this request carries (direct evidence of batching)
    let items = 0
    try {
      const body = JSON.parse(request.postData() ?? 'null')
      if (Array.isArray(body?.[0]?.[0])) items = body[0][0].length
    } catch {
      // Not JSON (or an LLM endpoint, where the passages inside the prompt cannot be counted): record 0
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
  // The rings cannot be polled: with the first screen all cached it is over in 36 ms, and a 200 ms poll is bound to miss. A MutationObserver instead.
  // **Count insertions, do not sample the live count** (issue #82): MutationObserver callbacks fire in batches at microtask checkpoints,
  // and when an insertion and a removal land in the same batch, querySelectorAll in the callback already counts 0 — the peak is forever 0.
  // Recording how many ring nodes were ever inserted is independent of timing
  await page.addInitScript(() => {
    window.__axtSkeletonsSeen = 0
    const count = node => {
      if (node.nodeType !== 1) return 0
      const el = node
      return (el.classList?.contains('axt-skel') ? 1 : 0) + (el.querySelectorAll?.('.axt-skel').length ?? 0)
    }
    const start = () => new MutationObserver(list => {
      for (const m of list) for (const node of m.addedNodes) window.__axtSkeletonsSeen += count(node)
    }).observe(document.documentElement, { childList: true, subtree: true })
    if (document.documentElement) start()
    else document.addEventListener('readystatechange', start, { once: true })
  })
  await page.goto(`https://arxiv.org/html/${id}#axt-translate`, { waitUntil: 'domcontentloaded' })
  const originalTitle = await page.title()
  return { page, logs, requests, originalTitle, skeletonsSeen: () => page.evaluate(() => window.__axtSkeletonsSeen ?? 0).catch(() => 0) }
}

async function waitForLog(logs, pattern, timeoutMs, predicate = () => true) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    // The predicate is there to wait for “the one after **this** one”: the log accumulates, and find would hand back the earlier one
    const hit = logs.find(entry => { const m = pattern.exec(entry.text); return m && predicate(m) })
    if (hit) return hit
    await sleep(250)
  }
  return null
}

/**
 * Stall the requests sent to the host: the route handler only records and never releases, so the request hangs and holds a concurrency slot.
 *
 * Why stall (issue #82, Codex adding on #95): a cancellation assertion must act at the moment “the queue really still holds work not yet sent”,
 * or “zero new requests after cancelling” is an empty assertion. That cannot be deduced from the DOM — a cached block hangs its pending node
 * **before** the cache lookup and never produces a request, a request just finished but not yet rendered gets missed,
 * and a block need not map to one passage (measured: 215 blocks sent 249 passages), so the subtraction can go negative on a large page.
 * Stalled, nothing needs deducing: **how many requests really went out is the route's hit count**;
 * and nothing completes, so once the pending count settles, the cache lookup round has finished.
 */
async function stallEndpoint(host) {
  const held = []
  const pattern = `**://${host}/**`
  const handler = route => {
    // The request body is kept as it is: below it tells “a new batch the queue filled in” from “the same batch resent”
    const body = route.request().postData() ?? ''
    let items = 0
    try {
      const parsed = JSON.parse(body || 'null')
      if (Array.isArray(parsed?.[0]?.[0])) items = parsed[0][0].length
    } catch {
      // Not JSON: record 0
    }
    // No continue / fulfill / abort: the request stays here, holding a concurrency slot
    held.push({ t: Date.now(), items, body, route })
  }
  await context.route(pattern, handler)
  return {
    held,
    /** Release the stalled requests and free the concurrency slots. If the queue is still alive the next batch fills in at once */
    release: async () => { for (const h of held.slice()) await h.route.abort().catch(() => undefined) },
    /**
     * Remove the handler first, then finish **every** request ever stalled (Codex on #95): with a real cancellation regression, requests
     * still enter the handler after release and hang there, and `unroute` only removes the handler without finishing the ones it already holds.
     * Left unfinished they keep holding google's queue pair's concurrency slots, and the navigation / fallback / only-mode parts later hang for no visible reason
     */
    off: async () => {
      await context.unroute(pattern, handler)
      for (const h of held) await h.route.abort().catch(() => undefined)
    },
  }
}

/**
 * Push the page to “concurrency slots full, a big batch of unsent work piled up in the queue”, then run a **positive check**:
 * release one slot and see whether the queue fills in a **new** batch — only then was an unsent batch really observed,
 * and only then does this assertion's precondition hold (what Codex asked for on #95 was “observe or produce an unsent batch directly”).
 *
 * “New” is judged by the request body, not the request count (Codex adding on #95): aborting a stalled request does not abort the provider's own
 * AbortSignal, `google-web` classes that failed fetch as a retryable `network`, and the queue resends the same batch after the default
 * backoff. Counting requests alone, that retry passes for “the queue still has work”, and the positive check turns empty.
 * A resent batch's body is identical byte for byte, so **a body never seen before** is what marks a new batch.
 */
async function fillQueue(page, stall, { slots = GOOGLE_SLOTS, timeoutMs = 40_000 } = {}) {
  await scrollThrough(page) // with the endpoint stalled nothing can complete, and the whole paper's blocks stay pending
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

/** The most requests in any 1-second window */
function peakPerSecond(requests) {
  let peak = 0
  for (const a of requests) peak = Math.max(peak, requests.filter(b => b.t >= a.t && b.t < a.t + 1000).length)
  return peak
}

/** Translating by viewport (§10) has no “finished”: every busy-to-idle transition prints one session idle line */
const IDLE = /session idle: (\d+)\/(\d+) requested of (\d+), (\d+) failed, (\d+) cached/
const idleOf = log => { const m = IDLE.exec(log?.text ?? ''); return m ? { done: +m[1], requested: +m[2], total: +m[3], failed: +m[4], cached: +m[5], text: log.text } : null }
/** Scroll down screen by screen: jumping to the bottom at once only lets the last screen enter the observer */
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
  // The restore assertion relies on this number. **Listing a few attributes is not enough**: the renderer also injects data-axt-mode /
  // -inline / -partial / -note / -fit / -split / -for / -on, and with any one missed a leftover goes undetected
  // (Codex on #34). Every element's attribute name prefixes are scanned here, <html> included
  marked: [document.documentElement, ...document.querySelectorAll('*')]
    .reduce((n, el) => n + el.getAttributeNames().filter(a => a.startsWith('data-axt-')).length, 0),
  markedNames: [...new Set([document.documentElement, ...document.querySelectorAll('*')]
    .flatMap(el => el.getAttributeNames().filter(a => a.startsWith('data-axt-'))))].sort(),
  on: document.documentElement.hasAttribute('data-axt-on'),
}))

// ── The settings page: choose Google translation, switch image translation off (changes apply at once, there is no save button) ──────────
const options = await openOptions(context, extId)
await chooseBuiltIn(options, 'Google 翻译')
// Image translation (DESIGN §15) is on by default; with the helper installed on this machine the overlays and the split would disturb the layout / count assertions below,
// so it is switched off here, and the dedicated e2e:image switches it back on (kept when AXT_E2E_IMAGES=1)
if (!process.env.AXT_E2E_IMAGES) await setSwitch(options, '图片翻译', false)
await options.screenshot({ path: `${SHOTS}/options.png` })

// ── The settings page: changes apply at once and survive a reload (no save button since v12; the configuration is written as the control changes) ─────────────
await setPreload(options, { range: '半屏' })
await options.reload({ waitUntil: 'domcontentloaded' })
await openSection(options, 'reading')
const rangeBack = await options.getByRole('button', { name: '半屏', exact: true }).getAttribute('aria-pressed')
check('the settings page: the preload range set to half a screen is still half a screen after a reload', rangeBack === 'true', `read back aria-pressed=${rangeBack}`)

// ── The settings page: the hover highlight switch really changes (#130: a configuration field was added without a UI, and the reader could not turn it off) ────────
{
  const stateOf = async () => options.getByRole('switch', { name: '对照高亮', exact: true }).getAttribute('aria-checked')
  await openSection(options, 'reading')
  const wasOn = await stateOf()
  await setSwitch(options, '对照高亮', false)
  await options.reload({ waitUntil: 'domcontentloaded' })
  await openSection(options, 'reading')
  const back = await stateOf()
  check('the settings page: the hover highlight switch is on by default, and switched off it stays off after a reload (§7.7)', wasOn === 'true' && back === 'false', `default ${wasOn}, switched off and reloaded reads back ${back}`)
  // The checks after this need it on
  await setSwitch(options, '对照高亮', true)
}
await setPreload(options, { range: '一屏' })

// ── The settings page: the image translation mode gate (DESIGN §15) applies at once and survives a reload; **not greyed out for a missing helper** ──────
{
  const names = ['上下', '左右', '仅译文']
  const boxOf = name => options.getByRole('checkbox', { name, exact: true })
  await openSection(options, 'services')
  // §15.5: the recognition helper decides bitmaps only, SVG figures do not need it, so the checkboxes must be usable at all times
  const enabled = await boxOf('上下').isEnabled()
  check('the settings page: image translation is not greyed out whole for a missing recognition helper (§15.5)', enabled === true, `enabled ${enabled}`)

  if (!process.env.AXT_E2E_IMAGES) {
    await setImageMode(options, '上下', true)
    await setImageMode(options, '左右', false)
    await setImageMode(options, '仅译文', false)
    await options.reload({ waitUntil: 'domcontentloaded' })
    await openSection(options, 'services')
    await boxOf('上下').waitFor({ timeout: 5_000 })
    const states = await Promise.all(names.map(n => boxOf(n).isChecked()))
    check('the settings page: image translation with only “Stacked” ticked is still that one after a reload', JSON.stringify(states) === JSON.stringify([true, false, false]), `read back ${states.join(',')}`)
    await setImageMode(options, '上下', false)
  }
}

// ── The target language changed on the settings page follows into an open popup without reopening it (INVENTORY S1) ──────────────────────
// The popup and the settings page each hold a copy of the configuration and used to echo only their own writes. The paper tab stays in front (the popup looks at the active tab),
// the settings page is driven by Playwright in the background
{
  const paperTab = await context.newPage()
  await paperTab.goto(`https://arxiv.org/html/${PAPER}`, { waitUntil: 'domcontentloaded' })
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await paperTab.bringToFront()
  await popup.waitForTimeout(800)
  const languageRow = popup.getByRole('button', { name: '目标语言', exact: false })
  const before = (await languageRow.textContent()) ?? ''
  await chooseLanguage(options, '日语', '日语')
  await popup.waitForTimeout(1_200)
  const after = (await languageRow.textContent()) ?? ''
  check('the target language changed on the settings page follows into the open popup without reopening it (S1)', /简体中文/.test(before) && /日语/.test(after), `${before.trim()} → ${after.trim()}`)
  await popup.close()
  await paperTab.close()
}

// ── The settings page: the target language (the ISO 639-3 code of configuration v4) and a custom prompt apply at once and survive a reload ──────
await openSection(options, 'prompts')
await options.getByRole('button', { name: '新建', exact: true }).click()
await options.getByLabel('名称').fill('e2e 提示词')
await options.getByRole('button', { name: '加入列表', exact: true }).click()
await pick(options.getByRole('radio').last())
await options.reload({ waitUntil: 'domcontentloaded' })
await openSection(options, 'prompts')
await options.getByText('e2e 提示词').waitFor({ timeout: 5_000 }).catch(() => undefined)
await openSection(options, 'services')
const langBack = await options.getByRole('button', { name: '目标语言' }).textContent()
await openSection(options, 'prompts')
const promptRow = options.getByRole('radio').last()
const promptBack = (await options.getByText('e2e 提示词').count()) === 1 && (await promptRow.isChecked())
check('the settings page: the target language and the custom prompt survive a reload and stay selected', /日语/.test(langBack ?? '') && promptBack, `language ${langBack}, prompt ${promptBack}`)
// Delete it and choose the default again: the wrong-key part later must go through the default prompt
options.once('dialog', d => d.accept())
await options.getByRole('button', { name: '删除', exact: true }).click()
await chooseLanguage(options, '简体中文', '简体中文')
await openSection(options, 'prompts')
const promptGone = (await options.getByText('e2e 提示词').count()) === 0
check('the settings page: after deleting the custom prompt the default is chosen again', promptGone, `left over ${promptGone ? 0 : 1}`)

// ── The settings page: translation appearance and cache management (§7.5 / §9) ──────────────────────────
{
  // The built-in “Muted” only changes the opacity: the value goes through a variable written by the injected sheet on real translations, touching no node
  await options.bringToFront()
  await chooseStyle(options, '淡一档')

  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER}#axt-translate`, { waitUntil: 'domcontentloaded' })
  // Only real translations count: the loading ring / failure widget / mirrors and split clones carry .axt-t too, but the appearance deliberately does not decorate them,
  // and a poll landing on a pending node would misreport “the opacity did not apply” as a broken configuration (Codex on #52)
  await page.waitForFunction(sel => document.querySelector(sel) !== null, `.axt-t:not([data-axt-inline])${REAL}`, { timeout: 60_000 }).catch(() => undefined)
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')).opacity) < 1, null, { timeout: 30_000 }).catch(() => undefined)
  const styled = await page.evaluate(real => {
    const el = document.querySelector(`.axt-t:not([data-axt-inline])${real}`)
    const source = document.querySelector('.ltx_p:not(.axt-t)')
    return {
      opacity: el ? Number(getComputedStyle(el).opacity) : -1,
      // The source is unaffected: the appearance lands on translations only
      sourceOpacity: source ? Number(getComputedStyle(source).opacity) : null,
    }
  }, REAL)
  check('translation appearance “Muted”: the translation\'s opacity drops, the source is unaffected', styled.opacity > 0 && styled.opacity < 1 && styled.sourceOpacity === 1, JSON.stringify(styled))
  await page.screenshot({ path: `${SHOTS}/style-muted.png` })

  // The popup can change the style too (S-P-82): it goes “the popup writes the configuration → the page's configuration watcher repaints”, a different path from the settings page's,
  // and **the page is open**, so it also proves changing the style needs no new session
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByRole('button', { name: S_STYLE, exact: false }).click()
  await popup.getByRole('option', { name: '绿色', exact: true }).click()
  await popup.close()
  await page.bringToFront()
  const green = await page.evaluate(async real => {
    const el = () => document.querySelector(`.axt-t:not([data-axt-inline])${real}`)
    for (let i = 0; i < 40; i++) {
      const color = el() ? getComputedStyle(el()).color : ''
      // With “Same as the original” the translation uses the page's body colour; the green preset replaces it
      if (color && color !== getComputedStyle(document.querySelector('.ltx_p:not(.axt-t)')).color) return color
      await new Promise(r => setTimeout(r, 250))
    }
    return el() ? getComputedStyle(el()).color : 'no translation'
  }, REAL)
  const sourceColor = await page.evaluate(() => getComputedStyle(document.querySelector('.ltx_p:not(.axt-t)')).color)
  check('the popup\'s style: choosing “Green” recolours the open page at once, without a new session', green !== sourceColor && green !== 'no translation', `translation ${green}, source ${sourceColor}`)
  await page.close()

  // The underline has to be drawn on formulas: text-decoration does not propagate into atomic inline boxes like math, and a reader reported the dotted line breaking at formulas.
  // Since v12 the line style is a field of the configuration, not a preset id: create a configuration with a dashed line
  await options.bringToFront()
  await openSection(options, 'reading')
  await options.getByRole('button', { name: '添加配置', exact: true }).first().click()
  const editor = options.getByRole('dialog')
  await editor.waitFor({ timeout: 5_000 })
  await editor.getByRole('button', { name: '虚线', exact: true }).click()
  await editor.getByRole('button', { name: '完成', exact: true }).click()
  // Switch to a math-heavy paper: PAPER's first screen has no inline formula, and the check would run empty
  const dashedPage = await context.newPage()
  await dashedPage.goto('https://arxiv.org/html/2609.04056v1#axt-translate', { waitUntil: 'domcontentloaded' })
  // Both conditions have to be met (issue #82): waiting only for “the first translation with a formula appears”, the data-axt-style on `<html>`
  // may not be written yet — enable() writes it inside startTranslation, and between the session #axt-translate starts and the preset the settings page just saved
  // lies one configuration read. One run hit exactly that: 22 formulas measured, block-level none/solid; the same build rerun gave 51 underline/dashed
  await dashedPage.waitForFunction(
    real => document.documentElement.dataset.axtUnderline === 'dashed' && document.querySelectorAll(`.axt-t${real} math`).length > 0,
    REAL, { timeout: 60_000 },
  ).catch(() => undefined)
  // Then wait for the formula count to settle: read while translation is still going, it is a half state
  let stableMaths = -1
  for (let i = 0; i < 40; i++) {
    await sleep(500)
    const n = await dashedPage.evaluate(real => document.querySelectorAll(`.axt-t${real} math`).length, REAL)
    if (n === stableMaths && n > 0) break
    stableMaths = n
  }
  const dashed = await dashedPage.evaluate(real => {
    const deco = el => { const cs = getComputedStyle(el); return `${cs.textDecorationLine}/${cs.textDecorationStyle}` }
    // Only real translations count: side mode's mirrors and split copies carry .axt-t too, and the appearance deliberately does not decorate them (the same exclusion as §7.5)
    const maths = [...document.querySelectorAll(`.axt-t${real} math`)]
    const block = document.querySelector(`.axt-t:not([data-axt-inline])${real}`)
    return { count: maths.length, math: maths.slice(0, 3).map(deco), block: block ? deco(block) : null }
  }, REAL)
  check('translation appearance · dashed: the line is drawn on the formulas inside the translation (text-decoration does not propagate into atomic inline boxes)',
    dashed.count > 0 && dashed.block === 'underline/dashed' && dashed.math.every(d => d === 'underline/dashed'),
    `${dashed.count} formulas, block-level ${dashed.block}, formulas ${dashed.math.join(' ')}`)
  await dashedPage.screenshot({ path: `${SHOTS}/style-dashed.png` })
  await dashedPage.close()

}

// ── Paper 1: translate what is seen (§10): without scrolling only the first screen's surroundings; scrolled to the bottom the rest follows; the title translation; the rate ────
{
  const { page, logs, requests, originalTitle, skeletonsSeen } = await openPaper(PAPER, GOOGLE)
  const first = idleOf(await waitForLog(logs, IDLE, 120_000))
  check(`paper ${PAPER}: without scrolling only the first screen's surroundings translate (google-web)`, !!first && first.requested > 0 && first.requested < first.total && first.done === first.requested && first.failed === 0, first?.text ?? '(no idle line)')
  const skeletons = await skeletonsSeen()
  check('skeletons were inserted while requests were out (§7.6)', skeletons > 0, `${skeletons} skeletons inserted`)
  const translated = await page.title()
  check('the tab title is translated', translated !== originalTitle && /[\u4e00-\u9fff]/.test(translated), `${originalTitle} → ${translated}`)
  await page.screenshot({ path: `${SHOTS}/paper-first-screen.png` })

  logs.length = 0
  await scrollThrough(page)
  // The settled check: the last idle line unchanged for 3 seconds in a row, and no pending node on the page
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
  // Trusting the pipeline's own counts is not enough: with the renderer idling, or the translation nodes deleted by somebody, this would still pass (Codex on #34).
  // Nor can totals alone be compared — `localizeNotes`'s footnote copies keep axt-t (only data-axt-* stripped),
  // so the translation total exceeds the done count, and a lost ordinary translation is offset exactly by an unrelated footnote copy (Codex on #77).
  // Verified **block by block** instead: every original block marked translated must find a real translation by its id
  const orphans = await page.evaluate(() => [...document.querySelectorAll('[data-axt-state="translated"]')]
    .filter(el => {
      const id = el.getAttribute('data-axt-id')
      return !id || !document.querySelector(`.axt-t[data-axt-for="${CSS.escape(id)}"]:not(.axt-mirror, .axt-pending, .axt-error)`)
    })
    .map(el => `${el.tagName}.${[...el.classList].filter(c => c.startsWith('ltx_'))[0] ?? ''}`)
    .slice(0, 5))
  check('scrolled to the bottom screen by screen: every finished block finds its own translation node, and the unscrolled make no request',
    !!last && last.requested > first.requested && last.done === last.requested && last.failed === 0
    && dom.pendingNodes === 0 && orphans.length === 0,
    `${last?.text ?? '(no idle after scroll)'}; finished blocks without a translation ${JSON.stringify(orphans)}; DOM ${JSON.stringify(dom)}`)
  const peak = peakPerSecond(requests)
  // Batching (§8.3): the whole paper's passages have to be gathered into big requests. Before 2026-09-06 only the LLM batched; google-web made one request per call,
  // measured 213 blocks sending 65 requests, 4.2 passages per request on average; fixed, 190 blocks take only 21, 11.2 passages on average
  const items = requests.reduce((n, r) => n + r.items, 0)
  const perRequest = requests.length ? items / requests.length : 0
  check('google-web batching: the whole paper\'s passages gather into big requests, not one per passage', requests.length > 0 && perRequest >= 5, `${requests.length} requests carrying ${items} passages, ${perRequest.toFixed(1)} passages per request on average`)
  // The concurrency gate (§8.3): google-web declares maxConcurrent 2, and no more may be in flight at once. The rate of 20/s and burst of 8 only catch pathological cases
  const concurrent = requests.reduce((p, a) => Math.max(p, requests.filter(b => b.t <= a.t && b.end > a.t).length), 0)
  check('google-web concurrency: in flight at once ≤ 2 (the maxConcurrent the provider declares)', requests.length > 0 && concurrent <= 2, `in-flight peak ${concurrent}, 1-second window peak ${peak}`)
  await page.screenshot({ path: `${SHOTS}/paper.png` })

  // ── Reload and translate again: everything near the first screen hits the cache, no more endpoint requests ────────────────────
  logs.length = 0
  requests.length = 0
  // Chrome restores the scroll position on reload: go back to the top first, so the first screen after the reload is the same batch of blocks as the first time
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(300)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const again = idleOf(await waitForLog(logs, IDLE, 60_000))
  // cached counts passages (each table cell one), done counts blocks, so the two differing is normal; the point is no endpoint request
  check('reload and translate again: everything near the first screen hits the cache, no more endpoint requests', !!again && again.done === again.requested && again.cached >= again.done && requests.length === 0, `${again?.text ?? '(no idle line)'}; endpoint requests ${requests.length}`)
  await page.close()
}

// ── The Microsoft engine (#98): the only end-to-end verification of the markers wire format on a **real paper** ──────────
// #104 verified only the round trip of identity translations on fixtures; whether the markers survive real machine translation (word order moved,
// the engine changing punctuation of its own accord) can only be proved here. The tags format is 0% on this endpoint, so it has to go through markers.
{
  await options.bringToFront()
  await chooseBuiltIn(options, 'Microsoft 翻译')

  const { page, logs, requests } = await openPaper(PAPER, 'edge.microsoft.com')
  const idle = idleOf(await waitForLog(logs, IDLE, 120_000))
  // **It must be verified that the requests really reached Microsoft** (Codex on #115): with Microsoft broken and the Google fallback succeeding,
  // the “finished / node counts match / no marker leftovers” checks below all hold anyway — Google keeps the markers too.
  // Without counting requests this round would not be verifying the endpoint it claims to verify
  check('the Microsoft engine: the requests really reached the Microsoft endpoint, not the Google fallback standing in (#98)',
    requests.length > 0, `${requests.length} edge.microsoft.com requests`)
  check('the Microsoft engine: the first screen translated, no fatal error (#98)',
    !!idle && idle.requested > 0 && idle.done === idle.requested && idle.failed === 0 && !/fatal/.test(idle.text),
    idle?.text ?? '(no idle line)')

  // The two hard promises of the marker scheme: not one protected node missing, and no marker leaking into visible text.
  // Scroll down two screens before sampling: under side by side the first screen is title and authors without a single formula, and that sample proves nothing
  for (let i = 0; i < 6; i++) {
    const withMath = await page.evaluate(real => [...document.querySelectorAll(`.axt-t${real}`)]
      .some(t => t.querySelector('math, .ltx_Math, img, a.ltx_ref') !== null), REAL)
    if (withMath) break
    await page.mouse.wheel(0, 900)
    await sleep(1500)
  }
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
  check('the Microsoft engine: every block\'s protected node count equals the source (the markers lost no formula / link)',
    shape.pairs > 0 && shape.mismatched === 0 && shape.protectedNodes > 0,
    `${shape.pairs} pairs, ${shape.protectedNodes} protected nodes, ${shape.mismatched} mismatched`)
  check('the Microsoft engine: no marker left in the translation', shape.markerLeak === 0, `${shape.markerLeak} leftovers`)

  // ── The hover highlight (§7.7, #105): only this path can prove it ─────────────────────────────
  // The unit tests stub the browser half entirely (happy-dom measures no geometry), and only Microsoft reports alignment,
  // so “the band is really drawn on the matching sentence on both sides, one per line” can only be verified here
  const hover = await page.evaluate(async () => {
    const pairs = [...document.querySelectorAll('.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')]
      .map(t => ({ t, s: document.querySelector(`[data-axt-id="${t.getAttribute('data-axt-for')}"]`) }))
      .filter(p => p.s)
    const at = pairs[0]?.t
    const src = pairs[0]?.s
    if (!at || !src) return { reason: 'no translated block' }
    src.scrollIntoView({ block: 'center' })
    const before = src.outerHTML + at.outerHTML
    // Aim at the centre of a real glyph: the hit test is now “is the pointer inside this character's box”,
    // and the block's geometric centre may fall on the blank between lines, exactly the case to be rejected (item 1 of the reader's 2026-09-09 report)
    const tail = host => {
      const w = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
      let out = null
      for (let t = w.nextNode(); t; t = w.nextNode()) {
        for (let i = t.data.length - 1; i >= 0; i--) {
          if (/\s/.test(t.data[i])) continue
          const r = document.createRange()
          r.setStart(t, i); r.setEnd(t, i + 1)
          const b = r.getBoundingClientRect()
          if (b.width > 0 && b.height > 0) { out = b; break }
        }
      }
      return out
    }
    const walk = document.createTreeWalker(at, NodeFilter.SHOW_TEXT)
    let point = null
    for (let t = walk.nextNode(); t && !point; t = walk.nextNode()) {
      for (let i = 0; i + 1 <= t.data.length && !point; i++) {
        if (/\s/.test(t.data[i])) continue
        const r = document.createRange()
        r.setStart(t, i); r.setEnd(t, i + 1)
        const b = r.getBoundingClientRect()
        if (b.width > 0 && b.height > 0 && b.top > 0) point = { x: b.left + b.width / 2, y: b.top + b.height / 2, ch: t.data[i] }
      }
    }
    if (!point) return { reason: 'no glyph to aim at' }
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: point.x, clientY: point.y, bubbles: true }))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const bands = [...document.querySelectorAll('.axt-hl > div')]
    const boxOf = el => { const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom } }
    const sides = { source: bands.filter(b => b.getAttribute('data-axt-hl-side') === 'source'), target: bands.filter(b => b.getAttribute('data-axt-hl-side') === 'target') }
    // Only one per line: grouped by vertical overlap, the group count should equal the band count
    const lines = new Set(bands.map(b => Math.round(boxOf(b).t / 4)))
    const within = (el, host) => { const a = boxOf(el), h = host.getBoundingClientRect(); return a.l >= h.left - 2 && a.r <= h.right + 2 && a.t >= h.top - 2 && a.b <= h.bottom + 2 }
    return {
      bands: bands.length,
      source: sides.source.length,
      target: sides.target.length,
      onePerLine: lines.size === bands.length,
      inSource: sides.source.every(b => within(b, src)),
      inTarget: sides.target.every(b => within(b, at)),
      // The highlight may touch not one body node (§7.1): the band layer hangs on body
      domUnchanged: before === src.outerHTML + at.outerHTML,
      layerOnBody: document.querySelector('.axt-hl')?.parentElement?.tagName.toLowerCase(),
      point,
    // The pointer moves to the blank on the right of the same line (the page edge): caretPositionFromPoint still answers that line's last character,
    // and only the real hit test can reject it (item 1 of the reader's 2026-09-09 report)
      gutter: await (async () => {
      // Past the end of the last line yet still inside the block's box: caretPositionFromPoint answers the last line's last character here,
      // and the block really maps to a sentence, so only the real hit test can reject it — exactly the position the reader saw.
      // **Of all pairs pick the block with the widest blank**: looking at the first block only, this case has nothing to test when the translation happens to wrap full,
      // and the typesetting varies with paper, viewport and font (Codex on #138)
        const gaps = pairs
          .map(p => { const r = tail(p.t); return r ? { block: p.t, r, gap: p.t.getBoundingClientRect().right - r.right } : null })
          .filter(Boolean)
          .sort((a, b) => b.gap - a.gap)
        const best = gaps[0]
        if (!best || best.gap < 40) return { skipped: true, gap: best?.gap ?? 0 }
        best.block.scrollIntoView({ block: 'center' })
        const r = tail(best.block)
        if (!r) return { skipped: true, gap: 0 }
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: r.right + 20, clientY: r.top + r.height / 2, bubbles: true }))
        await new Promise(r2 => setTimeout(r2, 260))
        return { bands: document.querySelectorAll('.axt-hl > div').length, gap: best.gap }
      })(),
    }
  })
  check('the hover highlight: the source and translation sides light up together (§7.7 / #105)',
    hover.source > 0 && hover.target > 0,
    `source ${hover.source} bands, translation ${hover.target} bands${hover.reason ? ` (${hover.reason})` : ''}`)
  check('the hover highlight: exactly one band per line, not fragmented by glyph (the reader\'s 2026-09-09 report)',
    hover.onePerLine === true, `${hover.bands} bands on ${hover.bands} lines`)
  check('the hover highlight: every band falls inside its own block, none crossing blocks',
    hover.inSource === true && hover.inTarget === true, `source ${hover.inSource}, translation ${hover.inTarget}`)
  check('the hover highlight: the pointer in the blank on the right does not trigger it (the reader\'s 2026-09-09 report)',
    hover.gutter?.bands === 0 || hover.gutter?.skipped === true,
    hover.gutter?.skipped
      ? `skipped: the widest blank right of any block's last line is only ${hover.gutter.gap.toFixed(0)}px, short of the 40px criterion`
      : `${hover.gutter?.bands} bands drawn in the ${hover.gutter?.gap?.toFixed(0)}px blank right of the last line's end`)
  check('the hover highlight: not one body node moved, the band layer hangs on body (§7.1)',
    hover.domUnchanged === true && hover.layerOnBody === 'body', `DOM ${hover.domUnchanged ? 'unchanged' : 'changed'}, layer on ${hover.layerOnBody}`)

  // The hover highlight's registry must not keep a removed translation forever because its original block is still in the document (Codex on #130).
  // happy-dom releases no removed node whatever — in a control experiment even a <p> nothing referenced was not collected — so this
  // can only be tested in a real browser.
  //
  // The criterion is “the leftovers do not grow with the translation count”, not “none left”: measured, 1 block (S1.p2.1) is kept by something else
  // on the page, the same without hovering at all, unrelated to the registry. Measured with the old code as the control — **all 14 kept**,
  // so this threshold separates fixed from unfixed.
  const retained = await page.evaluate(async () => {
    if (typeof gc !== 'function') return { skipped: true }
    const nodes = [...document.querySelectorAll('.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')]
    if (nodes.length < 8) return { reason: `only ${nodes.length} translations, too small a sample` }
    const watch = nodes.map(n => new WeakRef(n))
    const before = watch.length
    nodes.length = 0
    // Every translation node removed, the original blocks left in the document: exactly the situation that keeps registry entries alive
    for (const n of [...document.querySelectorAll('[data-axt-for]')]) n.remove()
    document.querySelector('.axt-hl')?.remove()
    for (let i = 0; i < 8; i++) { gc(); await new Promise(r => setTimeout(r, 30)) }
    return { before, alive: watch.filter(w => w.deref() !== undefined).length }
  })
  check('the hover highlight: once translations are removed the registry no longer keeps them (the memory regression of #130)',
    retained.skipped === true || (retained.alive !== undefined && retained.alive <= 2),
    retained.skipped ? 'skipped (no gc)' : retained.reason ?? `after removing ${retained.before} translation nodes ${retained.alive} still alive (the old code kept all ${retained.before})`)

  await page.screenshot({ path: `${SHOTS}/microsoft.png` })
  await page.close()

  // Back to google-web; the checks after this keep the original engine
  await options.bringToFront()
  await chooseBuiltIn(options, 'Google 翻译')
}

// ── SVG figure translation (§15.5, #121): needs no helper, so it runs here rather than in e2e:image ────────────
// The only place that can prove the whole geometry chain holds: viewBox coordinates → normalised → percentages / container units in the main document.
// The unit tests stub the <object>'s contentDocument; the real nested document exists only in a real browser
{
  await options.bringToFront()
  await setSwitch(options, '图片翻译', true)
  await setImageMode(options, '上下', true)

  const { page, logs } = await openPaper(SVG_PAPER, GOOGLE)
  await waitForLog(logs, IDLE, 120_000)
  // Images are scheduled by viewport: scroll once to release them all, then **wait for the image round to report itself** —
  // the `session idle` above only says the body text is done, and the images are queued only after the scroll.
  // A fixed 3-second sleep, on a slower or rate-limited endpoint, lets legitimate overlays arrive after the assertion, and the test fails intermittently
  // (Codex on #134)
  await scrollThrough(page)
  /**
   * Wait until **every SVG figure with text has its overlay**, rather than for a log line or a count that “looks settled”.
   *
   * The previous version waited for `images idle` and then two unchanged counts: images are released in batches, `waitForLog` scans the whole table with `find`
   * and matches an earlier partial completion (measured: a run gave `1/1 of 9`), and two samples more than 500ms apart
   * also exit early (Codex on #134). The count due can be computed in the page from the figures themselves, so there is no need to guess
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
  // Both conditions: **at least** this lower bound, **and** two consecutive samples unchanged.
  // The in-page verdict is a coarse one that joins the whole figure's data-text and tests it at once, and it undercounts (measured: of 5 figures it counted 4),
  // so it is a lower bound only; while “stable” alone exits early when completions are further apart than the sampling interval. Only both together pin it down
  let overlays = -1
  let stable = 0
  for (let i = 0; i < 80; i++) {
    const now = await page.evaluate(() => document.querySelectorAll('.axt-img').length)
    stable = now === overlays ? stable + 1 : 0
    overlays = now
    if (overlays >= expected && stable >= 2) break
    await sleep(800)
  }
  check('SVG figures: every figure with text has its overlay (the assertions below presume it)',
    expected > 0 && overlays >= expected && stable >= 2, `${overlays} overlays, lower bound ${expected}, stable ${stable} times`)

  const svg = await page.evaluate(() => {
    const objs = [...document.querySelectorAll('object[type="image/svg+xml"]')]
    const out = { objects: objs.length, reachable: 0, overlays: 0, sibling: 0, aligned: 0, rotated: 0, labels: [], covered: [] }
    for (const o of objs) {
      if (o.contentDocument?.querySelector('svg')) out.reachable++
      const next = o.nextElementSibling
      if (!next?.classList.contains('axt-img')) continue
      out.overlays++
      out.sibling++
      // Under side the figure is split in two, and the overlay shows only on the “translation only” copy, the original's display:none
      // (styles/image.css §7.2). Measure the visible one: the hidden one has no geometry to speak of
      if (getComputedStyle(next).display === 'none') { out.overlays--; out.sibling--; continue }
      const a = o.getBoundingClientRect()
      const b = next.getBoundingClientRect()
      // Anchor positioning: the overlay's rectangle should coincide with the <object>'s
      if (Math.abs(a.left - b.left) < 2 && Math.abs(a.top - b.top) < 2 && Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2) out.aligned++
      for (const span of next.querySelectorAll('span')) {
        const style = span.getAttribute('style') ?? ''
        if (style.includes('rotate(')) out.rotated++
        if (out.labels.length < 8) out.labels.push(span.getAttribute('title'))
        // **The end-to-end check of the whole geometry chain**: the white box should cover exactly the source text it translates.
        // Convert the overlay's box into the figure's normalised coordinates and compare with the real extent of those glyphs in the inner document —
        // both are normalised to the <object>'s box, so if any link of viewBox → normalised → main-document percentages / container units
        // is wrong, the difference shows
        const title = span.getAttribute('title') ?? ''
        const d = o.contentDocument
        const chars = [...(d?.querySelectorAll('use[data-text]') ?? [])]
        if (title && d) {
          const iw = d.defaultView.innerWidth, ih = d.defaultView.innerHeight
          const s = span.getBoundingClientRect()
          const box = { l: (s.left - a.left) / a.width, r: (s.right - a.left) / a.width, t: (s.top - a.top) / a.height, b: (s.bottom - a.top) / a.height }
          // The same text may appear several times in the figure (`epoch` is also part of `wall time per epoch [ms]`);
          // take **the best-fitting occurrence**: the wrong instance reports a huge difference that has nothing to do with the product
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
  check('SVG figures: every nested document reachable (§15.5)',
    svg.objects > 0 && svg.reachable === svg.objects, `${svg.reachable}/${svg.objects} readable`)
  check('SVG figures: the overlay is inserted as the <object>\'s next sibling, translated without the helper too',
    svg.overlays > 0 && svg.sibling === svg.overlays, `${svg.overlays} overlays, all next siblings`)
  check('SVG figures: the overlay\'s rectangle coincides with the figure (anchor positioning holds for <object>)',
    svg.overlays > 0 && svg.aligned === svg.overlays, `${svg.aligned}/${svg.overlays} aligned`)
  check('SVG figures: the labels come from the figure\'s real text, not OCR',
    svg.labels.some(t => /[A-Za-z]{3,}/.test(t ?? '')), JSON.stringify(svg.labels.slice(0, 4)))
  check('SVG figures: the vertical axis labels are rotated (§15.5)',
    svg.rotated > 0, `${svg.rotated} vertical labels`)
  // Every white box has to cover the source text it translates: a positive slack means one side shows
  // 0.002 is sub-pixel: measured at most 0.0009, the order of anti-aliasing and rounding
  const uncovered = svg.covered.filter(c => c.slack > 0.002)
  check('SVG figures: the white box covers the source text it translates (the whole geometry chain from viewBox to screen)',
    svg.covered.length > 0 && uncovered.length === 0,
    `${svg.covered.length} labels compared, the most showing ${Math.max(0, ...svg.covered.map(c => c.slack)).toFixed(4)}; ${JSON.stringify(uncovered.slice(0, 3))}`)

  await page.screenshot({ path: `${SHOTS}/svg-figures.png`, fullPage: false })

  const after = await page.evaluate(() => {
    const r = { before: document.querySelectorAll('.axt-img').length }
    return r
  })
  check('SVG figures: overlays were really inserted (the precondition of the restore check)', after.before > 0, `${after.before} overlays`)
  await page.close()

  await options.bringToFront()
  await setSwitch(options, '图片翻译', false)
}

// ── Paper 2: “Show original” midway through translation withdraws the queued and in-flight requests together ────────────────
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
  await page.bringToFront() // the popup looks at the active tab of the current window
  await popup.getByRole('button', { name: '显示原文' }).waitFor({ timeout: 10_000 })
  const requestsBefore = requests.length
  const tCancel = Date.now()
  await popup.getByRole('button', { name: '显示原文' }).click()
  await sleep(4_000)
  const after = await countDom(page)
  const late = requests.filter(r => r.t > tCancel + 500).length
  check('after restoring the original no translation is left and no data-axt-* (every attribute name scanned, not just two)',
    after.translations === 0 && after.marked === 0 && !after.on,
    `${JSON.stringify(after)}; ${partial} translations before the restore`)
  check('after restoring the original no new request is sent (the queued batches withdrawn)', late === 0, `${requestsBefore} requests before the restore, ${late} more 0.5 s after`)
  check('after restoring the original the tab title returns to the original', (await page.title()) === originalTitle, `${await page.title()}; log: ${logs.find(l => /translation stopped/.test(l.text))?.text ?? '(no stopped line)'}`)
  await popup.screenshot({ path: `${SHOTS}/popup-after-restore.png` })
  await popup.close()
  await page.close()
}

// ── After a service worker restart the popup does not misreport the page as “behind the settings” (INVENTORY S8, open question 2) ──────
// The chain's revision used to be a build counter inside the worker: with the worker reclaimed and restarted the counter began at 1 again, while the page remembered the old
// worker's number, and the popup took it for “the settings changed” — the main button became “Translate again”. Now the revision is a digest of the settings, the same
// on whichever worker the settings are built. With Playwright's debugger attached the worker never idles into reclamation, so its target is closed from browser-level
// CDP (measured: the next message starts a new worker) in place of “idle for 30 seconds”
{
  const { page } = await openPaper(PAPER2, GOOGLE)
  const t0 = Date.now()
  let partial = 0
  while (Date.now() - t0 < 30_000 && partial === 0) {
    partial = (await countDom(page)).translations
    if (partial === 0) await sleep(100)
  }
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByRole('button', { name: '显示原文' }).waitFor({ timeout: 10_000 })
  const before = await popup.locator('main').innerText()
  check('before the worker restart: the page is translating and the main button is “Show original”', !/重新翻译/.test(before), before.replace(/\n+/g, ' | ').slice(0, 100))
  await popup.close()

  const [oldWorker] = context.serviceWorkers()
  const born = await oldWorker.evaluate(() => { globalThis.__axtBorn ??= Date.now(); return globalThis.__axtBorn })
  const cdp = await context.browser().newBrowserCDPSession()
  const targets = (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'service_worker' && t.url.includes(extId))
  for (const t of targets) await cdp.send('Target.closeTarget', { targetId: t.targetId })
  await cdp.detach()
  await sleep(1_500)

  const again = await context.newPage()
  await again.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await again.getByRole('button', { name: /显示原文|重新翻译/ }).first().waitFor({ timeout: 10_000 })
  await sleep(1_500)
  const [freshWorker] = context.serviceWorkers()
  const bornAgain = freshWorker ? await freshWorker.evaluate(() => { globalThis.__axtBorn ??= Date.now(); return globalThis.__axtBorn }).catch(() => born) : born
  check('precondition: after CDP closes the target a new worker starts', bornAgain !== born, `${born} → ${bornAgain}`)
  const after = await again.locator('main').innerText()
  check('after the worker restart: same settings, the popup still says “Show original” and does not misreport the page as behind the settings (S8)',
    bornAgain !== born && /显示原文/.test(after) && !/重新翻译/.test(after), after.replace(/\n+/g, ' | ').slice(0, 120))
  await again.close()
  await page.close()
}

// ── Closing the tab: the background's queue is withdrawn with it (Codex on #59) ──────────────
// With requests moved back into the background, destroying the content script no longer destroys this work. Unwithdrawn, a closed tab would
// keep sending paid requests until the batch exhausts its budget (a single batch up to 180 seconds).
{
  const stall = await stallEndpoint(GOOGLE)
  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER2}#axt-translate`, { waitUntil: 'domcontentloaded' })
  // The queue must really hold work not yet sent; only then is “will it still send requests” after closing a question at all; otherwise the assertion idles
  // (when this was first written the first screen happened to be all cached, only 2 requests went out, and nothing was measured)
  const q = await fillQueue(page, stall)
  const before = stall.held.length
  await page.close()
  await sleep(500)
  await stall.release() // free the slots: if the queue is still alive the next batch goes out at once
  await sleep(6_000)
  const late = stall.held.length - before
  await stall.off()
  check('after closing the tab the background sends no new request (the session withdrawn with the tab)',
    q.confirmed && q.requests === GOOGLE_SLOTS && late === 0,
    `${q.pending} blocks pending, only ${q.requests} requests (${q.items} passages) ever reached the endpoint; after freeing one slot the queue filled in ${q.extra}, ${q.confirmed ? 'among them a body never seen (a queued new batch for certain, not the same batch resent)' : 'all the same batch resent — no queued work, this assertion is void'}; after closing the tab and freeing every slot ${late} more`)
}

// ── Navigating away: tabs.onRemoved does not cover this case (Codex on #59) ──────────
{
  const stall = await stallEndpoint(GOOGLE)
  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER3}#axt-translate`, { waitUntil: 'domcontentloaded' })
  const q = await fillQueue(page, stall)
  const before = stall.held.length
  // Jump to a non-arXiv page: the content script is gone and will never send a new scope again
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' })
  // The withdrawal no longer happens on the spot: `tabs.onUpdated`'s loading cannot tell a same-document hash change from a real departure, so it holds
  // NAVIGATION_GRACE_MS (3 seconds) waiting for a new request from the tab, and withdraws only if none comes. Release the slots after that —
  // the property kept is unchanged (after leaving the queue stops), only 3 seconds later (the in-page jumps the reader reported on 2026-09-09 all failed)
  await sleep(4_500)
  await stall.release()
  await sleep(6_000)
  const late = stall.held.length - before
  await stall.off()
  await page.close()
  check('after navigating away the background sends no new request (the session withdrawn with the navigation)',
    q.confirmed && q.requests === GOOGLE_SLOTS && late === 0,
    `${q.pending} blocks pending, only ${q.requests} requests (${q.items} passages) ever reached the endpoint; after freeing one slot the queue filled in ${q.extra}, ${q.confirmed ? 'among them a body never seen (a queued new batch for certain, not the same batch resent)' : 'all the same batch resent — no queued work, this assertion is void'}; after navigating away and freeing every slot ${late} more`)
}

// ── The hover highlight of a caption under side mode (issue #139): the one on screen is the clone ──────────────
{
  // Only a real browser can prove it: the criterion is “which copy has a box”, and happy-dom measures no geometry.
  // The engine is the one configured (google-web here): since #137 Google has sentence alignment too, and blocks like captions are registered as usual
  const { page, logs } = await openPaper(PAPER, GOOGLE)
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByRole('button', { name: '左右', exact: true }).click()
  await sleep(500)
  await popup.close()
  await scrollThrough(page)
  await waitForLog(logs, IDLE, 120_000)
  // **Select the caption to test first, then scroll it**: translations landing push the layout down; scrolling to “the first caption” first and waiting for its translation,
  // it need not still be in the viewport, and `getClientRects()` with `top > 0` holds for elements below the viewport all the same (Codex on #148)
  await page.evaluate(() => document.querySelector('[data-axt-split] .ltx_caption[data-axt-id]')?.scrollIntoView({ block: 'center' }))
  await sleep(1500)
  const caption = await page.evaluate(async () => {
    const mode = document.documentElement.getAttribute('data-axt-mode')
    // **It must be a caption inside a figure really split**: the captions of tables / algorithms do not take the split path, their translations are never
    // in the clone, and asserting `inSplit` on them gives a false failure (easy to hit when AXT_PAPER changes, Codex on #148)
    const src = [...document.querySelectorAll('[data-axt-split] .ltx_caption[data-axt-id]')].find(c => c.getClientRects().length)
    if (!src) return { mode, reason: 'no visible source caption belonging to a split figure' }
    const walk = document.createTreeWalker(src, NodeFilter.SHOW_TEXT)
    let point = null
    for (let t = walk.nextNode(); t && !point; t = walk.nextNode()) {
      for (let i = 0; i + 1 <= t.data.length && !point; i++) {
        if (/\s/.test(t.data[i])) continue
        const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1)
        const b = r.getBoundingClientRect()
        if (b.width > 0 && b.height > 0 && b.top > 0 && b.bottom < innerHeight) point = { x: b.left + b.width / 2, y: b.top + b.height / 2 }
      }
    }
    if (!point) return { mode, reason: 'no character to aim at in the caption' }
    document.dispatchEvent(new PointerEvent('pointermove', { clientX: point.x, clientY: point.y, bubbles: true }))
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
    const bands = [...document.querySelectorAll('.axt-hl > div')]
    const side = which => bands.filter(b => b.getAttribute('data-axt-hl-side') === which)
    const inSplit = side('target').every(b => {
      const r = b.getBoundingClientRect()
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
      return !!el?.closest('.axt-split')
    })
    return { mode, source: side('source').length, target: side('target').length, inSplit }
  })
  await page.close()
  check('side mode: the caption\'s hover highlight is drawn on the clone in the right column (issue #139)',
    caption.mode === 'side' && caption.source > 0 && caption.target > 0 && caption.inSplit === true,
    `mode ${caption.mode}, source ${caption.source} bands, translation ${caption.target} bands${caption.inSplit ? ' (both inside the clone)' : ''}${caption.reason ? ` (${caption.reason})` : ''}`)
}

// ── The bilingual entry on the abstract page (issue #146): one click lands on the full-text page “already translating” ──────────
{
  // Only a real browser can prove this: the insertion point relies on the markup arXiv itself renders, and “click through and translation starts of itself”
  // crosses a real navigation — neither end can be acted out in happy-dom
  const page = await context.newPage()
  const logs = []
  page.on('console', m => { const t = m.text(); if (t.includes('[axt]')) logs.push({ t: Date.now(), text: t }) })
  await page.goto(`https://arxiv.org/abs/${PAPER}`, { waitUntil: 'domcontentloaded' })
  // The content script is `document_idle`, and after `domcontentloaded` it need not have run yet: reading the DOM at once reads nothing,
  // while the click in the next step would pass anyway thanks to auto-waiting — one false failure plus one false pass
  await page.waitForSelector('.axt-abs-link', { timeout: 20_000 }).catch(() => {})
  const link = await page.evaluate(() => {
    const ours = document.querySelector('.axt-abs-link')
    const html = document.querySelector('#latexml-download-link')
    return {
      exists: !!ours,
      href: ours?.getAttribute('href') ?? null,
      text: ours?.textContent ?? null,
      afterHtmlLink: html?.closest('li')?.nextElementSibling?.contains(ours) ?? false,
      inSameList: !!ours && ours.closest('ul') === html?.closest('ul'),
      count: document.querySelectorAll('.axt-abs-link').length,
    }
  })
  check('the abstract page: the bilingual entry is inserted after arXiv\'s HTML link, exactly one (#146)',
    link.exists && link.afterHtmlLink && link.inSameList && link.count === 1 && /\/html\/.*#axt-translate$/.test(link.href ?? ''),
    `“${link.text}” → ${link.href}; right after the HTML link ${link.afterHtmlLink}, same list ${link.inSameList}, ${link.count} in all`)

  await page.click('.axt-abs-link')
  await page.waitForURL(/\/html\/.*#axt-translate/, { timeout: 30_000 })
  const idle = idleOf(await waitForLog(logs, IDLE, 120_000))
  const rendered = await page.evaluate(() => document.querySelectorAll('.axt-t:not(.axt-pending, .axt-error)').length)
  await page.close()
  check('the abstract page: clicked through, it is translating without touching the popup (#146)',
    !!idle && idle.requested > 0 && rendered > 0,
    `${idle?.text ?? '(no idle)'}; ${rendered} translation nodes on the page`)
}

// ── An in-page jump is not navigating away (the reader's 2026-09-09 report: clicking a citation jumps to the references, and that whole block fails) ──
{
  // `tabs.onUpdated`'s loading cannot tell a same-document hash change from a real departure (measured: in both cases changeInfo is only
  // {status:'loading'}), and withdrawing the session on the spot pronounces a living page dead. Only a real browser can verify it: the event does not exist
  // in the unit tests, and the failure is “the request was never sent”, of which the DOM shows only .axt-error
  const { page, logs } = await openPaper(PAPER3, GOOGLE)
  const first = idleOf(await waitForLog(logs, IDLE, 120_000))
  // No scrolling, jump straight to the references — that is how a citation link in the body jumps
  const jumped = await page.evaluate(() => {
    const item = document.querySelector('.ltx_bibitem')
    if (!item?.id) return null
    location.hash = `#${item.id}`
    return item.id
  })
  const after = idleOf(await waitForLog(logs, IDLE, 120_000, m => Number(m[2]) > (first?.requested ?? 0)))
  const dom = await page.evaluate(() => ({
    errors: document.querySelectorAll('.axt-error').length,
    aborted: [...document.querySelectorAll('.axt-error')].filter(e => /aborted/.test(e.getAttribute('title') ?? '')).length,
    bib: document.querySelectorAll('.ltx_bibitem').length,
  }))
  await page.close()
  check('an in-page jump does not withdraw the session: after jumping to the references that area translates as usual (the reader\'s 2026-09-09 report)',
    !!jumped && !!after && after.failed === 0 && dom.aborted === 0,
    `jumped to #${jumped}, ${dom.bib} references; ${after?.text ?? '(no second idle)'}; ${dom.errors} error blocks on the page, ${dom.aborted} of them aborted`)
}

// ── The settings page: the style back to the default; cache statistics and clearing (§9) ──────────────────────────
{
  await options.bringToFront()
  await options.reload({ waitUntil: 'domcontentloaded' })
  await chooseStyle(options, '与原文相同')

  // The two papers before translated, so the cache should hold entries; the reload guarantees the latest statistics are read
  await openSection(options, 'data')
  await options.getByText(/^[1-9]\d* 条 · /).waitFor({ timeout: 15_000 }).catch(() => undefined)
  const before = await options.getByText(/^\d+ 条 · /).textContent()
  await options.getByRole('button', { name: '清空', exact: true }).click()
  await options.getByRole('button', { name: '确认清空', exact: true }).click()
  await options.getByText('已清空', { exact: true }).waitFor({ timeout: 10_000 })
  const after = await options.getByText(/^\d+ 条 · /).textContent()
  check('cache management: shows the entry count, zero after clearing', /^[1-9]/.test(before ?? '') && /^0 条/.test(after ?? ''), `before clearing “${before}”, after “${after}”`)
}

// ── A wrong key + the fallback chain on (§8.5): after the LLM reports auth it switches to google-web of itself, and the whole page translates as usual ──
{
  await options.bringToFront()
  // “Connect” asks whether this service's endpoint works and must report auth truthfully: going through the fallback service, the free service would show it as a success,
  // the reader would think the key fine while the whole page is translated by Google (the same kind of inconsistency as issue #42, the other way round)
  const bogusTest = await addService(options, { name: 'bogus key', baseURL: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4-flash', apiKey: 'sk-or-v1-bogus-key-for-auth-test' })
  check('with a wrong key the settings page\'s connection reports the failure truthfully, not masked by the fallback service', /API Key/.test(bogusTest ?? '') && !/已连接/.test(bogusTest ?? ''), bogusTest)

  const { page, logs, requests } = await openPaper(PAPER, 'openrouter.ai')
  const done = await waitForLog(logs, IDLE, 90_000)
  await sleep(2_000)
  const idle = idleOf(done)
  // The fallback's console.warn now prints in the background's console, invisible on the page (§8.0);
  // “the preferred engine was really tried” is attested by OpenRouter's request count instead, “the reader can see it” by the popup check below
  check('a wrong key + the fallback on: switched to the free engine, the whole page translated as usual, no fatal error',
    !!idle && idle.failed === 0 && idle.done > 0 && !/fatal:/.test(done?.text ?? '') && requests.length > 0,
    `${done?.text ?? '(no idle line)'}; ${requests.length} OpenRouter requests`)

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  // The rebuilt popup says it in the reader's words (UI.md S-P-14 pill “switched”, S-P-30 note
  // "…this page switched to Google Translate…"); no developer word like “fallback” appears anywhere in it
  await popup.getByText(/改用 Google 翻译/).waitFor({ timeout: 10_000 }).catch(() => undefined)
  const notice = await popup.getByText(/改用 Google 翻译/).count()
  check('popup says the page is now on the free service (the note under the card)', notice > 0, `note ${notice}`)
  await popup.screenshot({ path: `${SHOTS}/popup-demoted.png` })
  await popup.close()
  await page.close()
}

// ── A wrong key + the fallback chain off: the “401 → auth → the whole queue drains” behaviour is back ──
{
  await options.bringToFront()
  await setSwitch(options, '出问题时自动改用免费服务', false)

  // The moment the 401 came back has to be recorded: the assertion is “no new request after this”, not how many the first wave had —
  // the first wave's count depends on the token bucket's burst rhythm, and a little faster or slower breaks the ≤ 20 (issue #82)
  let firstAuthFailure = Number.POSITIVE_INFINITY
  // **A few requests were out already at the moment** the 401 arrived. Cut by sequence number, not by time (Codex on #95):
  // any tolerance in time puts the ones “resent the moment a slot frees” before the 401, out of reach of both criteria.
  // The requests already in flight had their `request` event necessarily before this 401's `response` event, so the sequence number is the exact boundary
  let sentAtAuth = -1
  // 401 and 403 both count (Codex on #95): when the gateway rejects a fake key with 403, `openai-compat` classes it as auth all the same,
  // and retry-policy drains the whole queue all the same; listening for 401 alone would turn this assertion red while the product behaves correctly
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
  // After fatal is reported **scroll the whole paper**: that is the falsifiable way (Codex on #95: the old 1-second window was too loose).
  // The old code only looked for new requests within 1 second after the first 401, but in that second the same wave's in-flight batches were still finishing,
  // and whatever the number it proved nothing; measured, that second held exactly a second wave of 7 requests, covered by the window whole.
  //
  // The second wave itself is no retry: 8 batches filled the concurrency slots and hit 401 together, and the remaining blocks were batched and enqueued **afterwards**,
  // while the queue's failQueue only drains what is queued at the time. The promise really to be kept is **the session stops whole** —
  // of 292 blocks only the first screen's handful was touched, the remaining 200-odd never sent. Scrolling once is the falsification trial of that promise:
  // if fatal did not detach the observer, the remaining blocks would enter the viewport screen by screen and keep burning quota.
  // The idle line's time comes from the console listener, the request times from the request listener, each its own Date.now(), and the order may differ by a few milliseconds.
  // That tolerance hides nothing here: the requests after the 401 are all covered by afterAuth, cut by sequence number below,
  // and this one is only responsible for “any more after scrolling once”, which would land seconds after idle
  const EVENT_JITTER_MS = 50
  const idle = idleOf(done)
  await scrollThrough(page)
  await sleep(3_000)
  context.off('response', onAuthResponse)
  // The stretch between the first 401 and idle (Codex adding on #95). Since #96 this is **zero**:
  // before it `failQueue` drained only the tasks queued in the RequestQueue at the time, and the remaining blocks were still batching in the BatchQueue, absent,
  // dispatched as usual once batched, so one more wave was certain (measured +75~279 ms, 7 requests). Now the fatal state sticks to the engine's queue pair,
  // and a batch arriving later is refused on the spot in executeBatch, without one endpoint request.
  // This one catches two regressions at once: with the queue undrained the batches spread out as slots free; with a batch retried the backoff is at least 1 second.
  // Either makes afterAuth non-empty.
  const beforeAuth = requests.slice(0, Math.max(sentAtAuth, 0))
  const afterAuth = requests.slice(Math.max(sentAtAuth, 0))
  const afterIdle = requests.filter(r => r.t > (done?.t ?? 0) + EVENT_JITTER_MS)
  const offsets = requests.map(r => Math.round(r.t - firstAuthFailure)).sort((a, b) => a - b)
  check('a wrong key + the fallback off: after the 401 the whole session stops, and scrolling to the bottom sends no more requests',
    Number.isFinite(firstAuthFailure) && sentAtAuth >= 0 && /fatal: auth/.test(done?.text ?? '')
      && (idle?.requested ?? 0) < (idle?.total ?? 0) // blocks not yet requested remain; only a scroll can falsify it
      && afterAuth.length === 0 // not one request more after the 401 (#96)
      && afterIdle.length === 0,
    `${idle?.requested}/${idle?.total} blocks requested, ${requests.length} requests in all (${offsets.join('/')} ms relative to the first 401); ${beforeAuth.length} before the 401, ${afterAuth.length} after (should be 0, #96); ${afterIdle.length} more after scrolling the whole paper once fatal was reported; ${done?.text ?? '(no idle line)'}; DOM ${JSON.stringify(await countDom(page))}`)
  const widgets = await page.evaluate(() => document.querySelectorAll('.axt-error').length)
  check('failed blocks have a retry / reason widget beside them (§7.6)', !!idle && widgets > 0 && widgets === idle.failed, `${widgets} widgets, ${idle?.failed ?? '?'} failed blocks`)
  await page.close()
}

// ── In-page anchors under only mode (issue #44) ─────────────────────────────────
// only sets the original blocks with translations to display:none, and the cross-references pointing at them lose their landing spot. Measured before the fix:
// clicking “§7” (the target a hidden p.ltx_p) took scrollY from 0 to 0, not moving at all. Of the 3374 in-page anchors in the 12 fixtures,
// 118 (3.5%) have their target inside a translated block
{
  // The wrong-key parts before this chose a service with a fake key and switched the automatic fallback off: back to the free service first
  await options.bringToFront()
  await setSwitch(options, '出问题时自动改用免费服务', true)
  await chooseBuiltIn(options, 'Google 翻译')

  const { page, logs } = await openPaper(PAPER4, 'translate-pa.googleapis.com')
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  // openPaper starts translating of itself with #axt-translate; only the mode is switched here — the switch changes the attribute on <html> only, no retranslation
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
      // The landing spot must be that translation, and inside the viewport — “it scrolled” alone would pass a scroll to any position
      landedOnTranslation: !!rect && rect.top >= -2 && rect.top < innerHeight,
      hash: location.hash,
      // The clone nodes are stripped of ids: no duplicate id may appear on the whole page (the fourth acceptance criterion of issue #44)
      duplicateIds: (() => {
        const seen = new Set(); const dupes = new Set()
        for (const el of document.querySelectorAll('[id]')) { if (seen.has(el.id)) dupes.add(el.id); seen.add(el.id) }
        return [...dupes].slice(0, 5)
      })(),
    }
  })
  check('under only mode an anchor pointing at a hidden block lands on its translation (issue #44)',
    r.candidates > 0 && r.moved > 0 && r.landedOnTranslation && r.hash === r.href,
    `${r.candidates} anchors with an invisible target; clicking ${r.href} scrolled ${r.moved}px, landed on the translation ${r.landedOnTranslation}, hash ${r.hash}`)
  check('the translation clones made no duplicate id (issue #44)', Array.isArray(r.duplicateIds) && r.duplicateIds.length === 0, `duplicate ids: ${JSON.stringify(r.duplicateIds)}`)

  // ── The source peek under only mode (issue #141) ────────────────────────────────
  // only hides the original block, so on hover the source side has no box to tint; after a 600 ms dwell the source sentence is cloned into a panel:
  // in the margin when the margin has room, otherwise floated by the sentence. The unit tests stub all the geometry, and “the panel really appears where it should,
  // its content really is that source sentence, and not one body node is touched” can only be verified here.
  // The page is still in only mode; first find, among the first few paragraphs, one whose hover shows bands (bands = sentence boundaries registered), then look at the panel
  const peekAt = async (forId, width) => {
    await page.setViewportSize({ width, height: 900 })
    await sleep(300)
    return page.evaluate(async forId => {
      const sleep = ms => new Promise(r => setTimeout(r, ms))
      const norm = s => (s ?? '').replace(/\s+/g, ' ').trim()
      const glyphOf = host => {
        const walk = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          for (let i = 0; i + 1 <= t.data.length; i++) {
            if (/\s/.test(t.data[i])) continue
            const r = document.createRange()
            r.setStart(t, i); r.setEnd(t, i + 1)
            const b = r.getBoundingClientRect()
            if (b.width > 0 && b.height > 0 && b.top > 0) return { x: b.left + b.width / 2, y: b.top + b.height / 2 }
          }
        }
        return null
      }
      const hover = async host => {
        const pt = glyphOf(host)
        if (!pt) return false
        document.dispatchEvent(new PointerEvent('pointermove', { clientX: pt.x, clientY: pt.y, bubbles: true }))
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
        return true
      }
      const article = document.querySelector('article.ltx_document')
      const all = [...document.querySelectorAll('p.ltx_p.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split)')]
      const candidates = forId ? all.filter(t => t.getAttribute('data-axt-for') === forId) : all.slice(0, 12)
      let target = null
      let tried = 0
      for (const t of candidates) {
        tried++
        t.scrollIntoView({ block: 'center' })
        await sleep(250) // a page scroll closes the panel and asks where the pointer is again 120 ms later; let it settle
        if (!(await hover(t))) continue
        if (document.querySelectorAll('.axt-hl > div').length > 0) { target = t; break }
      }
      if (!target) return { reason: `none of ${tried} paragraphs registered sentence boundaries (no band on hover)` }
      const src = document.querySelector(`[data-axt-id="${target.getAttribute('data-axt-for')}"]`)
      // The §7.1 comparison looks at this pair only: while the dwell is awaited, the whole article keeps receiving lazily loaded translations,
      // and a before/after snapshot of the whole article measures translation progress, not the panel
      const before = src.outerHTML + target.outerHTML
      const ids = document.querySelectorAll('[id]').length
      // The band is there at once; the panel waits for the dwell
      const early = document.querySelector('.axt-peek')
      const earlyShown = !!early && !early.hidden
      await sleep(900)
      const panel = document.querySelector('.axt-peek')
      if (!panel || panel.hidden) return { reason: 'no panel after a 900 ms dwell' }
      const text = norm(panel.textContent)
      const box = panel.getBoundingClientRect()
      const lines = [...document.querySelectorAll('.axt-hl > div')].map(b => b.getBoundingClientRect())
      const top = Math.min(...lines.map(b => b.top))
      const bottom = Math.max(...lines.map(b => b.bottom))
      const art = article.getBoundingClientRect()
      const at = panel.getAttribute('data-axt-peek-at')
      const placed = at === 'margin' ? box.left >= art.right - 1 : at === 'below' ? box.top >= bottom - 1 : at === 'above' ? box.bottom <= top + 1 : false
      // The cloning cost: the whole source paragraph (never less than one sentence) cloned 20 times, averaged
      const range = document.createRange()
      range.selectNodeContents(src)
      const t0 = performance.now()
      for (let i = 0; i < 20; i++) range.cloneContents()
      const cloneMs = (performance.now() - t0) / 20
      // A page scroll closes the panel at once
      scrollBy(0, 40)
      await sleep(50)
      const afterScroll = document.querySelector('.axt-peek')?.hidden === true
      return {
        forId: target.getAttribute('data-axt-for'), at, placed, earlyShown, afterScroll, cloneMs,
        textLen: text.length, srcHas: text.length > 0 && norm(src.textContent).includes(text),
        onBody: panel.parentElement === document.body,
        visible: box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= innerHeight,
        width: Math.round(box.width), blockWidth: Math.round(target.getBoundingClientRect().width),
        margin: Math.round(innerWidth - art.right), viewport: innerWidth,
        domUnchanged: src.outerHTML + target.outerHTML === before && !article.contains(panel),
        idsUnchanged: document.querySelectorAll('[id]').length === ids,
      }
    }, forId)
  }
  // 1600 wide: the article is 52rem centred, ≈ 384px each side, and the panel should be in the margin
  const wide = await peekAt(null, 1600)
  check('only mode: after a 600 ms dwell the source sentence floats out, its content a substring of the original block, hanging on body (issue #141)',
    !!wide.at && wide.srcHas && wide.onBody && wide.visible && !wide.earlyShown,
    wide.reason ?? `placement ${wide.at}, ${wide.textLen} characters, substring of the source ${wide.srcHas}, on body ${wide.onBody}, visible ${wide.visible}, shown before the dwell ${wide.earlyShown}`)
  check('only mode: on a wide window the panel sits in the article\'s right margin and touches no body text (§7.1)',
    wide.at === 'margin' && wide.placed && wide.domUnchanged && wide.idsUnchanged,
    wide.reason ?? `viewport ${wide.viewport}, margin ${wide.margin}px, placement ${wide.at}, placed right ${wide.placed}, body unchanged ${wide.domUnchanged}, id count unchanged ${wide.idsUnchanged}`)
  check('only mode: a page scroll closes the panel at once', wide.afterScroll === true, wide.reason ?? `after the scroll hidden=${wide.afterScroll}`)
  check('only mode: cloning the whole source paragraph once takes under 10 ms', typeof wide.cloneMs === 'number' && wide.cloneMs < 10, wide.reason ?? `${wide.cloneMs?.toFixed(3)} ms per clone`)
  // 1100 wide: only ≈ 134px of margin left, the panel floats by the sentence, as wide as its block
  const narrow = await peekAt(wide.forId ?? null, 1100)
  check('only mode: on a narrow window the panel floats by the sentence, as wide as its block (issue #141)',
    (narrow.at === 'below' || narrow.at === 'above') && narrow.placed && Math.abs(narrow.width - narrow.blockWidth) <= 2 && narrow.srcHas,
    narrow.reason ?? `viewport ${narrow.viewport}, margin ${narrow.margin}px, placement ${narrow.at}, placed right ${narrow.placed}, width ${narrow.width} vs block ${narrow.blockWidth}`)
  await page.close()
}

// ── The settings page: “Clear” on the API key must really clear it ────────────────────────────────────
// The drawer opens with the stored key in its form, and a save that reads that prop back writes the old key back as it was (a measured defect).
// With no key the endpoint reports “not configured”, which is distinct from “invalid or expired”.
// Last on purpose: it writes the service configuration twice more and sends one more sample request, and need not sit between the two wrong-key parts.
//
// 7 requests (3 expected) once appeared between those two parts and were taken for interference with this guard; the real root cause was a **stale automatic restart**
// (Codex on #157): the `start()` a permanent service change triggers no longer validated the session after two awaits, and with the page already
// finished it opened one more round, the extra wave being exactly those 4 requests. Fixed, this is back at a stable 3
{
  await options.bringToFront()
  const cleared = await clearKeyAndReconnect(options)
  check('the settings page: after clearing the API key the connection reports “not configured” rather than writing the old key back', /尚未配置/.test(cleared ?? ''), cleared)
}

// ── The interface language (UI.md §6) ─────────────────────────────────────────────
// The last part: it reloads the whole settings page and leaves uiLanguage in the configuration at English, and no other case need be affected
{
  await options.bringToFront()
  await options.reload({ waitUntil: 'domcontentloaded' })
  await chooseUiLanguage(options, '界面语言', 'English')
  const nav = (await options.locator('nav').innerText()).replace(/\n+/g, ' ')
  check('the settings page follows the interface language into English', /Services/.test(nav) && !/翻译服务/.test(nav), nav.slice(0, 60))

  // The popup and the paper page read the same configuration: all three have to follow, not the settings page alone
  const enPopup = await context.newPage()
  await enPopup.goto(`chrome-extension://${extId}/popup.html`)
  await enPopup.waitForTimeout(600)
  const popupText = await enPopup.locator('main').innerText()
  check('the popup follows the interface language into English', /Open the HTML version|Translate this page/.test(popupText) && !/翻译本页|打开 arXiv/.test(popupText), popupText.split('\n')[0] ?? '')
  await enPopup.close()

  // Back to Chinese, leaving the configuration as the rest of this suite expects
  await options.bringToFront()
  await chooseUiLanguage(options, 'Interface language', '简体中文')
  const back = await options.locator('nav').innerText()
  check('switched back to Chinese, the settings page follows back too', /翻译服务/.test(back), back.replace(/\n+/g, ' ').slice(0, 40))
}

// ── The recognition helper's guided install (DESIGN §15.4, issue #102) and the permission step before it (ADR-0002) ───────────────
// macOS only: on other platforms the install script exits at once, and the card is a single “macOS only” line.
// `nativeMessaging` is an optional permission: Playwright's fresh profile has not granted it, so in the main context the card is the **permission** step
// (S-P-86b/c, S-O-86), and Chrome's permission prompt is a native dialog that cannot be clicked. The guide itself (two steps, the wait) runs in a second context:
// that build copy writes the permission back into the manifest, pre-granted (ext-copy.mjs); and the installed host manifest is not in that profile either,
// so there it is **necessarily** “not installed”
if (process.platform === 'darwin') {
  const paper = await openPaper(PAPER, GOOGLE)
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await paper.page.bringToFront()
  await popup.waitForTimeout(800)

  // The earlier cases switched image translation off, and this card appears only with it on — switch it on first (and prove in passing that the card follows the switch)
  const imagesSwitch = popup.getByRole('switch', { name: '图片翻译', exact: true })
  if ((await imagesSwitch.getAttribute('aria-checked')) !== 'true') {
    await imagesSwitch.click()
    await popup.waitForTimeout(400)
  }
  const allow = popup.getByRole('button', { name: '允许', exact: true })
  const shown = (await popup.locator('main').innerText()).replace(/\n+/g, ' | ')
  check('permission: with the permission not granted the popup shows one line and “Allow”, and no install guide yet (S-P-86b/c)',
    await allow.isVisible() && shown.includes('图片翻译需要允许扩展与识别助手通信') && !shown.includes('图片翻译需要安装识别助手'), shown.slice(0, 120))
  await popup.screenshot({ path: `${SHOTS}/helper-permission.png` })
  await popup.close()

  const optionsPage = await openOptions(context, extId)
  // The helper state arrives asynchronously (the page asks the background on mount): wait for the button, do not sample it
  const allowOnOptions = await optionsPage.getByRole('button', { name: '允许', exact: true }).waitFor({ timeout: 5_000 }).then(() => true, () => false)
  check('permission: the image translation section of the settings page offers the “Allow” button (S-O-86)', allowOnOptions, allowOnOptions ? '' : (await optionsPage.getByText(/识别助手/).first().textContent().catch(() => '')) ?? '')
  await optionsPage.close()
  await paper.page.close()

  // ── The second context: the copy with the permission pre-granted → not installed → the two-step guide ──
  const grantedExt = copyWithGrants(EXT, `${HERE}.ext-granted`, { permissions: ['nativeMessaging'] })
  const GRANTED_PROFILE = `${HERE}.profile-granted`
  rmSync(GRANTED_PROFILE, { recursive: true, force: true })
  const granted = await chromium.launchPersistentContext(GRANTED_PROFILE, {
    channel: 'chromium',
    headless: !process.env.AXT_HEADED,
    args: [`--disable-extensions-except=${grantedExt}`, `--load-extension=${grantedExt}`],
    viewport: { width: 1440, height: 900 },
  })
  granted.setDefaultNavigationTimeout(90_000)
  let [grantedWorker] = granted.serviceWorkers()
  if (!grantedWorker) grantedWorker = await granted.waitForEvent('serviceworker')
  const grantedId = grantedWorker.url().split('/')[2]
  // The popup has to stand beside a paper (it looks at the active tab); this page is only opened, not translated
  const paperTab = await granted.newPage()
  await paperTab.goto(`https://arxiv.org/html/${PAPER}`, { waitUntil: 'domcontentloaded' })

  const guide = await granted.newPage()
  await guide.goto(`chrome-extension://${grantedId}/popup.html`)
  await paperTab.bringToFront()
  await guide.waitForTimeout(800)
  const guideSwitch = guide.getByRole('switch', { name: '图片翻译', exact: true })
  if ((await guideSwitch.getAttribute('aria-checked')) !== 'true') {
    await guideSwitch.click()
    await guide.waitForTimeout(400)
  }
  const install = guide.getByRole('button', { name: '安装', exact: true })
  const card = (await guide.locator('main').innerText()).replace(/\n+/g, ' | ')
  check('the guide: with the permission granted and no helper the popup shows one hint line and “Install” only', await install.isVisible() && card.includes('图片翻译需要安装识别助手'), card.slice(0, 120))

  await install.click()
  await guide.waitForTimeout(300)
  const opened = (await guide.locator('main').innerText()).replace(/\n+/g, ' ')
  // Two steps, no third: the old “I have installed it” button is gone
  check('the guide: unfolds in place into two steps, without “I have installed it”',
    /打开「终端」/.test(opened) && /在终端中执行以下命令/.test(opened) && !/我已经装好了/.test(opened),
    opened.slice(0, 70))

  const command = guide.locator('button[title]').filter({ hasText: 'curl -fsSL' })
  check('the guide: the command block carries this extension\'s id', (await command.innerText()).includes(grantedId), grantedId)

  await command.click()
  await guide.waitForTimeout(500)
  check('the guide: after the copy it says “no need to come back here” rather than asking the reader to return and confirm',
    (await guide.locator('main').innerText()).includes('执行完成后自动生效，无需返回此处'), '')

  // The crucial one: the wait lives in the background, and a popup closed and reopened picks it up (§15.4)
  await guide.goto('about:blank')
  await guide.goto(`chrome-extension://${grantedId}/popup.html`)
  await paperTab.bringToFront()
  await guide.waitForTimeout(800)
  await guide.getByRole('button', { name: '安装', exact: true }).click()
  await guide.waitForTimeout(400)
  check('the guide: after reopening the popup the same wait is still there (the state is in the background, not the component)',
    (await guide.locator('main').innerText()).includes('执行完成后自动生效'), '')

  await guide.screenshot({ path: `${SHOTS}/helper-onboarding.png` })

  // The service worker is reclaimed after 30 seconds idle, and **what wakes it is often exactly the popup's query**:
  // the query must wait for `resume()` to finish reading storage before answering, or it gets the unrestored null (Codex on #166).
  // With the worker not reclaimed this one takes the in-memory path and should pass just the same — neither path may lose the wait
  await guide.waitForTimeout(35_000)
  await guide.goto('about:blank')
  await guide.goto(`chrome-extension://${grantedId}/popup.html`)
  await paperTab.bringToFront()
  await guide.waitForTimeout(1_000)
  await guide.getByRole('button', { name: '安装', exact: true }).click()
  await guide.waitForTimeout(400)
  check('the guide: after the service worker is reclaimed the wait is still picked up',
    (await guide.locator('main').innerText()).includes('执行完成后自动生效'), '')
  await guide.close()

  // With the clipboard blocked the path taken is “select the command and copy it by hand” — the reader does, installs,
  // and the detection must be running already, or the figures waiting on the page wait forever (the confirm button is gone)
  const denied = await granted.newPage()
  await denied.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => Promise.reject(new Error('denied')) }, configurable: true })
  })
  await denied.goto(`chrome-extension://${grantedId}/popup.html`)
  await paperTab.bringToFront()
  await denied.waitForTimeout(900)
  await denied.getByRole('button', { name: '安装', exact: true }).click()
  await denied.waitForTimeout(300)
  await denied.locator('button[title]').filter({ hasText: 'curl -fsSL' }).click()
  await denied.waitForTimeout(600)
  const fallback = (await denied.locator('main').innerText()).replace(/\n+/g, ' | ')
  check('the guide: when the copy fails it offers the manual way and starts the detection all the same',
    fallback.includes('无法复制') && fallback.includes('执行完成后自动生效'), fallback.slice(-60))
  await denied.close()

  await granted.close()
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
