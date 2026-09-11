// 占位符存活率探针（DESIGN §6.3）：把一篇**合成论文**喂给真实引擎，量每种句型、每个位置上的
// 受保护节点有没有原样回来。方法论借自 Read Frog 的 PR #2155——他们为了决定 `{{n}}` 的解码器
// 要不要容错，跑了 739 个真机请求，结论是收紧而不是放宽。我们的协议（`tags` / `markers`）
// 此前只有 fixture 与整页 e2e，没有按位置与句型分解过。
//
// 页面用 `page.route` 假冒 `arxiv.org/html/<id>`，所以**不碰 arXiv**（不受限流影响），
// 但走的是完整管线：extract → serialize → 发请求 → validate → rehydrate。
// 判据是 DOM 计数：译文里的 `math` / `.ltx_cite` / `.ltx_ref` 与原文逐项相等才算过。
// 校验失败时管线会重发、再兜底到 runs（§6.3），所以计数相等也涵盖"兜底救回来了"——
// 真正要抓的是**内容丢了**。
//
// 用法：pnpm build && pnpm e2e:placeholders ["Google 翻译"] [目标语言]
// 环境变量：AXT_HEADED=1 看着跑；AXT_LOG=1 打印扩展日志。
// LLM 路径要自己配服务（设置页选好之后把引擎名传进来），这里默认只跑两个免费引擎。
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { chooseBuiltIn, chooseLanguage, openOptions, setSwitch } from './options-page.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile-placeholders`
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const engine = process.argv[2] ?? 'Google 翻译'
const language = process.argv[3] ?? '简体中文'

/** LaTeXML 的真实形状：行内公式带 semantics + annotation，引用是 cite 包 a，交叉引用是 a.ltx_ref */
const math = (tex, rendered) => `<math class="ltx_Math" alttext="${tex}" display="inline"><semantics><mi>${rendered}</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`
const cite = n => `<cite class="ltx_cite ltx_citemacro_cite">[<a href="#bib.bib${n}" class="ltx_ref">${n}</a>]</cite>`
const ref = s => `<a href="#S${s}" class="ltx_ref"><span class="ltx_text ltx_ref_tag">${s}</span></a>`

/**
 * 句型 × 占位符位置。每一条都对应一种真实的失败模式：
 * 句首 / 句末的占位符最容易被引擎连着标点一起吞；相邻两个容易被合并；
 * `256×256` 那条是 Read Frog 实测唯一见过的丢失形态（模型自己把 `×` 写出来、不抄占位符）；
 * 整句被 `<em>` 包住的那条走的是**成对**占位符，与 void 的失败方式不同
 */
const SHAPES = [
  ['句首', `${math('x', 'x')} denotes the latent variable in our model.`],
  ['句中', `We train the model on ${math('D', 'D')} using a fixed schedule.`],
  ['句末', `The learning rate decays towards ${math('0', '0')}.`],
  ['紧贴标点', `Let ${math('\\theta', 'θ')}, the parameter vector, be fixed.`],
  ['相邻两个', `The pair ${math('u', 'u')}${math('v', 'v')} is orthogonal.`],
  ['数字夹运算符', `Images are resized to 256${math('\\times', '×')}256 pixels before training.`],
  ['一句三个', `We compare ${math('a', 'a')}, ${math('b', 'b')} and ${math('c', 'c')} on the same benchmark.`],
  ['引用', `Prior work ${cite(12)} reports the same effect on larger corpora.`],
  ['交叉引用', `As shown in Section ${ref('3.1')}, the estimator is unbiased.`],
  ['引用加公式', `Following ${cite(7)}, we set ${math('\\alpha', 'α')} to a constant.`],
  ['成对占位符', `<em class="ltx_emph ltx_font_italic">The model ${math('f', 'f')} is trained end to end</em> on four GPUs.`],
  ['长句七个', `The encoder maps ${math('x', 'x')} to ${math('z', 'z')}, the decoder reconstructs ${math('\\hat{x}', 'x̂')} from ${math('z', 'z')}, and the loss compares ${math('\\hat{x}', 'x̂')} with ${math('x', 'x')} under ${math('\\ell_2', 'ℓ₂')}.`],
]

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Placeholder survival probe</title></head><body>
<div class="ltx_page_main"><div class="ltx_page_content"><article class="ltx_document">
<h1 class="ltx_title ltx_title_document">A synthetic paper for placeholder survival</h1>
${SHAPES.map(([, html], i) => `<div class="ltx_para" id="P${i}"><p class="ltx_p" id="P${i}.p">${html}</p></div>`).join('\n')}
</article></div></div></body></html>`

// 合成页顶着一个**不存在**的 arXiv id：popup 只放行形如 /html/<id> 的地址（pipeline/paper.ts）
const PAGE_URL = 'https://arxiv.org/html/2599.99999v9'

rmSync(PROFILE, { recursive: true, force: true })
mkdirSync(PROFILE, { recursive: true })
const context = await chromium.launchPersistentContext(PROFILE, {
  channel: 'chromium',
  headless: !process.env.AXT_HEADED,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  viewport: { width: 1400, height: 1000 },
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]

const options = await openOptions(context, extId)
await chooseBuiltIn(options, engine)
await setSwitch(options, '图片翻译', false)
if (language !== '简体中文') await chooseLanguage(options, language, language)
await options.close()

const page = await context.newPage()
if (process.env.AXT_LOG) page.on('console', m => { const t = m.text(); if (t.includes('[axt]')) console.log('  ·', t.slice(0, 160)) })
await page.route(PAGE_URL, route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: PAGE }))
await page.goto(PAGE_URL, { waitUntil: 'domcontentloaded' })

const popup = await context.newPage()
await popup.goto(`chrome-extension://${extId}/popup.html`)
await page.bringToFront()
await popup.getByRole('button', { name: '上下', exact: true }).click()
await sleep(300)
await popup.getByRole('button', { name: '翻译本页', exact: true }).click()
await sleep(500)
await popup.close()
for (let i = 0, stable = 0; i < 80; i++) {
  await sleep(500)
  stable = (await page.evaluate(() => document.querySelectorAll('.axt-pending').length)) === 0 ? stable + 1 : 0
  if (stable >= 3 && i >= 4) break
}

const rows = await page.evaluate(names => {
  const countOf = el => ({
    math: el.querySelectorAll('math').length,
    cite: el.querySelectorAll('.ltx_cite').length,
    ref: el.querySelectorAll('a.ltx_ref:not(.ltx_cite a)').length,
  })
  return names.map((name, i) => {
    const src = document.getElementById(`P${i}.p`)
    const t = src?.nextElementSibling
    if (!t?.classList.contains('axt-t')) return { name, state: '没有译文' }
    if (t.classList.contains('axt-error')) return { name, state: '翻译失败' }
    const a = countOf(src)
    const b = countOf(t)
    return {
      name,
      src: a,
      out: b,
      same: a.math === b.math && a.cite === b.cite && a.ref === b.ref,
      text: (t.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 60),
    }
  })
}, SHAPES.map(shape => shape[0]))

let ok = 0
for (const row of rows) {
  if (row.same) ok++
  const counts = row.src ? `${Object.values(row.src).join('/')} → ${Object.values(row.out).join('/')}` : row.state
  console.log(`${row.same ? 'PASS' : 'FAIL'} ${row.name.padEnd(6)} math/cite/ref ${counts}  ${row.text ?? ''}`)
}
const total = rows.reduce((sum, row) => sum + (row.src ? row.src.math + row.src.cite + row.src.ref : 0), 0)
console.log(`\n${engine} → ${language}：${ok}/${rows.length} 个句型通过，共 ${total} 个受保护节点`)
await context.close()
process.exit(ok === rows.length ? 0 : 1)
