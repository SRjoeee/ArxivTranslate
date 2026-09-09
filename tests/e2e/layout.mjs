// Real-browser side-mode layout assertions (DESIGN §7.2 width contract, §11): happy-dom has no layout engine,
// so column widths, floating sidenotes, list-marker slots, and flex-figure pairing require Chromium measurements. Launch as in extension.mjs,
// using google-web without accessing the user’s browser or keys.
//
// Usage: pnpm build && pnpm e2e:layout (first run: npx playwright install chromium)
// Environment: AXT_HEADED=1 shows the browser.
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile-layout`
const SHOTS = `${HERE}.shots`
const REM = 16

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
await options.close()

/** Open a paper, select side-by-side mode through popup, and start translating */
async function openSide(id) {
  const page = await context.newPage()
  // Extension console logs: each side prep pass reports stage timings used by the preparation-cost assertion
  page.axtLogs = []
  page.on('console', message => { const text = message.text(); if (text.includes('[axt]')) page.axtLogs.push(text) })
  // Record main-thread long tasks: side prep once cloned each equation table for width measurement, taking 45 seconds and freezing 2312.17141 with 392 equations
  await page.addInitScript(() => {
    window.__axtLongTasks = []
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__axtLongTasks.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] })
  })
  await page.goto(`https://arxiv.org/html/${id}`, { waitUntil: 'domcontentloaded' })
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByRole('button', { name: 'Side by side', exact: true }).waitFor({ timeout: 10_000 })
  await popup.getByRole('button', { name: 'Side by side', exact: true }).click()
  await sleep(300)
  await popup.getByRole('button', { name: 'Translate', exact: true }).click()
  await sleep(500)
  await popup.close()
  return page
}

/**
 * Measure after nearby blocks finish: require three consecutive observations without pending nodes.
 * A single zero may be an inter-batch gap or incomplete marking (startTranslation asynchronously marks all blocks before creating the observer);
 * later translations then change geometry, destabilizing assertions and screenshots (Codex #40). Do not silently pass on timeout.
 */
async function quiesce(page, label = '') {
  let stable = 0
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    stable = (await page.evaluate(() => document.querySelectorAll('.axt-pending').length)) === 0 ? stable + 1 : 0
    if (stable >= 3 && i >= 5) return
  }
  check(`Wait for translation to settle${label ? ` (${label})` : ''}`, false, 'Did not observe zero pending three consecutive times within 40 s')
}

const rectOf = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), t: Math.round(r.top) } }

/** Width contract: navigation, two columns, right gutter, no overflow */
async function measureFrame(page) {
  return page.evaluate(rectSrc => {
    const rectOf = new Function('el', `return (${rectSrc})(el)`)
    const art = rectOf(document.querySelector('.ltx_page_main'))
    const nav = rectOf(document.querySelector('.ltx_page_navbar'))
    const paragraphs = [...document.querySelectorAll('.ltx_document .ltx_para > .ltx_p[data-axt-state="translated"]')]
    const p = paragraphs[2] ?? paragraphs[0]
    const t = p?.nextElementSibling?.classList.contains('axt-t') ? p.nextElementSibling : null
    return { vw: innerWidth, scrollW: document.documentElement.scrollWidth, nav, art, col: p && t ? [rectOf(p).w, rectOf(t).w] : null }
  }, rectOf.toString())
}

// ── Paper 1: 2609.04056v1 (acknowledgments in right gutter; Definition 1.2 has equation-only list items) ──
{
  const page = await openSide('2609.04056v1')
  await quiesce(page)
  for (const vw of [1440, 2000]) {
    await page.setViewportSize({ width: vw, height: 900 })
    await sleep(400)
    const m = await measureFrame(page)
    // Body first, symmetric sides (§7.2): centered article reaches the 96rem cap; both sides equal and at least arXiv’s native minimum usable width
    const centered = Math.abs((m.art.l - 0) - (m.vw - m.art.r)) <= 2
    check(`${vw}px: no horizontal overflow, centered article, symmetric sides, full body width (≤ 96rem), equal columns`,
      m.scrollW <= m.vw && centered && m.nav.w >= 13 * REM && m.art.w <= 96 * REM + 2 && m.art.w >= Math.min(96 * REM, m.vw - 2 * 25 * REM)
      && m.col !== null && Math.abs(m.col[0] - m.col[1]) <= 2,
      `scrollW ${m.scrollW}/${m.vw}, left ${m.art.l} / right ${m.vw - m.art.r}, navigation ${m.nav.w}, article ${m.art.w}, columns ${m.col?.join(' / ')}`)
    // Previously asserted right-gutter elements fell between article right edge and viewport; all four gutter elements here are acknowledgment notes.
    // Since 2026-09-06, translated acknowledgments return to two-column article layout by design (bilingual text overlaps in the 192px gutter),
    // leaving this paper’s gutter empty and the assertion without a target. Gutter geometry is now covered in 2312.17141 by
    // the body-footnote assertion: translated copy floats from the right column into the gutter, with actual gutter elements and coordinates.
    // Display equations cannot wrap; wider-than-column equations scale in steps or scroll inside the column (§7.2). Measure all mirrored equation tables; none may exceed column width
    await page.evaluate(() => document.getElementById('S1.SS4')?.scrollIntoView({ block: 'start' }))
    await quiesce(page)
    await sleep(1500) // side prep coalescer waits at most 1s
    const eqn = await page.evaluate(() => {
      const root = document.querySelector('.ltx_document')
      const column = Number.parseFloat(getComputedStyle(root).gridTemplateColumns.split(' ')[0])
      const tables = [...root.querySelectorAll('table.ltx_eqn_table')].filter(t => t.nextElementSibling?.classList.contains('axt-mirror') || t.classList.contains('axt-mirror'))
      const wide = tables.map(t => ({ w: Math.round(t.getBoundingClientRect().width), fit: t.dataset.axtFit ?? null })).filter(x => x.w > column + 1)
      return { column: Math.round(column), total: tables.length, fitted: tables.filter(t => t.dataset.axtFit).length, wide }
    })
    check(`${vw}px: display equations fit one column (no paired equation table exceeds column width)`, eqn.total > 0 && eqn.wide.length === 0,
      `column ${eqn.column}, equation tables ${eqn.total}, scaled / scrollable ${eqn.fitted}, oversized ${JSON.stringify(eqn.wide.slice(0, 3))}`)
    await page.screenshot({ path: `${SHOTS}/layout-2609.04056-${vw}.png` })
  }

  await page.evaluate(() => document.getElementById('S1.Thmproposition2')?.scrollIntoView({ block: 'center' }))
  await quiesce(page)
  const list = await page.evaluate(() => {
    const items = ['S1.I1.i1', 'S1.I1.i2', 'S1.I1.i3'].map(id => document.getElementById(id))
    const x = el => Math.round(el.getBoundingClientRect().left)
    return {
      tags: items.map(li => x(li.querySelector(':scope > .ltx_tag'))),
      // Measure text start, not boxes: unpaired p sits inside li padding while paired p has its own padding, so their boxes are incomparable
      texts: items.map(li => { const range = document.createRange(); range.selectNodeContents(li.querySelector('.ltx_p')); return Math.round(range.getClientRects()[0]?.left ?? -1) }),
      mirrors: items.map(li => { const m = li.nextElementSibling; const own = li.querySelector(':scope > .ltx_tag.axt-t'); return own ? x(own) : m?.classList.contains('axt-mirror') ? x(m.querySelector('.ltx_tag')) : null }),
    }
  })
  const same = xs => xs.every(v => v !== null && Math.abs(v - xs[0]) <= 1)
  check('Definition 1.2: equation-only first item aligns markers, body text, and right-column markers with siblings',
    same(list.tags) && same(list.texts) && same(list.mirrors),
    `markers ${list.tags.join('/')}, body ${list.texts.join('/')}, right-column markers ${list.mirrors.join('/')}`)
  // Wide markers must not cover text: temporarily replace the first marker with a long label like \item[(Assumption 1)] and remeasure (Codex #40)
  const wide = await page.evaluate(() => {
    const li = document.getElementById('S1.I1.i1')
    const tag = li.querySelector(':scope > .ltx_tag')
    const before = tag.textContent
    tag.textContent = '(Assumption 1)'
    const rect = el => el.getBoundingClientRect()
    const range = document.createRange(); range.selectNodeContents(li.querySelector('.ltx_p'))
    const text = range.getClientRects()[0]
    const item = rect(li)
    const t = rect(tag)
    const out = { tagL: Math.round(t.left), tagR: Math.round(t.right), textL: Math.round(text.left), itemL: Math.round(item.left), itemR: Math.round(item.right) }
    tag.textContent = before
    return out
  })
  check('Wide marker (Assumption 1) neither overlaps text nor extends beyond the block', wide.tagR <= wide.textL + 1 && wide.tagL >= wide.itemL - 1 && wide.textL <= wide.itemR,
    `marker ${wide.tagL}–${wide.tagR}, text starts ${wide.textL}, block ${wide.itemL}–${wide.itemR}`)
  // Inline short headings (§7.3, issue #68): `[data-axt-inline]` inline-block is not mode-scoped, raising concern that side mode
  // could squeeze original and translation into one column. Grid items are blockified, so the rule already has no effect; measure to guard this
  const inline = await page.evaluate(() => {
    const doc = document.querySelector('article.ltx_document')
    const dx = doc.getBoundingClientRect().x
    const col = Number.parseFloat(getComputedStyle(doc).gridTemplateColumns.split(' ')[0]) || 0
    const gap = Number.parseFloat(getComputedStyle(doc).columnGap) || 0
    const rows = []
    for (const orig of document.querySelectorAll('[data-axt-inline]:not(.axt-t)')) {
      const clone = orig.nextElementSibling?.hasAttribute('data-axt-inline') ? orig.nextElementSibling : null
      if (!clone) continue
      const g = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.x - dx), t: Math.round(b.y), d: getComputedStyle(el).display } }
      rows.push({ orig: g(orig), clone: g(clone) })
    }
    return { col: Math.round(col), gap, rows }
  })
  const inlineBad = inline.rows.filter(r => r.orig.d !== 'block' || r.clone.d !== 'block'
    || r.orig.l > 1 || r.clone.l < inline.col + inline.gap - 1 || Math.abs(r.orig.t - r.clone.t) > 2)
  check('Side-mode grid blockifies inline short headings: display block, original left, translation right, same row (issue #68)',
    inline.rows.length >= 3 && inlineBad.length === 0,
    `${inline.rows.length - inlineBad.length}/${inline.rows.length} pairs${inlineBad.length ? `; invalid ${JSON.stringify(inlineBad[0])}` : ''}`)
  await page.screenshot({ path: `${SHOTS}/layout-definition.png` })
  await page.close()
}

// ── Paper 2: 2609.03768v1 (Table 1 in a single-column flex figure) ────────────
{
  const page = await openSide('2609.03768v1')
  await page.setViewportSize({ width: 2000, height: 900 })
  await page.evaluate(() => document.querySelector('figure.ltx_table')?.scrollIntoView({ block: 'center' }))
  await quiesce(page)
  const tbl = await page.evaluate(() => {
    const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), w: Math.round(b.width) } }
    const art = document.querySelector('.ltx_page_main').getBoundingClientRect()
    const table = document.querySelector('figure.ltx_table table.ltx_tabular')
    const note = document.querySelector('figure.ltx_table p.ltx_figure_panel')
    const pair = el => el?.nextElementSibling?.classList.contains('axt-t') ? [r(el), r(el.nextElementSibling)] : null
    return { mid: Math.round((art.left + art.right) / 2), table: pair(table), note: pair(note) }
  })
  const sideBySide = (pair, mid) => pair !== null && Math.abs(pair[0].t - pair[1].t) <= 2 && pair[0].l < mid && pair[1].l > mid
  check('Table 1: original and translation share a row in separate columns; same for table footnotes', sideBySide(tbl.table, tbl.mid) && sideBySide(tbl.note, tbl.mid),
    `table ${JSON.stringify(tbl.table)}, footnote ${JSON.stringify(tbl.note)}, midpoint ${tbl.mid}`)
  await page.screenshot({ path: `${SHOTS}/layout-table.png` })
  await page.close()
}

// ── Paper 3: 2606.07636v2 (all 5 tables wrapped in \resizebox; user reported tables crossing the divider) ──
{
  const page = await openSide('2606.07636v2')
  // Five tables span the paper; viewport translation requires scrolling to each or only the first is measured
  for (let i = 0; i < 5; i++) {
    await page.evaluate(n => document.querySelectorAll('.ltx_transformed_outer')[n]?.scrollIntoView({ block: 'center' }), i)
    await sleep(400)
  }
  await quiesce(page)
  await page.evaluate(() => document.querySelector('.ltx_transformed_outer')?.scrollIntoView({ block: 'center' }))
  await sleep(300)
  const tables = await page.evaluate(() => {
    const doc = document.querySelector('article.ltx_document')
    const dx = doc.getBoundingClientRect().x
    const col = Number.parseFloat(getComputedStyle(doc).gridTemplateColumns.split(' ')[0])
    const gap = Number.parseFloat(getComputedStyle(doc).columnGap) || 0
    const rows = []
    for (const orig of document.querySelectorAll('table.ltx_tabular:not(.axt-t)')) {
      const clone = orig.nextElementSibling?.classList.contains('axt-t') ? orig.nextElementSibling : null
      if (!clone) continue
      const r = el => { const b = el.getBoundingClientRect(); return { l: Math.round(b.x - dx), r: Math.round(b.right - dx) } }
      const a = r(orig)
      const b = r(clone)
      // LaTeXML’s \resizebox wrapper carries .ltx_inline-block and was excluded from pairing as inline context,
      // making both tables inline-table, centered together across a full-width wrapper and crossing the divider
      rows.push({ id: orig.id, fit: orig.getAttribute('data-axt-fit'), ok: a.l >= -1 && a.r <= col + 1 && b.l >= col + gap - 1 && b.r <= 2 * col + gap + 1, a, b })
    }
    return { col, gap, rows }
  })
  const bad = tables.rows.filter(t => !t.ok)
  check('\\resizebox tables: original in left column, translation in right, neither overflows',
    tables.rows.length === 5 && bad.length === 0,
    `${tables.rows.length - bad.length}/${tables.rows.length} pairs; column width ${tables.col}${bad.length ? `; overflow ${bad.map(t => `${t.id} ${t.a.l}–${t.a.r} / ${t.b.l}–${t.b.r}`).join(', ')}` : ''}`)
  await page.screenshot({ path: `${SHOTS}/layout-resizebox-table.png` })
  await page.close()
}

// ── Paper 4: 2312.17141 (multi-panel flex figures stay side by side; translated body footnotes in right gutter) ──
{
  const page = await openSide('2312.17141')
  await page.setViewportSize({ width: 2000, height: 900 })
  await page.evaluate(() => document.querySelector('.ltx_flex_figure:has(> .ltx_flex_cell:not(.ltx_flex_size_1))')?.scrollIntoView({ block: 'center' }))
  await quiesce(page)
  const panels = await page.evaluate(() => {
    const fig = document.querySelector('.ltx_flex_figure:has(> .ltx_flex_cell:not(.ltx_flex_size_1))')
    const cells = [...fig.querySelectorAll(':scope > .ltx_flex_cell')].slice(0, 2).map(c => { const b = c.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width) } })
    return { display: getComputedStyle(fig).display, cells, mirrors: fig.querySelectorAll('.axt-mirror').length }
  })
  check('Multi-panel figure stays flex; first two panels side by side on one row, with no mirrors inside cells',
    // Side by side means vertical overlap and horizontal separation; unequal heights need not align tops
    panels.display === 'flex' && panels.cells.length === 2 && panels.cells[1].t < panels.cells[0].b && panels.cells[0].t < panels.cells[1].b && panels.cells[1].l > panels.cells[0].l + 50 && panels.mirrors === 0,
    `${panels.display}, panels ${JSON.stringify(panels.cells)}, mirrors ${panels.mirrors}`)

  await page.evaluate(() => document.querySelector('.ltx_para .ltx_note.ltx_role_footnote')?.scrollIntoView({ block: 'center' }))
  await quiesce(page)
  const note = await page.evaluate(() => {
    const art = document.querySelector('.ltx_page_main').getBoundingClientRect()
    const n = document.querySelector('.ltx_para .ltx_note.ltx_role_footnote')
    const copy = n.closest('[data-axt-id]')?.nextElementSibling?.querySelector('.ltx_note_outer')
    const orig = n.querySelector('.ltx_note_outer')
    const b = (copy ?? orig).getBoundingClientRect()
    return { which: copy ? 'copy' : 'orig', origHidden: getComputedStyle(orig).display === 'none', l: Math.round(b.left), r: Math.round(b.right), artR: Math.round(art.right), vw: innerWidth }
  })
  const tasks = await page.evaluate(() => { const t = window.__axtLongTasks.slice().sort((a, b) => b - a); return { max: t[0] ?? 0, total: t.reduce((a, b) => a + b, 0), n: t.length, eqn: document.querySelectorAll('table.ltx_eqn_table').length } })
  // Baseline before width changes: longest 175ms, total 625ms (same paper, three screens); allow twice that budget
  check('No main-thread long-task stalls (side prep measures widths read-only)', tasks.max <= 400 && tasks.total <= 1500,
    `longest ${tasks.max} ms, total ${tasks.total} ms, ${tasks.n} tasks; equation tables ${tasks.eqn}`)
  check('Body footnotes: translated copies float from right column into right gutter, originals hidden',
    note.which === 'copy' && note.origHidden && note.l >= note.artR - 4 && note.r <= note.vw + 1,
    `${note.which}, original hidden ${note.origHidden}, ${note.l}–${note.r}, article right edge ${note.artR}`)
  await page.screenshot({ path: `${SHOTS}/layout-footnote.png` })

  // Incremental preparation convergence (issue #46): once the page stabilizes, every original / translation pair has equal top margins,
  // and figures containing real translations plus unpaired media are split. Gaps in changed-region invalidation are exposed here;
  // record them rather than masking them with a full-pass fallback
  const converge = () => page.evaluate(() => {
    const REAL = '.axt-t:not(.axt-pending, .axt-error, .axt-mirror, .axt-split), .axt-img'
    const deny = '.ltx_note, [data-axt-split], .axt-split, .ltx_flex_figure:has(> .ltx_flex_cell:not(.ltx_flex_size_1))'
    let pairs = 0, misaligned = 0
    for (const t of document.querySelectorAll('.axt-t')) {
      const o = t.previousElementSibling
      if (!o || o.classList.contains('axt-t') || t.closest(deny)) continue
      pairs++
      if (getComputedStyle(o).marginTop !== getComputedStyle(t).marginTop) misaligned++
    }
    let figures = 0, unsplit = 0
    for (const f of document.querySelectorAll('figure:not(.axt-t)')) {
      if (f.parentElement?.closest('figure')) continue
      if (!f.querySelector(REAL)) continue
      const loose = [...f.querySelectorAll('img, svg, object, math, canvas, video, .ltx_picture')].some(m => !m.closest('[data-axt-id], .axt-t'))
      if (!loose) continue
      figures++
      if (!f.nextElementSibling?.classList.contains('axt-split')) unsplit++
    }
    return { pairs, misaligned, figures, unsplit, mirrors: document.querySelectorAll('.axt-mirror').length }
  })
  const c1 = await converge()
  check('Stable convergence: all paired margins equal and all eligible figures split (incremental preparation misses no regions)',
    c1.pairs > 0 && c1.misaligned === 0 && c1.figures > 0 && c1.unsplit === 0,
    `${c1.pairs} pairs, ${c1.misaligned} misaligned; ${c1.figures} figures, ${c1.unsplit} unsplit; mirrors ${c1.mirrors}`)

  // side → stack → side: leaving clears alignment margins, returning requires a full recalculation; mirrors remain in DOM and count must not change
  {
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extId}/popup.html`)
    await page.bringToFront()
    await popup.getByRole('button', { name: 'Stacked', exact: true }).waitFor({ timeout: 10_000 })
    await popup.getByRole('button', { name: 'Stacked', exact: true }).click()
    await sleep(600)
    await popup.getByRole('button', { name: 'Side by side', exact: true }).click()
    await popup.close()
    await sleep(1500)
    const c2 = await converge()
    // Pair count can only increase: stack reflow brings blocks previously beyond the preload range inside it, causing more observations
    check('side → stack → side preserves mirror count and pair alignment',
      c2.mirrors === c1.mirrors && c2.misaligned === 0 && c2.pairs >= c1.pairs,
      `mirrors ${c1.mirrors} → ${c2.mirrors}, pairs ${c1.pairs} → ${c2.pairs}, misaligned ${c2.misaligned}`)
  }

  // Preparation cost (issue #46 metric): sum stage timings logged by every prep pass
  const prepLines = page.axtLogs.filter(l => l.includes('[axt] side prep'))
  const stage = k => +prepLines.reduce((n, l) => n + (Number(l.match(new RegExp(`${k}=([\\d.]+)`))?.[1]) || 0), 0).toFixed(1)
  const cost = { runs: prepLines.length, notes: stage('notes'), split: stage('split'), mirrors: stage('mirrors'), tables: stage('tables'), margins: stage('margins'), total: stage('total') }
  check('Preparation cost: cumulative prep ≤ 600 ms (baseline 1912 ms, 31 passes; #46 target < 400)',
    cost.runs > 0 && cost.total < 600,
    JSON.stringify(cost))
  await page.close()
}

// ── Below gutter breakpoint (1280–1535px): frontmatter acknowledgment / correspondence notes must pair side by side ──
// side starts at ≥1280px, gutters at ≥96rem (1536px); between them ar5iv leaves this note in normal flow
// with a fixed 800px width, overflowing the article and stacking translation directly beneath the original as if both occupied the left column (user report, 2026-09-06)
{
  const page = await openSide('2609.04169v1')
  await quiesce(page, 'frontmatter footnotes below gutter breakpoint')
  for (const vw of [1400, 1500]) {
    await page.setViewportSize({ width: vw, height: 900 })
    await sleep(800)
    const m = await page.evaluate(() => {
      const art = document.querySelector('article.ltx_document').getBoundingClientRect()
      const note = document.querySelector('.ltx_note.ltx_note_frontmatter')
      if (!note) return null
      const outer = note.querySelector('.ltx_note_outer')
      const orig = outer?.querySelector('.ltx_note_content:not(.axt-t)')
      const trans = outer?.querySelector('.ltx_note_content.axt-t')
      if (!orig || !trans) return null
      const b = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) } }
      return { art: { l: Math.round(art.left), r: Math.round(art.right) }, outer: b(outer), orig: b(orig), trans: b(trans), mid: Math.round((art.left + art.right) / 2) }
    })
    check(`${vw}px (below gutter breakpoint): frontmatter original and translation occupy separate columns without article overflow`,
      !!m && m.orig.r <= m.mid && m.trans.l >= m.mid && m.outer.r <= m.art.r + 1,
      m ? `original ${m.orig.l}–${m.orig.r}, translation ${m.trans.l}–${m.trans.r}, midpoint ${m.mid}, article right edge ${m.art.r}, note box right edge ${m.outer.r}` : 'Frontmatter footnote or its translation not found')
  }
  // At the gutter breakpoint (≥96rem), translated frontmatter notes return to two-column article layout rather than the 192px gutter.
  // ar5iv absolutely positions gutter notes every 160px per author using original-only heights;
  // translation grows each from 26–50px to 148–194px, causing adjacent notes to overlap (one overlapping pair measured at 1800px)
  await page.setViewportSize({ width: 1800, height: 900 })
  await sleep(800)
  const wide = await page.evaluate(() => {
    const art = document.querySelector('article.ltx_document').getBoundingClientRect()
    const notes = [...document.querySelectorAll('.ltx_note.ltx_note_frontmatter')]
    const rects = notes.map(n => n.getBoundingClientRect())
    let overlaps = 0
    for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (rects[i].top < rects[j].bottom && rects[j].top < rects[i].bottom) overlaps++
    const outer = notes[0].querySelector('.ltx_note_outer')
    const orig = outer.querySelector('.ltx_note_content:not(.axt-t)')
    const trans = outer.querySelector('.ltx_note_content.axt-t')
    const b = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right) } }
    return { count: notes.length, overlaps, orig: b(orig), trans: b(trans), mid: Math.round((art.left + art.right) / 2), artR: Math.round(art.right) }
  })
  check('1800px (gutter breakpoint): frontmatter footnotes pair side by side without overlapping each other',
    wide.overlaps === 0 && wide.orig.r <= wide.mid && wide.trans.l >= wide.mid,
    `${wide.count} notes, ${wide.overlaps} overlapping pairs; original ${wide.orig.l}–${wide.orig.r}, translation ${wide.trans.l}–${wide.trans.r}, midpoint ${wide.mid}`)
  await page.screenshot({ path: `${SHOTS}/layout-frontmatter-note.png` })
  await page.close()
}

// ── Grid disables margin collapse: side mode must not inflate block spacing (user report, 2026-09-06) ──
// .ltx_document is a grid container in side mode (column lines defined once there), disabling margin collapse between children.
// arXiv inserts two zero-height .ltx_pagination elements between abstract and body, each with 32px top margin;
// block layout collapses them with the abstract bottom margin, while grid adds them. Measured on 2609.03001v1: 32px → 96px
{
  const page = await context.newPage()
  await page.setViewportSize({ width: 1800, height: 900 })
  await page.goto('https://arxiv.org/html/2609.03001v1', { waitUntil: 'domcontentloaded' })
  await sleep(1200)
  const gapOf = () => page.evaluate(() => {
    const abs = document.querySelector('.ltx_abstract')
    const sec = document.querySelector('article.ltx_document > section')
    return Math.round(sec.getBoundingClientRect().top - abs.getBoundingClientRect().bottom)
  })
  const before = await gapOf()
  await page.close()

  const translated = await openSide('2609.03001v1')
  await quiesce(translated, 'abstract-to-body spacing')
  await translated.setViewportSize({ width: 1800, height: 900 })
  await sleep(800)
  const after = await translated.evaluate(() => {
    const abs = document.querySelector('.ltx_abstract')
    const sec = document.querySelector('article.ltx_document > section')
    return {
      gap: Math.round(sec.getBoundingClientRect().top - abs.getBoundingClientRect().bottom),
      // The abstract bottom should meet the taller item in its last row: grid does not collapse child margins,
      // so the last row’s bottom margin creates real whitespace (Chinese is shorter than English; do not inspect only the translated column)
      tail: Math.round(abs.getBoundingClientRect().bottom - Math.max(...[...abs.children].map(el => el.getBoundingClientRect().bottom))),
      translated: document.querySelectorAll('.ltx_abstract .axt-t').length,
    }
  })
  check('side mode does not inflate abstract-to-body spacing (grid disables margin collapse)',
    after.translated > 0 && after.gap === before && after.tail <= 1,
    `untranslated ${before}px, side ${after.gap}px; abstract bottom minus last-paragraph bottom ${after.tail}px; ${after.translated} translation nodes in abstract`)
  await translated.close()
}

// Issue #67: mirrors (right-column visual balancing copies) must not target translation units. createMirrors cannot distinguish
// not-yet-marked blocks from permanently untranslated static content; incomplete marking can clone an entire .ltx_para / .ltx_proof
// into the right column, leaving an extra English paragraph once inner blocks translate.
//
// **This assertion cannot currently detect the marking change**: restoring sliced marking still passes. Marking 828 blocks takes only 2 ms,
// while the first prep runs after 1140 ms (150 ms debounce), a 570× gap that prevents reaching the race.
// Keep it to guard the outcome, not that path: any future whole-block clone in the right column will trigger it.
// tests/pipeline/marking.test.ts is the test actually sensitive to the marking strategy
{
  const page = await openSide('2312.17141')
  await quiesce(page, 'mirrors and translations do not overlap')
  const dup = await page.evaluate(() => {
    const sourceOf = m => { let p = m.previousElementSibling; while (p?.classList.contains('axt-t')) p = p.previousElementSibling; return p }
    const bad = [...document.querySelectorAll('.axt-mirror')]
      .map(sourceOf)
      .filter(src => src && (src.hasAttribute('data-axt-id') || src.querySelector('[data-axt-id]')))
    return {
      mirrors: document.querySelectorAll('.axt-mirror').length,
      translations: document.querySelectorAll('.axt-t:not(.axt-mirror)').length,
      cloned: bad.slice(0, 4).map(el => `${el.tagName}.${[...el.classList].join('.')}`),
      clonedCount: bad.length,
    }
  })
  check('Side-mode mirrors do not target translation units (no whole original-block clones in right column)',
    dup.mirrors > 0 && dup.translations > 0 && dup.clonedCount === 0,
    `${dup.mirrors} mirrors, ${dup.translations} translations, ${dup.clonedCount} whole-block clones${dup.cloned.length ? `: ${dup.cloned.join(', ')}` : ''}`)
  await page.close()
}

// Observer thresholds must cover the clamped threshold (issue #32 / #76). happy-dom’s fake observer invokes callbacks directly,
// unable to reproduce the browser constraint of notifying only on crossing registered values; verify in real Chromium.
// No extension or translation here, just semantics: for a block taller than root with maximum ratio below threshold,
// which registration receives the callback when that maximum is reached?
{
  const page = await context.newPage()
  await page.setContent('<style>body{margin:0}#pad{height:2000px}#big{height:3000px}</style>'
    + '<div id="pad"></div><div id="big">big</div><div style="height:3000px"></div>')
  await page.setViewportSize({ width: 800, height: 900 })
  const probe = async thresholds => page.evaluate(async t => {
    const seen = []
    const io = new IntersectionObserver(es => { for (const e of es) seen.push(+e.intersectionRatio.toFixed(3)) }, { threshold: t })
    io.observe(document.getElementById('big'))
    for (const y of [1900, 2000, 2200, 2600, 3000, 3400, 3800, 4200]) {
      scrollTo(0, y)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise(r => setTimeout(r, 120))
    }
    io.disconnect()
    scrollTo(0, 0)
    return Math.max(...seen)
  }, thresholds)
  // Element 3000px, root 900px: maximum ratio 0.3
  const CAP = 0.3
  const coarse = await probe([0, 1])                                        // Old implementation
  const grid = await probe(Array.from({ length: 21 }, (_, i) => i / 20))    // Values from observerThresholds(t>0)
  check('Observer thresholds cover oversized blocks’ reachable maximum (fine grid, issue #76)',
    coarse < CAP && grid >= CAP,
    `element 3000px / root 900px, maximum ${CAP}; [0,1] registration reaches ${coarse}, fine grid reaches ${grid}`)

  // If the maximum falls between grid points (2700px / 900px = 0.3333, grid 0.30 / 0.35), slow scrolling only notifies
  // on crossing 0.30; comparing with the exact maximum never passes, so align the predicate to the grid (issue #81)
  await page.setContent('<style>body{margin:0}#pad{height:2000px}#big{height:2700px}</style>'
    + '<div id="pad"></div><div id="big">big</div><div style="height:3000px"></div>')
  const slowMax = await page.evaluate(async () => {
    const seen = []
    const io = new IntersectionObserver(es => { for (const e of es) seen.push(e.intersectionRatio) },
      { threshold: Array.from({ length: 21 }, (_, i) => i / 20) })
    io.observe(document.getElementById('big'))
    for (let y = 1900; y <= 4600; y += 10) {
      scrollTo(0, y)
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
      await new Promise(r => setTimeout(r, 6))
    }
    io.disconnect()
    scrollTo(0, 0)
    return Math.max(...seen)
  })
  const exactCap = 900 / 2700
  const quantized = Math.floor(exactCap / 0.05 + 1e-9) * 0.05
  check('Maximum between grid points: grid-aligned predicate receives the callback (issue #81)',
    slowMax < exactCap - 1e-6 && slowMax >= quantized - 1e-6,
    `exact maximum ${exactCap.toFixed(4)}, highest ratio during slow scroll ${slowMax.toFixed(6)}; aligned threshold ${quantized.toFixed(2)}`)
  await page.close()
}

await context.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
