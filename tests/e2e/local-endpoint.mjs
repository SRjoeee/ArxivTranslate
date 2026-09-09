// Issue #42 regression benefit: moving translation requests back to background restores local HTTP endpoints without CORS headers.
// Previously, content-script fetch used the page origin and preflight, while HTTPS pages could not reach HTTP endpoints
//due to mixed-content blocking, so local Ollama-style endpoints failed. Background requests bypass both restrictions.
// Measured evidence: RESEARCH §6.7.
//
// Control experiment (2026-09-06, AXT_EXT_DIR pointing at main build): before the move, options connection testing passed (always via
// background), but 0/12 page paragraphs came from the local endpoint, which received zero requests; the page issued 21 mixed-content-blocked
// requests and silently fell back to google-web, still producing fluent Chinese. Assert that translations carry MARK,
// not merely that Chinese appeared: the broken architecture also produces Chinese.
//
// Usage: pnpm build && pnpm e2e:local-endpoint (first run: npx playwright install chromium)
// Environment: AXT_PAPER selects a paper; AXT_HEADED=1 shows the browser.
import { createServer } from 'node:http'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const EXT = `${HERE}.ext-local`
const PROFILE = `${HERE}.profile-local`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
/** Translation prefix appears only when the local endpoint is actually used, never after google-web fallback */
const MARK = '〖LOCAL〗'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── Fake OpenAI-compatible endpoint: deliberately no CORS headers, all preflights return 405 ──
const seen = { post: 0, options: 0, origins: new Set() }

/** User message contains JSON.stringify(segments) (src/providers/prompt.ts); try the longest valid array from the end backward */
function segmentsFrom(prompt) {
  const start = prompt.indexOf('[{"id":')
  if (start < 0) return null
  const ends = []
  for (let i = prompt.indexOf(']', start); i >= 0; i = prompt.indexOf(']', i + 1)) ends.push(i + 1)
  for (const end of ends.reverse()) {
    try {
      const parsed = JSON.parse(prompt.slice(start, end))
      if (Array.isArray(parsed) && parsed.every(s => typeof s?.id === 'string' && typeof s?.text === 'string')) return parsed
    } catch {
      // This closing bracket is inside a string; try a shorter candidate
    }
  }
  return null
}

const server = createServer((req, res) => {
  const origin = req.headers.origin ?? '(none)'
  seen.origins.add(origin)
  if (req.method === 'OPTIONS') {
    seen.options++
    res.writeHead(405).end()
    return
  }
  let body = ''
  req.on('data', chunk => { body += chunk })
  req.on('end', () => {
    seen.post++
    let segments = null
    try {
      const parsed = JSON.parse(body)
      const user = [...(parsed.messages ?? [])].reverse().find(m => m.role === 'user')
      segments = segmentsFrom(typeof user?.content === 'string' ? user.content : '')
    } catch {
      // Fall through to the 400 response below
    }
    if (!segments) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'Unrecognized segments' } }))
      return
    }
    // Echo unchanged with prefix: placeholders stay intact and validation passes; prefix identifies local-endpoint translations in DOM
    const content = JSON.stringify({ segments: segments.map(s => ({ id: s.id, text: `${MARK}${s.text}` })) })
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
      id: 'chatcmpl-local', object: 'chat.completion', created: 0, model: 'local-echo',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
    }))
  })
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const PORT = server.address().port
const BASE_URL = `http://127.0.0.1:${PORT}/v1`
console.log(`Fake endpoint at ${BASE_URL} (no CORS headers, preflight returns 405)`)

// ── Install extension: copy build output and grant local host access only to the copy ──
// Production declares http://*/* as optional_host_permissions, granted per host when users save settings;
// that native dialog cannot be clicked by Playwright (observed to hang). Authorization is outside this e2e’s scope,
// so pregrant it in the copied manifest, leaving repository wxt.config.ts unchanged
for (const dir of [EXT, PROFILE]) rmSync(dir, { recursive: true, force: true })
cpSync(SRC, EXT, { recursive: true })
const manifest = JSON.parse(readFileSync(`${EXT}/manifest.json`, 'utf8'))
manifest.host_permissions = [...(manifest.host_permissions ?? []), 'http://127.0.0.1/*']
writeFileSync(`${EXT}/manifest.json`, JSON.stringify(manifest, null, 2))
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

// ── Options: point to local endpoint, test connection ────────────────────────
const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'openai-compat')
await options.getByRole('textbox', { name: /^Base URL\b/ }).fill(BASE_URL)
await options.getByRole('textbox', { name: 'Model', exact: true }).fill('local-echo')
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
await options.getByRole('button', { name: /Test connection/ }).click()
const testText = await (await options.waitForSelector('main p[style*="background"]', { timeout: 30_000 })).textContent()
check('Options connection test reaches a local HTTP endpoint without CORS headers', /ms/.test(testText) && !/Failed/.test(testText), testText)
await options.screenshot({ path: `${SHOTS}/local-endpoint-options.png` })

// ── Real paper: translations must carry the local prefix (absent after google-web fallback) ──
const postsBeforePage = seen.post
const page = await context.newPage()
const pageRequests = []
page.on('request', request => { if (request.url().includes(`127.0.0.1:${PORT}`)) pageRequests.push(request.url()) })
await page.goto(`https://arxiv.org/html/${PAPER}#axt-translate`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(mark => [...document.querySelectorAll('.axt-t')].some(el => el.textContent?.includes(mark)), MARK, { timeout: 90_000 })
  .catch(() => undefined)
await sleep(2_000)

const dom = await page.evaluate(mark => {
  const nodes = [...document.querySelectorAll('.axt-t:not(.axt-mirror):not(.axt-pending):not(.axt-error)')]
  return {
    translations: nodes.length,
    fromLocal: nodes.filter(el => el.textContent?.includes(mark)).length,
    errors: document.querySelectorAll('.axt-error').length,
    sample: nodes[0]?.textContent?.slice(0, 60) ?? '',
  }
}, MARK)
check('HTTPS paper uses local HTTP endpoint: all translations come from it, no fallback',
  dom.translations > 0 && dom.fromLocal === dom.translations && dom.errors === 0,
  `${dom.fromLocal}/${dom.translations} paragraphs have the local prefix, ${dom.errors} error widgets; sample: ${dom.sample}`)
check('Endpoint receives page-translation requests, not just the connection test', seen.post > postsBeforePage, `${seen.post - postsBeforePage} requests after connection test`)
check('No preflights: requests originate from extension, not page',
  seen.options === 0 && !seen.origins.has('https://arxiv.org'),
  `OPTIONS count ${seen.options}; observed Origins: ${[...seen.origins].join(', ')}`)
check('Page itself sends no requests (old architecture sent mixed-content-blocked requests here)', pageRequests.length === 0, `${pageRequests.length} requests`)
await page.screenshot({ path: `${SHOTS}/local-endpoint-paper.png` })

await context.close()
server.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
