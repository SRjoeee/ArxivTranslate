// Image-translation e2e checks (DESIGN §15): real Chromium + local helper. Machines without helper print SKIP and exit 0 (CI).
//
// Usage: pnpm build && pnpm e2e:image (first run helper/install.sh <extension-id>)
// Environment: AXT_PAPER selects a paper (default 2507.00150v1: 6 plots); AXT_HEADED=1 shows the browser.
// AXT_HELPER_MANIFEST supplies a host manifest for an isolated build without changing system registration.
//
// Guards §15.2 structure: overlay is the image’s next sibling with matching rectangle (anchor positioning); side mode shows it only inside the figure clone,
// matching the cloned image; visible in only mode; disabled modes park images until switching to an enabled mode; restore leaves no nodes or attributes.
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
/** Location written by the installer; Chrome reads <user-data-dir>/NativeMessagingHosts/, so copy into the Playwright profile */
const INSTALLED = process.env.AXT_HELPER_MANIFEST ?? `${homedir()}/Library/Application Support/Chromium/NativeMessagingHosts/${HOST}.json`

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })
if (!existsSync(INSTALLED)) {
  console.log(`SKIP missing helper host manifest (${INSTALLED}); image translation e2e skipped`)
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
/** Scroll screen by screen, rereading height each step: translations grow the page, so initial height misses final screens */
async function scrollThrough(page) {
  for (let y = 0; ; y += 800) {
    const height = await page.evaluate(() => document.documentElement.scrollHeight)
    if (y > height) break
    await page.evaluate(top => window.scrollTo(0, top), y)
    await sleep(150)
  }
}
/** Rectangles and visibility for each bitmap and its overlay (same parent, data-axt-for targets the image) */
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

// ── Options: google-web, all three image modes enabled; exit if helper undetected ──
const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'google-web')
const stackBox = options.getByRole('checkbox', { name: 'Stacked', exact: true })
await stackBox.waitFor({ timeout: 10_000 })
// Detection initially disables all modes; skip only after a terminal unavailable result.
const helperStatus = options.getByText(/^Helper (?:.* detected\.|not detected)/)
await helperStatus.waitFor({ timeout: 20_000 })
if (!(await stackBox.isEnabled())) {
  const hint = await helperStatus.textContent()
  console.log(`SKIP options reports helper unavailable: ${hint}`)
  await context.close()
  process.exit(0)
}
for (const name of ['Side by side', 'Stacked', 'Translation only']) await options.getByRole('checkbox', { name, exact: true }).check()
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
const helperHint = await options.getByText(/Helper \d.* detected/).first().textContent()
check('Options detects helper', /Helper \d/.test(helperHint ?? ''), helperHint ?? '')

// ── stack: translate full page, overlays on all 6 images match image rectangles ──
const page = await context.newPage()
const logs = []
page.on('console', m => { const text = m.text(); if (text.includes('[axt]')) logs.push({ t: Date.now(), text }) })
await page.goto(`https://arxiv.org/html/${PAPER}#axt-translate`, { waitUntil: 'domcontentloaded' })
// Read bitmap count from content logs so changing AXT_PAPER updates expectations (Codex #89)
const bitmaps = await waitForLog(logs, /\[axt\] images: (\d+) bitmaps/, 20_000)
const N = bitmaps ? +/(\d+) bitmaps/.exec(bitmaps.text)[1] : 0
check('Content script recognized page bitmaps', N >= 1, bitmaps?.text ?? 'No images log')
await scrollThrough(page)
const idle = await waitForLog(logs, IMAGES_IDLE, 90_000, m => +m[2] === N && +m[1] + +m[4] === N)
check(`stack: all ${N} bitmaps entered and completed (images idle)`, !!idle, idle?.text ?? logs.filter(l => /images/.test(l.text)).map(l => l.text).join(' | '))
await sleep(500)
let probe = await page.evaluate(PROBE)
const withOverlay = probe.filter(p => p.overlay)
// Not every image has an overlay: numbers / single letters and unchanged translations (units, variables) are omitted. Five of six images in default 2507.00150v1 have axis text
const minOverlays = PAPER === '2507.00150v1' ? 5 : 1
check(`stack: images with translatable text have overlays (≥ ${minOverlays}), each with at least one label`, withOverlay.length >= minOverlays && withOverlay.every(p => p.overlay.labels >= 1), probe.map(p => `${p.id}:${p.overlay?.labels ?? 0}`).join(' '))
check('stack: overlay rectangles match images (anchor positioning)', withOverlay.every(p => p.overlay.visible && coincide(p.overlay.rect, p.imgRect)), withOverlay.map(p => `${p.id} Δ(${(p.overlay.rect.x - p.imgRect.x).toFixed(1)},${(p.overlay.rect.y - p.imgRect.y).toFixed(1)},${(p.overlay.rect.w - p.imgRect.w).toFixed(1)},${(p.overlay.rect.h - p.imgRect.h).toFixed(1)})`).join(' '))
// Font size follows box height: labels on wide, flat figures may be only 3–4 px, like the source; no minimum, so page zoom scales both together
check('stack: label font sizes resolve from container units (> 0)', withOverlay.every(p => p.overlay.labelFont > 0), withOverlay.map(p => p.overlay.labelFont.toFixed(1)).join(' '))
await page.evaluate(() => document.querySelector('img.ltx_graphics')?.scrollIntoView({ block: 'center' }))
await sleep(200)
await page.screenshot({ path: `${SHOTS}/image-stack.png` })

// ── side: split the whole figure; overlay visible only in clone, aligned to cloned image ──
const popup = await context.newPage()
await popup.goto(`chrome-extension://${extId}/popup.html`)
await page.bringToFront()
await popup.getByRole('button', { name: 'Side by side', exact: true }).waitFor({ timeout: 10_000 })
await popup.getByRole('button', { name: 'Side by side', exact: true }).click()
await sleep(1500)
probe = await page.evaluate(PROBE)
const clones = probe.filter(p => p.inClone && p.overlay)
// Count only originals with overlays: translated captions already split figures (Figure 1 has unit labels only and no overlay, but its caption is translated)
const originals = probe.filter(p => p.inSplitOriginal && !p.inClone && p.overlay)
const expected = withOverlay.length
check('side: all figures with overlays are split, with overlays in clones', clones.length === expected && originals.length === expected, `clones ${clones.length}, originals ${originals.length}, expected ${expected}`)
check('side: overlays visible only in clones, hidden in originals', clones.every(p => p.overlay.visible) && originals.every(p => !p.overlay?.visible), `visible clones ${clones.filter(p => p.overlay.visible).length}/${expected}, hidden originals ${originals.filter(p => !p.overlay?.visible).length}/${expected}`)
check('side: cloned overlays align with cloned images', clones.every(p => coincide(p.overlay.rect, p.imgRect)), clones.map(p => `Δ(${(p.overlay.rect.x - p.imgRect.x).toFixed(1)},${(p.overlay.rect.y - p.imgRect.y).toFixed(1)})`).join(' '))
await page.evaluate(() => document.querySelector('.axt-split img.ltx_graphics')?.scrollIntoView({ block: 'center' }))
await sleep(200)
await page.screenshot({ path: `${SHOTS}/image-side.png` })

// ── only: clone shown, overlay visible ─────────────────────────────────────
await popup.getByRole('button', { name: 'Translation only', exact: true }).click()
await sleep(800)
probe = await page.evaluate(PROBE)
const visibleOnly = probe.filter(p => p.overlay?.visible)
check('only: overlays visible in the displayed copy', visibleOnly.length === expected && visibleOnly.every(p => coincide(p.overlay.rect, p.imgRect)), `visible ${visibleOnly.length}, expected ${expected}`)

// ── Restore original: no overlays or attributes remain ──────────────────────
await popup.getByRole('button', { name: 'Restore original', exact: true }).click()
await sleep(800)
const after = await page.evaluate(() => ({
  overlays: document.querySelectorAll('.axt-img').length,
  injected: document.querySelectorAll('.axt-t, .axt-img').length,
  attrs: [document.documentElement, ...document.querySelectorAll('*')].reduce((n, el) => n + el.getAttributeNames().filter(a => a.startsWith('data-axt-')).length, 0),
}))
check('Restore original: zero overlays, injected nodes, or data-axt-* attributes', after.overlays === 0 && after.injected === 0 && after.attrs === 0, JSON.stringify(after))
await popup.close()

// ── Mode gate: side only; stack parks visible images, switching to side translates them ──
await options.bringToFront()
await options.getByRole('checkbox', { name: 'Stacked', exact: true }).uncheck()
await options.getByRole('checkbox', { name: 'Translation only', exact: true }).uncheck()
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
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
check('Mode gate: when stack is unchecked, visible images send no requests and have no overlays', parked === 0 && noImagesIdle, `overlays ${parked}, images idle log ${noImagesIdle ? 'absent' : 'present'}`)
const popup2 = await context.newPage()
await popup2.goto(`chrome-extension://${extId}/popup.html`)
await page2.bringToFront()
await popup2.getByRole('button', { name: 'Side by side', exact: true }).waitFor({ timeout: 10_000 })
await popup2.getByRole('button', { name: 'Side by side', exact: true }).click()
const resumed = await waitForLog(logs2, IMAGES_IDLE, 90_000, m => +m[1] + +m[4] >= 1)
await sleep(1500)
const afterResume = await page2.evaluate(PROBE)
const resumedClones = afterResume.filter(p => p.inClone && p.overlay?.visible)
check('Mode gate: switching to side releases parked images and creates cloned overlays', !!resumed && resumedClones.length >= 1, `${resumed?.text ?? 'No images idle'}; cloned overlays ${resumedClones.length}`)
await popup2.close()

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
