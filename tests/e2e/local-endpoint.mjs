// The gain of issue #42, as a regression: with translation requests moved back into the background, an **http localhost endpoint that returns no CORS headers** is usable again.
// Before the change the content script's fetch carried the page's origin and needed a preflight, and an https page could not reach an http endpoint at all
// (mixed content), so an endpoint like a local Ollama was bound to fail; after it the requests leave from the background, and neither restriction applies.
// The measurements are in RESEARCH §6.7.
//
// A control experiment (2026-09-06, AXT_EXT_DIR pointing at main's build): before the move the settings page's “Connect” still passed (it has always gone
// through the background), yet a whole-page translation had 0/12 passages from the local endpoint, the endpoint received 0 requests, and the page itself sent 21 requests blocked
// as mixed content — the chain fell back silently to google-web, and the page still read as fluent Chinese. So the assertion here is “the translation carries the MARK prefix”,
// not “it translated into Chinese”: the latter holds on the broken architecture too.
//
// Usage: pnpm build && pnpm e2e:local-endpoint     (first time: npx playwright install chromium)
// Environment: AXT_PAPER picks the paper; AXT_HEADED=1 watches it run.
import { createServer } from 'node:http'
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { copyWithGrants } from './ext-copy.mjs'
import { addService, openOptions } from './options-page.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const SRC = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const EXT = `${HERE}.ext-local`
const PROFILE = `${HERE}.profile-local`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
/** The translation prefix: appears only when the local endpoint was really used; a fallback to google-web has none */
const MARK = '〖LOCAL〗'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── The fake endpoint: OpenAI-compatible, **deliberately sends no CORS header**, every preflight 405 ───────────
const seen = { post: 0, options: 0, origins: new Set() }

/** The user message carries JSON.stringify(segments) (src/providers/prompt.ts); try the longest valid array from the end backwards */
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
      // This closing bracket is inside a string; try a shorter one
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
      // Left to the 400 below
    }
    if (!segments) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: 'segments not recognised' } }))
      return
    }
    // Echo as it is with the prefix: placeholders untouched, so validation must pass; the prefix lets the DOM show the translation came from the local endpoint
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
console.log(`fake endpoint at ${BASE_URL} (no CORS headers, preflight 405)`)

// ── Installing the extension: a copy of the build, given the localhost host permission only ──────────────────────
// In the real build http://*/* is an optional_host_permissions entry, granted one by one when the reader saves on the settings page;
// that is a native prompt Playwright cannot click (measured: it hangs for good). The grant flow is not what this e2e tests,
// so the permission is preset in the **copy's** manifest, and the repository's wxt.config.ts stays as it is
rmSync(PROFILE, { recursive: true, force: true })
copyWithGrants(SRC, EXT, { hostPermissions: ['http://127.0.0.1/*'] })
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

// ── The settings page: add a service pointing at the local endpoint, verified by “Connect” ──────────────────────────
const options = await openOptions(context, extId)
// “Connect” itself is save + verify: it names this service, does not go through the fallback service, and shows no success on a broken endpoint
const testText = await addService(options, { name: 'local echo', baseURL: BASE_URL, model: 'local-echo' })
check('the settings page connects to an http localhost endpoint that returns no CORS headers', /已连接/.test(testText), testText)
await options.screenshot({ path: `${SHOTS}/local-endpoint-options.png` })

// ── A real paper page: the translation must carry the local endpoint's prefix (a fallback to google-web would have none) ────────
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
check('the https paper page translates through the local http endpoint: every translation comes from it, no fallback',
  dom.translations > 0 && dom.fromLocal === dom.translations && dom.errors === 0,
  `${dom.fromLocal}/${dom.translations} passages carry the local prefix, ${dom.errors} failure widgets; sample “${dom.sample}”`)
check('the endpoint received the page translation\'s requests, not only the connection test', seen.post > postsBeforePage, `${seen.post - postsBeforePage} more requests after the connection test`)
check('no preflight at all: the requests leave from the extension origin, not the page origin',
  seen.options === 0 && !seen.origins.has('https://arxiv.org'),
  `${seen.options} OPTIONS; origins seen: ${[...seen.origins].join(', ')}`)
check('the page itself sent not one request (the old architecture had requests blocked as mixed content here)', pageRequests.length === 0, `${pageRequests.length} requests`)
await page.screenshot({ path: `${SHOTS}/local-endpoint-paper.png` })

await context.close()
server.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
