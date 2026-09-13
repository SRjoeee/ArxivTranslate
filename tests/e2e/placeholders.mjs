// The placeholder survival probe (DESIGN §6.3): feeds a **synthetic paper** to a real engine and measures whether the protected nodes of
// every sentence shape and position come back intact. The method is borrowed from Read Frog's PR #2155 — to decide whether the `{{n}}` decoder
// should be lenient they ran 739 real requests, and concluded to tighten rather than loosen. Our protocol (`tags` / `markers`)
// had only fixtures and the whole-page e2e until now, never a breakdown by position and sentence shape.
//
// The page fakes `arxiv.org/html/<id>` with `page.route`, so it **does not touch arXiv** (no rate limiting),
// yet runs the full pipeline: extract → serialize → request → validate → rehydrate.
// The criterion is a DOM count: the `math` / `.ltx_cite` / `.ltx_ref` in the translation must equal the source item by item.
// On a validation failure the pipeline resends and then falls back to runs (§6.3), so equal counts also cover “the fallback saved it” —
// what is really being hunted is **content lost**.
//
// Usage: pnpm build && pnpm e2e:placeholders ["Google 翻译"] [target language]
// Environment: AXT_HEADED=1 watches it run; AXT_LOG=1 prints the extension's log.
// The LLM path needs a service configured by hand (choose it on the settings page, then pass the engine name); by default only the two free engines run.
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

/** LaTeXML's real shape: an inline formula carries semantics + annotation, a citation is cite wrapping a, a cross-reference is a.ltx_ref */
const math = (tex, rendered) => `<math class="ltx_Math" alttext="${tex}" display="inline"><semantics><mi>${rendered}</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`
const cite = n => `<cite class="ltx_cite ltx_citemacro_cite">[<a href="#bib.bib${n}" class="ltx_ref">${n}</a>]</cite>`
const ref = s => `<a href="#S${s}" class="ltx_ref"><span class="ltx_text ltx_ref_tag">${s}</span></a>`

/**
 * Sentence shape × placeholder position. Each row matches a real failure mode:
 * a placeholder at the start / end of a sentence is the easiest for an engine to swallow with the punctuation; two adjacent ones tend to be merged;
 * the `256×256` row is the only loss shape Read Frog measured (the model writes the `×` itself instead of copying the placeholder);
 * the row with the whole sentence inside `<em>` goes through a **paired** placeholder, which fails differently from a void
 */
const SHAPES = [
  ['sentence start', `${math('x', 'x')} denotes the latent variable in our model.`],
  ['mid-sentence', `We train the model on ${math('D', 'D')} using a fixed schedule.`],
  ['sentence end', `The learning rate decays towards ${math('0', '0')}.`],
  ['against punctuation', `Let ${math('\\theta', 'θ')}, the parameter vector, be fixed.`],
  ['two adjacent', `The pair ${math('u', 'u')}${math('v', 'v')} is orthogonal.`],
  ['operator between digits', `Images are resized to 256${math('\\times', '×')}256 pixels before training.`],
  ['three in one sentence', `We compare ${math('a', 'a')}, ${math('b', 'b')} and ${math('c', 'c')} on the same benchmark.`],
  ['citation', `Prior work ${cite(12)} reports the same effect on larger corpora.`],
  ['cross-reference', `As shown in Section ${ref('3.1')}, the estimator is unbiased.`],
  ['citation plus formula', `Following ${cite(7)}, we set ${math('\\alpha', 'α')} to a constant.`],
  ['paired placeholder', `<em class="ltx_emph ltx_font_italic">The model ${math('f', 'f')} is trained end to end</em> on four GPUs.`],
  ['seven in a long sentence', `The encoder maps ${math('x', 'x')} to ${math('z', 'z')}, the decoder reconstructs ${math('\\hat{x}', 'x̂')} from ${math('z', 'z')}, and the loss compares ${math('\\hat{x}', 'x̂')} with ${math('x', 'x')} under ${math('\\ell_2', 'ℓ₂')}.`],
]

const PAGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Placeholder survival probe</title></head><body>
<div class="ltx_page_main"><div class="ltx_page_content"><article class="ltx_document">
<h1 class="ltx_title ltx_title_document">A synthetic paper for placeholder survival</h1>
${SHAPES.map(([, html], i) => `<div class="ltx_para" id="P${i}"><p class="ltx_p" id="P${i}.p">${html}</p></div>`).join('\n')}
</article></div></div></body></html>`

// The synthetic page sits under an arXiv id that **does not exist**: the popup lets through only addresses of the form /html/<id> (pipeline/paper.ts)
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
    if (!t?.classList.contains('axt-t')) return { name, state: 'no translation' }
    if (t.classList.contains('axt-error')) return { name, state: 'translation failed' }
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
console.log(`\n${engine} → ${language}: ${ok}/${rows.length} sentence shapes passed, ${total} protected nodes in all`)
await context.close()
process.exit(ok === rows.length ? 0 : 1)
