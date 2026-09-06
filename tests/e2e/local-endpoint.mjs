// issue #42 的收益回归：把翻译请求搬回 background 之后，**不返 CORS 头的 http 本机端点**重新可用。
// 改之前 content script 的 fetch 带页面 origin、要走预检，而且 https 页面根本够不着 http 端点
//（混合内容），本地 Ollama 这类端点必然失败；改之后请求从 background 发出，两道限制都不适用。
// 实测依据见 RESEARCH §6.7。
//
// 对照实验（2026-09-06，AXT_EXT_DIR 指向 main 的构建）：搬迁前设置页「测试连接」照样通过（它一直走
// background），但整页翻译 0/12 段来自本机端点、端点收到 0 个请求，而页面自己发了 21 个被混合内容
// 拦掉的请求——链静默降级到 google-web，页面上照样是通顺的中文。所以这里断言的是「译文带 MARK 前缀」，
// 不是「翻出了中文」：后者在坏掉的架构上也成立。
//
// 用法：pnpm build && pnpm e2e:local-endpoint     （首次先 npx playwright install chromium）
// 环境变量：AXT_PAPER 换论文；AXT_HEADED=1 看着跑。
import { createServer } from 'node:http'
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const HERE = new URL('.', import.meta.url).pathname
const SRC = process.env.AXT_EXT_DIR ?? new URL('../../.output/chrome-mv3', import.meta.url).pathname
const EXT = `${HERE}.ext-local`
const PROFILE = `${HERE}.profile-local`
const SHOTS = `${HERE}.shots`
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
/** 译文前缀：只有真的走了本机端点才会出现，降级到 google-web 就没有 */
const MARK = '〖LOCAL〗'

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

// ── 假端点：OpenAI 兼容，**刻意不发任何 CORS 头**，预检一律 405 ───────────
const seen = { post: 0, options: 0, origins: new Set() }

/** 用户消息里带的是 JSON.stringify(segments)（src/providers/prompt.ts）；从后往前试最长的合法数组 */
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
      // 这个右括号在字符串里，试更短的
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
      // 交给下面的 400
    }
    if (!segments) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: { message: '认不出 segments' } }))
      return
    }
    // 原样回声加前缀：占位符原封不动，校验必过；前缀让 DOM 上能认出译文来自本机端点
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
console.log(`假端点在 ${BASE_URL}（无 CORS 头，预检 405）`)

// ── 装扩展：复制一份构建产物，只给它加本机 host 权限 ──────────────────────
// 正式构建里 http://*/* 是 optional_host_permissions，要用户在设置页点保存时逐个授权；
// 那是个原生弹窗，Playwright 点不到（实测会一直挂住）。授权流程不是本条 e2e 的被测对象，
// 所以在**副本**的 manifest 里预置权限，仓库里的 wxt.config.ts 不动
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

// ── 设置页：指向本机端点，测试连接 ────────────────────────────────────────
const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'openai-compat')
await options.getByLabel('Base URL').fill(BASE_URL)
await options.getByLabel('模型').fill('local-echo')
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
await options.getByRole('button', { name: /测试连接/ }).click()
const testText = await (await options.waitForSelector('main p[style*="background"]', { timeout: 30_000 })).textContent()
check('设置页测试连接打到不返 CORS 头的 http 本机端点', /ms/.test(testText) && !/失败/.test(testText), testText)
await options.screenshot({ path: `${SHOTS}/local-endpoint-options.png` })

// ── 真实论文页：译文必须带本机端点的前缀（降级到 google-web 就不会有）────────
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
check('https 论文页翻译走本机 http 端点：译文全部来自它，没有降级',
  dom.translations > 0 && dom.fromLocal === dom.translations && dom.errors === 0,
  `${dom.fromLocal}/${dom.translations} 段带本机前缀，${dom.errors} 个失败控件；样例「${dom.sample}」`)
check('端点收到的是页面翻译的请求，不只是那次连接测试', seen.post > postsBeforePage, `连接测试后又收到 ${seen.post - postsBeforePage} 个请求`)
check('没有任何预检：请求是从扩展 origin 发出的，不是页面 origin',
  seen.options === 0 && !seen.origins.has('https://arxiv.org'),
  `OPTIONS ${seen.options} 个；见到的 Origin：${[...seen.origins].join(', ')}`)
check('页面自己一个请求都没发（旧架构下这里会有被混合内容拦掉的请求）', pageRequests.length === 0, `${pageRequests.length} 个`)
await page.screenshot({ path: `${SHOTS}/local-endpoint-paper.png` })

await context.close()
server.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
