// Real-browser e2e checks (DESIGN §11): Playwright starts Chromium with .output/chrome-mv3 (new headless supports extensions),
// drives options and popup, reads console and network, and exercises the main flow on real arXiv pages with free google-web.
// Do not access the user’s browser or API keys; LLM paths test only wrong-key fallback / stopping the whole queue with fallback disabled, at no cost.
//
// Usage: pnpm build && pnpm e2e (first run: npx playwright install chromium)
// Environment: AXT_PAPER / AXT_PAPER2 select papers; AXT_HEADED=1 shows the browser.
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
const PAPER2 = process.env.AXT_PAPER2 ?? '2312.17527'
/** Third paper: untouched by earlier cases, with a cold cache; navigation testing requires a real backlog */
const PAPER3 = process.env.AXT_PAPER3 ?? '2312.17141'
/** Fourth paper: most anchors targeting translation blocks among 12 fixtures (64); used by the translation-only anchor case */
const PAPER4 = process.env.AXT_PAPER4 ?? '2609.00246'
const GOOGLE = 'translate-pa.googleapis.com'
/** Both request completion events must set end; otherwise failures remain counted as in-flight */
const SETTLED_EVENTS = ['requestfinished', 'requestfailed']
/** google-web’s declared maxConcurrent: how many intercepted requests fill every concurrency slot */
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
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1440, height: 900 },
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]
console.log(`extension ${extId} loaded from ${EXT}`)

/**
 * Open a paper and start translation automatically (#axt-translate), collecting [axt] logs and requests to host.
 *
 * Listen on **context**, not page: since 2026-09-06 translation fetch runs in the background service worker
 * (DESIGN §8.0), invisible to page events. Polling also misses spinners: an all-cache-hit first screen finishes in 38 ms,
 * faster than a 200 ms poll. Use a page MutationObserver to record the peak instead.
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
  // Listen on **context**: since 2026-09-06 translation fetch runs in the background service worker (DESIGN §8.0),
  // invisible to page events. Detach on page close to avoid mixing papers
  const onRequest = request => {
    if (!request.url().includes(host)) return
    // translateHtml body is [[items, from, to], client]: count segments in this request as direct batching evidence
    let items = 0
    try {
      const body = JSON.parse(request.postData() ?? 'null')
      if (Array.isArray(body?.[0]?.[0])) items = body[0][0].length
    } catch {
      // Record 0 for non-JSON or LLM endpoints, where segments cannot be counted inside the prompt
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
  // Polling misses spinners: an all-cache-hit first screen finishes in 36 ms, faster than 200 ms polls. Use a MutationObserver.
  // **Count insertions, not live samples** (issue #82): MutationObserver callbacks batch at microtask checkpoints;
  // when insertion and removal share a batch, querySelectorAll already returns 0 and the peak remains 0.
  // Counting inserted spinner nodes is independent of timing
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
 * Intercept requests to host: the route handler records but does not release them, holding concurrency slots.
 *
 * Why intercept (issue #82, Codex #95): cancellation assertions must act while queued, unsent work actually exists,
 * or zero requests after cancellation is vacuous. DOM counts cannot establish this: cache hits get pending nodes
 * **before** cache lookup but send no requests; completed but not-yet-rendered requests are also missed,
 * and a block can contain multiple segments (measured: 215 blocks sent 249 segments), making subtraction negative on large pages.
 * With interception, count actual dispatched requests directly from route hits;
 * nothing can complete, so stable pending counts mean the cache lookup pass has finished.
 */
async function stallEndpoint(host) {
  const held = []
  const pattern = `**://${host}/**`
  const handler = route => {
    // Keep the exact request body to distinguish a new queued batch from a retry of the same batch
    const body = route.request().postData() ?? ''
    let items = 0
    try {
      const parsed = JSON.parse(body || 'null')
      if (Array.isArray(parsed?.[0]?.[0])) items = parsed[0][0].length
    } catch {
      // Record 0 for non-JSON
    }
    // No continue / fulfill / abort: leave the request parked, occupying a concurrency slot
    held.push({ t: Date.now(), items, body, route })
  }
  await context.route(pattern, handler)
  return {
    held,
    /** Release intercepted requests to free slots; a live queue immediately supplies the next batch */
    release: async () => { for (const h of held.slice()) await h.route.abort().catch(() => undefined) },
    /**
     * Remove the handler first, then finish **all** intercepted requests (Codex #95): with a cancellation regression, release
     * may admit more requests into the handler; `unroute` removes the handler but does not complete already parked requests.
     * Leaving those parked occupies google queue slots and inexplicably hangs later navigation / fallback / only-mode cases
     */
    off: async () => {
      await context.unroute(pattern, handler)
      for (const h of held) await h.route.abort().catch(() => undefined)
    },
  }
}

/**
 * Fill concurrency slots and build a large unsent backlog, then positively verify it:
 * release one slot and check that the queue supplies a **new** batch; only then has unsent work actually been observed,
 * satisfying the assertion’s precondition (Codex #95 required directly observing or constructing unsent batches).
 *
 * Determine newness from the body, not request count (Codex #95): aborting an intercepted request does not abort
 * the provider’s AbortSignal, so `google-web` classifies fetch failure as retryable `network` and the queue resends
 * the same batch after default backoff. Counting requests would mistake a retry for queued work, making the positive check vacuous.
 * Retries have byte-identical bodies; only a previously unseen request body proves a new batch.
 */
async function fillQueue(page, stall, { slots = GOOGLE_SLOTS, timeoutMs = 40_000 } = {}) {
  await scrollThrough(page) // With the endpoint intercepted, nothing completes and every paper block remains pending
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

/** Maximum request count in any 1-second window */
function peakPerSecond(requests) {
  let peak = 0
  for (const a of requests) peak = Math.max(peak, requests.filter(b => b.t >= a.t && b.t < a.t + 1000).length)
  return peak
}

/** Viewport translation (§10) never finishes globally; each busy-to-idle transition logs session idle */
const IDLE = /session idle: (\d+)\/(\d+) requested of (\d+), (\d+) failed, (\d+) cached/
const idleOf = log => { const m = IDLE.exec(log?.text ?? ''); return m ? { done: +m[1], requested: +m[2], total: +m[3], failed: +m[4], cached: +m[5], text: log.text } : null }
/** Scroll one screen at a time; jumping to the bottom observes only the last screen */
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
  // The restore assertion uses this count. **Do not enumerate only a few attributes**: rendering also injects data-axt-mode /
  // -inline / -partial / -note / -fit / -split / -for / -on; omitting any misses leftovers
  // (Codex #34). Scan every element’s attribute-name prefix, including <html>
  marked: [document.documentElement, ...document.querySelectorAll('*')]
    .reduce((n, el) => n + el.getAttributeNames().filter(a => a.startsWith('data-axt-')).length, 0),
  markedNames: [...new Set([document.documentElement, ...document.querySelectorAll('*')]
    .flatMap(el => el.getAttributeNames().filter(a => a.startsWith('data-axt-'))))].sort(),
  on: document.documentElement.hasAttribute('data-axt-on'),
}))

// ── Options: select google-web, save, test connection (background path) ─────
const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'google-web')
// Image translation (DESIGN §15) defaults to all three modes; if helper is installed, overlays and figure splits disturb later layout / count assertions.
// Disable it here; dedicated e2e:image enables it (keep enabled when AXT_E2E_IMAGES=1)
if (!process.env.AXT_E2E_IMAGES) {
  for (const name of ['Side by side', 'Stacked', 'Translation only']) {
    const box = options.getByRole('checkbox', { name, exact: true })
    if (await box.isEnabled()) await box.uncheck()
  }
}
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
await options.getByRole('button', { name: /Test connection/ }).click()
const testText = await (await options.waitForSelector('main p[style*="background"]', { timeout: 30_000 })).textContent()
check('Options connection test (background path, google-web)', /ms/.test(testText) && !/Failed/.test(testText), testText)
await options.screenshot({ path: `${SHOTS}/options.png` })

// ── Options: translate-ahead distance (config v3 preload) persists after save and reload ──
const marginInput = 'input[type="number"] >> nth=0'
await options.fill(marginInput, '300')
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
await options.reload({ waitUntil: 'domcontentloaded' })
await options.waitForFunction(() => document.querySelector('input[type="number"]')?.value === '300', null, { timeout: 5_000 }).catch(() => undefined)
const marginBack = await options.inputValue(marginInput)
check('Options: translate-ahead distance remains 300 after save and reload', marginBack === '300', `read back ${marginBack}`)
await options.fill(marginInput, '1000')
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })

// ── Options: image mode gate (config v8, DESIGN §15) persists after reload; entire section disabled without helper ──
{
  const names = ['Side by side', 'Stacked', 'Translation only']
  const boxOf = name => options.getByRole('checkbox', { name, exact: true })
  // Disabled during detection does not mean unavailable; wait for the terminal helper status.
  await options.getByText(/^Helper (?:.* detected\.|not detected)/).waitFor({ timeout: 20_000 })
  const enabled = await boxOf('Stacked').isEnabled()
  if (enabled && !process.env.AXT_E2E_IMAGES) {
    await boxOf('Stacked').check()
    await options.getByRole('button', { name: 'Save', exact: true }).click()
    await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
    await options.reload({ waitUntil: 'domcontentloaded' })
    await options.getByRole('checkbox', { name: 'Stacked', exact: true }).waitFor({ timeout: 5_000 })
    const states = await Promise.all(names.map(n => boxOf(n).isChecked()))
    check('Options: selecting only Stacked image translation persists after save and reload', JSON.stringify(states) === JSON.stringify([false, true, false]), `read back ${states.join(',')}`)
    await boxOf('Stacked').uncheck()
    await options.getByRole('button', { name: 'Save', exact: true }).click()
    await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
  } else {
    const hint = await options.getByText(/helper/i).first().textContent()
    check('Options: image section is disabled and explains why when helper is not detected', !enabled && /not detected/.test(hint ?? ''), hint ?? '')
  }
}

// ── Options: target language (config v4 ISO 639-3) and custom prompt persist after save and reload ──
const langSelect = options.getByRole('combobox', { name: /^Target language/ })
await langSelect.selectOption('jpn')
await options.getByRole('button', { name: 'New', exact: true }).click()
await options.getByRole('textbox', { name: 'Name', exact: true }).fill('e2e prompt')
await options.getByRole('button', { name: 'Add to list', exact: true }).click()
await options.getByRole('radio').last().check()
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
await options.reload({ waitUntil: 'domcontentloaded' })
await options.getByText('e2e prompt').waitFor({ timeout: 5_000 }).catch(() => undefined)
const langBack = await options.getByRole('combobox', { name: /^Target language/ }).inputValue()
const promptRow = options.getByRole('radio').last()
const promptBack = (await options.getByText('e2e prompt').count()) === 1 && (await promptRow.isChecked())
check('Options: target jpn and custom prompt persist and remain selected after save and reload', langBack === 'jpn' && promptBack, `language ${langBack}, prompt ${promptBack}`)
// Delete and restore defaults; later wrong-key cases need the default prompt
options.once('dialog', d => d.accept())
await options.getByRole('button', { name: 'Delete', exact: true }).click()
await options.getByRole('combobox', { name: /^Target language/ }).selectOption('cmn')
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
const promptGone = (await options.getByText('e2e prompt').count()) === 0
check('Options: deleting a custom prompt selects the default again', promptGone, `remaining ${promptGone ? 0 : 1}`)

// ── Options: translation-style presets and cache management (§7.5 / §9) ──────
{
  await options.bringToFront()
  await options.getByRole('combobox', { name: /^Appearance\b/ }).selectOption('quote')
  await options.getByRole('button', { name: 'Save', exact: true }).click()
  await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })

  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER}#axt-translate`, { waitUntil: 'domcontentloaded' })
  // Count actual translations only: spinners / error widgets / mirrors / split clones also have .axt-t, but presets deliberately exclude them.
  // Polling pending nodes would falsely report zero rule width as a broken preset (Codex #52)
  const REAL = ':not(.axt-pending, .axt-error, .axt-mirror, .axt-split)'
  await page.waitForFunction(sel => document.querySelector(sel) !== null, `.axt-t:not([data-axt-inline])${REAL}`, { timeout: 60_000 }).catch(() => undefined)
  await page.waitForFunction(sel => document.querySelector(sel) !== null, `.axt-t[data-axt-inline]${REAL}`, { timeout: 30_000 }).catch(() => undefined)
  const styled = await page.evaluate(real => {
    const el = document.querySelector(`.axt-t:not([data-axt-inline])${real}`)
    const inline = document.querySelector(`.axt-t[data-axt-inline]${real}`)
    return {
      attr: document.documentElement.dataset.axtStyle ?? null,
      border: el ? Math.round(Number.parseFloat(getComputedStyle(el).borderInlineStartWidth)) : -1,
      // Inline heading translations must have no rule (it would misalign Abstract and its translation); report null if none appears, rather than passing
      inline: inline ? Math.round(Number.parseFloat(getComputedStyle(inline).borderInlineStartWidth)) : null,
    }
  }, REAL)
  check('quote preset: attribute on <html>, rule on block translations, no rule on inline headings', styled.attr === 'quote' && styled.border > 0 && styled.inline === 0, JSON.stringify(styled))
  await page.screenshot({ path: `${SHOTS}/style-quote.png` })
  await page.close()

  // Underline styles must include equations: text-decoration does not propagate into atomic inline boxes such as math; users reported dashed-line gaps
  await options.bringToFront()
  await options.getByRole('combobox', { name: /^Appearance\b/ }).selectOption('dashed')
  await options.getByRole('button', { name: 'Save', exact: true }).click()
  await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
  // Use a math-heavy paper: PAPER has no inline equations on its first screen, making this check vacuous
  const dashedPage = await context.newPage()
  await dashedPage.goto('https://arxiv.org/html/2609.04056v1#axt-translate', { waitUntil: 'domcontentloaded' })
  // Wait for both conditions (issue #82): after the first translation with math appears, <html> may still lack data-axt-style,
  // because enable() sets it in startTranslation and the #axt-translate session reads configuration after options saves the preset.
  // Observed once: 22 equations with block-level none/solid; rerunning the same build found 51 with underline/dashed
  await dashedPage.waitForFunction(
    () => document.documentElement.dataset.axtStyle === 'dashed' && document.querySelectorAll('.axt-t math').length > 0,
    null, { timeout: 60_000 },
  ).catch(() => undefined)
  // Also wait for the equation count to stabilize; active translation exposes an intermediate state
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
  check('dashed preset: dashed underline covers equations in translations (text-decoration does not propagate to atomic inline boxes)',
    dashed.count > 0 && dashed.block === 'underline/dashed' && dashed.math.every(d => d === 'underline/dashed'),
    `${dashed.count} equations, block ${dashed.block}, math ${dashed.math.join(' ')}`)
  await dashedPage.screenshot({ path: `${SHOTS}/style-dashed.png` })
  await dashedPage.close()

}

// ── Paper 1: viewport translation (§10), first-screen area before scrolling, remaining content after scrolling, title, rate ──
{
  const { page, logs, requests, originalTitle, spinnersSeen } = await openPaper(PAPER, GOOGLE)
  const first = idleOf(await waitForLog(logs, IDLE, 120_000))
  check(`Paper ${PAPER}: only the first-screen area translates before scrolling (google-web)`, !!first && first.requested > 0 && first.requested < first.total && first.done === first.requested && first.failed === 0, first?.text ?? '(no idle line)')
  const spinners = await spinnersSeen()
  check('Loading spinners were inserted during requests (§7.6)', spinners > 0, `${spinners} spinners inserted`)
  const translated = await page.title()
  check('Tab title is translated', translated !== originalTitle && /[\u4e00-\u9fff]/.test(translated), `${originalTitle} → ${translated}`)
  await page.screenshot({ path: `${SHOTS}/paper-first-screen.png` })

  logs.length = 0
  await scrollThrough(page)
  // Stable means the last idle line stays unchanged for 3 seconds and no pending nodes remain
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
  // Pipeline counts alone can pass even if rendering does nothing or translation nodes are deleted (Codex #34).
  // Total counts alone also fail: `localizeNotes` footnote copies retain axt-t (only data-axt-* is stripped),
  // so translation count can exceed completed count, and an unrelated footnote copy can mask a missing translation (Codex #77).
  // Verify **per block** instead: every original marked translated must have a real translation found by its id
  const orphans = await page.evaluate(() => [...document.querySelectorAll('[data-axt-state="translated"]')]
    .filter(el => {
      const id = el.getAttribute('data-axt-id')
      return !id || !document.querySelector(`.axt-t[data-axt-for="${CSS.escape(id)}"]:not(.axt-mirror, .axt-pending, .axt-error)`)
    })
    .map(el => `${el.tagName}.${[...el.classList].filter(c => c.startsWith('ltx_'))[0] ?? ''}`)
    .slice(0, 5))
  check('After scrolling to the bottom, every completed block has its own translation node; unseen blocks send no requests',
    !!last && last.requested > first.requested && last.done === last.requested && last.failed === 0
    && dom.pendingNodes === 0 && orphans.length === 0,
    `${last?.text ?? '(no idle after scroll)'}; completed blocks missing translations ${JSON.stringify(orphans)}; DOM ${JSON.stringify(dom)}`)
  const peak = peakPerSecond(requests)
  // Batching (§8.3): combine paper segments into large requests. Before 2026-09-06 only LLMs batched; google-web sent one request per call,
  // measured at 65 requests for 213 blocks, averaging 4.2 segments/request; after the fix, 190 blocks used 21 requests, averaging 11.2 segments
  const items = requests.reduce((n, r) => n + r.items, 0)
  const perRequest = requests.length ? items / requests.length : 0
  check('google-web batching: combine paper segments into large requests, not one per segment', requests.length > 0 && perRequest >= 5, `${requests.length} requests carrying ${items} segments, average ${perRequest.toFixed(1)} segments/request`)
  // Concurrency gate (§8.3): google-web declares maxConcurrent 2; never exceed it in flight. Rate 20/s and burst 8 cover pathological cases only
  const concurrent = requests.reduce((p, a) => Math.max(p, requests.filter(b => b.t <= a.t && b.end > a.t).length), 0)
  check('google-web concurrency: at most 2 in flight (provider-declared maxConcurrent)', requests.length > 0 && concurrent <= 2, `peak in flight ${concurrent}, peak in 1-second window ${peak}`)
  await page.screenshot({ path: `${SHOTS}/paper.png` })

  // ── Reload and translate: first-screen area fully cached, no endpoint requests ──
  logs.length = 0
  requests.length = 0
  // Chrome restores scroll position on reload; scroll to top first so both first screens contain the same blocks
  await page.evaluate(() => window.scrollTo(0, 0))
  await sleep(300)
  await page.reload({ waitUntil: 'domcontentloaded' })
  const again = idleOf(await waitForLog(logs, IDLE, 60_000))
  // cached counts segments (each table cell is one), done counts blocks; differences are normal. The key check is zero endpoint requests
  check('Reload and translate: first-screen area fully cached, no endpoint requests', !!again && again.done === again.requested && again.cached >= again.done && requests.length === 0, `${again?.text ?? '(no idle line)'}; endpoint requests ${requests.length}`)
  await page.close()
}

// ── Paper 2: restore original mid-translation, cancel queued and in-flight requests together ──
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
  await page.bringToFront() // Popup queries the active tab in the current window
  await popup.getByRole('button', { name: 'Restore original' }).waitFor({ timeout: 10_000 })
  const requestsBefore = requests.length
  const tCancel = Date.now()
  await popup.getByRole('button', { name: 'Restore original' }).click()
  await sleep(4_000)
  const after = await countDom(page)
  const late = requests.filter(r => r.t > tCancel + 500).length
  check('Restore leaves no translations or data-axt-* attributes (scan all names, not just two)',
    after.translations === 0 && after.marked === 0 && !after.on,
    `${JSON.stringify(after)}; ${partial} translations existed before restore`)
  check('No new requests after restore (queued batches canceled)', late === 0, `${requestsBefore} requests before restore, ${late} new after 0.5 s`)
  check('Restore returns the tab title to the original', (await page.title()) === originalTitle, `${await page.title()}; log: ${logs.find(l => /translation stopped/.test(l.text))?.text ?? '(no stopped line)'}`)
  await popup.screenshot({ path: `${SHOTS}/popup-after-restore.png` })
  await popup.close()
  await page.close()
}

// ── Close tab: cancel background queues too (Codex #59) ─────────────────────
// After moving requests to background, destroying the content script no longer destroys this work. Without cancellation, the closed tab still
// continues paid requests until each batch exhausts its budget (up to 180 seconds).
{
  const stall = await stallEndpoint(GOOGLE)
  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER2}#axt-translate`, { waitUntil: 'domcontentloaded' })
  // Unsent work must really exist before closing, or testing whether requests continue is vacuous
  // (the first version hit cache for the entire first screen and sent only 2 requests, testing nothing)
  const q = await fillQueue(page, stall)
  const before = stall.held.length
  await page.close()
  await sleep(500)
  await stall.release() // Free slots; a live queue immediately dispatches the next batch
  await sleep(6_000)
  const late = stall.held.length - before
  await stall.off()
  check('Closing the tab stops new background requests (session canceled with tab)',
    q.confirmed && q.requests === GOOGLE_SLOTS && late === 0,
    `${q.pending} pending blocks, only ${q.requests} requests (${q.items} segments) reached endpoint; releasing one slot added ${q.extra} requests, ${q.confirmed ? 'including an unseen body (a genuinely queued new batch, not a retry)' : 'all retries of the same batch: no queued work, invalid assertion'}; ${late} new requests after closing tab and releasing all slots`)
}

// ── Navigate away: tabs.onRemoved does not cover this (Codex #59) ───────────
{
  const stall = await stallEndpoint(GOOGLE)
  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${PAPER3}#axt-translate`, { waitUntil: 'domcontentloaded' })
  const q = await fillQueue(page, stall)
  const before = stall.held.length
  // Navigate to a non-arXiv page: the content script disappears and never sends a new scope
  await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' })
  await sleep(500)
  await stall.release()
  await sleep(6_000)
  const late = stall.held.length - before
  await stall.off()
  await page.close()
  check('Navigating away stops new background requests (session canceled with navigation)',
    q.confirmed && q.requests === GOOGLE_SLOTS && late === 0,
    `${q.pending} pending blocks, only ${q.requests} requests (${q.items} segments) reached endpoint; releasing one slot added ${q.extra} requests, ${q.confirmed ? 'including an unseen body (a genuinely queued new batch, not a retry)' : 'all retries of the same batch: no queued work, invalid assertion'}; ${late} new requests after navigating away and releasing all slots`)
}

// ── Options: restore default style, cache statistics and clearing (§9) ──────
{
  await options.bringToFront()
  await options.reload({ waitUntil: 'domcontentloaded' })
  await options.getByRole('combobox', { name: /^Appearance\b/ }).selectOption('none')
  await options.getByRole('button', { name: 'Save', exact: true }).click()
  await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })

  // Earlier papers populated the cache; reload to obtain current statistics
  await options.getByText(/[1-9]\d* cached entries/).waitFor({ timeout: 15_000 }).catch(() => undefined)
  const before = await options.getByText(/\d+ cached entries/).textContent()
  options.once('dialog', d => d.accept())
  await options.getByRole('button', { name: 'Clear all cache' }).click()
  await options.getByText(/Deleted \d+ entries/).waitFor({ timeout: 10_000 })
  const after = await options.getByText(/\d+ cached entries/).textContent()
  check('Cache management: show entry count, zero after clearing', /[1-9]\d* cached entries/.test(before ?? '') && /\b0 cached entries\b/.test(after ?? ''), `before: ${before}; after: ${after}`)
}

// ── Wrong key + fallback enabled (§8.5): LLM auth error switches to google-web, page completes normally ──
{
  await options.bringToFront()
  await options.selectOption('select >> nth=0', 'openai-compat')
  await options.fill('input[type="password"]', 'sk-or-v1-bogus-key-for-auth-test')
  await options.getByRole('button', { name: 'Save', exact: true }).click()
  await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })

  // Connection testing asks whether the configured endpoint works and must report auth accurately; fallback would falsely show success,
  // making users think their key works while the page uses Google (same inconsistency as issue #42, in reverse)
  await options.getByRole('button', { name: /Test connection/ }).click()
  const bogusTest = await (await options.waitForSelector('main p[style*="background"]', { timeout: 30_000 })).textContent()
  check('Wrong-key connection test reports failure without being masked by fallback', /Failed/.test(bogusTest ?? '') && /auth/.test(bogusTest ?? ''), bogusTest)

  const { page, logs, requests } = await openPaper(PAPER, 'openrouter.ai')
  const done = await waitForLog(logs, IDLE, 90_000)
  await sleep(2_000)
  const idle = idleOf(done)
  // The fallback console.warn now appears in background console, invisible to the page (§8.0);
  // OpenRouter request count proves the preferred engine was tried, and the popup check below proves visibility to users
  check('Wrong key + fallback enabled: free engine completes the page without fatal errors',
    !!idle && idle.failed === 0 && idle.done > 0 && !/fatal:/.test(done?.text ?? '') && requests.length > 0,
    `${done?.text ?? '(no idle line)'}; OpenRouter requests ${requests.length}`)

  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByText(/switched to/).waitFor({ timeout: 10_000 }).catch(() => undefined)
  const notice = await popup.getByText(/switched to/).count()
  check('Popup identifies the active fallback engine', notice > 0, `${notice} matching notices`)
  await popup.screenshot({ path: `${SHOTS}/popup-demoted.png` })
  await popup.close()
  await page.close()
}

// ── Wrong key + fallback disabled: restore 401 → auth → drain entire queue ──
{
  await options.bringToFront()
  await options.getByRole('checkbox', { name: /^Automatically fall back when an engine fails\b/ }).uncheck()
  await options.getByRole('button', { name: 'Save', exact: true }).click()
  await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })

  // Record when 401 returns to assert no new requests afterward, rather than counting the first wave;
  // its size depends on token-bucket burst timing, making a ≤ 20 bound unreliable (issue #82)
  let firstAuthFailure = Number.POSITIVE_INFINITY
  // Count requests already dispatched at the exact moment 401 arrives. Partition by index, not time (Codex #95):
  // any time tolerance can misclassify immediate slot-refill requests as pre-401, escaping both checks.
  // In-flight requests necessarily emit their request event before this 401 response event; index gives an exact boundary
  let sentAtAuth = -1
  // Count both 401 and 403 (Codex #95): openai-compat classifies gateway rejection of a fake key as auth in either case,
  // and retry-policy drains the queue; listening only for 401 would fail correct product behavior
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
  // After fatal, scroll the entire paper to make the assertion falsifiable (Codex #95 found the old 1-second window too broad).
  // The old check counted new requests within one second of the first 401 while in-flight batches from the same wave were still completing,
  // so the count proved little; measurements found a second wave of 7 requests completely hidden by that window.
  //
  // That second wave is not a retry: 8 batches fill all slots and receive 401 together; remaining blocks enter batching afterward,
  // and failQueue drains only work currently queued. The real guarantee is that the whole session stops:
  // only a first-screen subset of 292 blocks was touched; over 200 remaining blocks must never send requests. Scrolling tests that guarantee:
  // if fatal does not disconnect the observer, remaining blocks enter view and continue consuming quota.
  // Idle timestamps come from the console listener and request timestamps from the request listener, each using Date.now(), so ordering can differ by milliseconds.
  // This tolerance hides nothing here: afterAuth below covers every post-401 request by index;
  // this assertion checks only requests after scrolling, which would occur seconds after idle
  const EVENT_JITTER_MS = 50
  const idle = idleOf(done)
  await scrollThrough(page)
  await sleep(3_000)
  context.off('response', onAuthResponse)
  // Do not ignore the first-401-to-idle interval (Codex #95). Its current request count is not zero,
  // and that is not a regression: a wave invariably arrives 75–279 ms after the first 401 because failQueue drains only tasks currently in
  // RequestQueue; remaining blocks are still accumulating in BatchQueue (tracked in issue #96 with timeline).
  // Include that wave with bounds rather than exempting it behind the old one-second window. It must be a single flush:
  // post-401 requests arrive in one beat (measured span 0–1 ms, all dispatched together by BatchQueue).
  // This catches both regressions Codex identified: an undrained queue spreads batches across seconds as slots become free;
  // retried failed batches wait at least 1 second and fall outside the beat. Once #96 is fixed, tighten to afterAuth.length === 0
  // (zero span still holds then; this check needs no further change).
  const beforeAuth = requests.slice(0, Math.max(sentAtAuth, 0))
  const afterAuth = requests.slice(Math.max(sentAtAuth, 0))
  const afterIdle = requests.filter(r => r.t > (done?.t ?? 0) + EVENT_JITTER_MS)
  // requests is appended in dispatch order; last minus first gives the wave span.
  // Span alone misses a single request (always zero, even if it leaks seconds later; Codex #95),
  // so also require the entire wave within 1 second after 401. The latest measured request was +283 ms,
  // leaving roughly triple margin; a live queue or retried batch is pushed past 1 second by backoff
  const POST_AUTH_FLUSH_MS = 100
  const POST_AUTH_WINDOW_MS = 1_000
  const afterAuthSpan = afterAuth.length > 1 ? afterAuth[afterAuth.length - 1].t - afterAuth[0].t : 0
  const afterAuthLast = afterAuth.length > 0 ? afterAuth[afterAuth.length - 1].t - firstAuthFailure : 0
  const offsets = requests.map(r => Math.round(r.t - firstAuthFailure)).sort((a, b) => a - b)
  check('Wrong key + fallback disabled: entire session stops after 401, with no requests even after scrolling to bottom',
    Number.isFinite(firstAuthFailure) && sentAtAuth >= 0 && /fatal: auth/.test(done?.text ?? '')
      && (idle?.requested ?? 0) < (idle?.total ?? 0) // Unrequested blocks must remain for scrolling to falsify the claim
      && afterAuthSpan <= POST_AUTH_FLUSH_MS && afterAuthLast <= POST_AUTH_WINDOW_MS // Only one post-401 flush, not staggered dispatch or retries
      && afterIdle.length === 0,
    `${idle?.requested}/${idle?.total} blocks requested, ${requests.length} total requests (offsets from first 401: ${offsets.join('/')} ms); before 401: ${beforeAuth.length}, after: ${afterAuth.length}, span ${afterAuthSpan} ms, latest +${afterAuthLast} ms (#96: should be 0; currently one flush of work accumulated in BatchQueue); ${afterIdle.length} new after fatal and full-page scroll; ${done?.text ?? '(no idle line)'}; DOM ${JSON.stringify(await countDom(page))}`)
  const widgets = await page.evaluate(() => document.querySelectorAll('.axt-error').length)
  check('Failed blocks have retry / reason widgets (§7.6)', !!idle && widgets > 0 && widgets === idle.failed, `${widgets} widgets, ${idle?.failed ?? '?'} failed blocks`)
  await page.close()
}

// ── In-page anchors in only mode (issue #44) ────────────────────────────────
// only mode sets translated original blocks to display:none, removing cross-reference targets. Before the fix,
// clicking §7 (target: hidden p.ltx_p) left scrollY at 0. Among 3374 in-page anchors in 12 fixtures,
// 118 (3.5%) target content inside translation blocks
{
  // Earlier wrong-key tests selected openai-compat with a fake key and disabled fallback; switch back to the free engine first
  await options.bringToFront()
  await options.selectOption('select >> nth=0', 'google-web')
  await options.getByRole('button', { name: 'Save', exact: true }).click()
  await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })

  const { page, logs } = await openPaper(PAPER4, 'translate-pa.googleapis.com')
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  // openPaper starts translation via #axt-translate; only switch mode here, changing <html> attributes without retranslating
  await popup.getByRole('button', { name: 'Translation only', exact: true }).waitFor({ timeout: 10_000 })
  await popup.getByRole('button', { name: 'Translation only', exact: true }).click()
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
      // Must land on the correct translation within the viewport; movement alone would accept scrolling anywhere
      landedOnTranslation: !!rect && rect.top >= -2 && rect.top < innerHeight,
      hash: location.hash,
      // Clone IDs are stripped; the page must have no duplicate IDs (issue #44, fourth acceptance criterion)
      duplicateIds: (() => {
        const seen = new Set(); const dupes = new Set()
        for (const el of document.querySelectorAll('[id]')) { if (seen.has(el.id)) dupes.add(el.id); seen.add(el.id) }
        return [...dupes].slice(0, 5)
      })(),
    }
  })
  check('only-mode anchors targeting hidden blocks land on their translations (issue #44)',
    r.candidates > 0 && r.moved > 0 && r.landedOnTranslation && r.hash === r.href,
    `${r.candidates} anchors with hidden targets; clicked ${r.href}, scrolled ${r.moved}px, landed on translation ${r.landedOnTranslation}, hash ${r.hash}`)
  check('Translation clones introduce no duplicate IDs (issue #44)', Array.isArray(r.duplicateIds) && r.duplicateIds.length === 0, `duplicate IDs: ${JSON.stringify(r.duplicateIds)}`)
  await page.close()
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
