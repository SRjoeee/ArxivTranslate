// The side-mode layout assertions in a real browser (DESIGN §7.2's width contract, §11): happy-dom has no layout engine,
// so column widths, floated margin notes, list marker slots and flex-figure pairing can only be measured in Chromium. The same launch as extension.mjs,
// the google-web engine, no touching the reader's browser or key.
//
// Usage: pnpm build && pnpm e2e:layout        (first time: npx playwright install chromium)
// Environment: AXT_HEADED=1 watches it run.
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { chooseBuiltIn, openOptions, setSwitch } from './options-page.mjs'

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

// Navigation to a real paper gets ample time: Playwright's default is 30 s, and arXiv slows down markedly after dozens of consecutive runs
// (measured: curl on the same paper took 26 s). No assertion's own wait is loosened; only the “get the page” step is
context.setDefaultNavigationTimeout(90_000)
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]

const options = await openOptions(context, extId)
await chooseBuiltIn(options, 'Google 翻译')
// Image translation (DESIGN §15) is on by default; with the helper installed on this machine the overlays and the split would disturb the layout / count assertions below,
// so it is switched off here, and the dedicated e2e:image switches it back on (kept when AXT_E2E_IMAGES=1)
if (!process.env.AXT_E2E_IMAGES) await setSwitch(options, '图片翻译', false)
await options.close()

/** Open the paper, choose side mode through the popup and start translating */
async function openSide(id) {
  const page = await context.newPage()
  // The extension's console log: side prep prints one line per pass with the timing of each stage; the tidying-cost assertion relies on it
  page.axtLogs = []
  page.on('console', message => { const text = message.text(); if (text.includes('[axt]')) page.axtLogs.push(text) })
  // Long main-thread tasks are recorded: side prep once cloned every formula table to measure its width — one pass on 2312.17141's 392 formulas took 45 seconds and the page froze
  await page.addInitScript(() => {
    window.__axtLongTasks = []
    new PerformanceObserver(list => { for (const e of list.getEntries()) window.__axtLongTasks.push(Math.round(e.duration)) }).observe({ entryTypes: ['longtask'] })
  })
  await page.goto(`https://arxiv.org/html/${id}`, { waitUntil: 'domcontentloaded' })
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByRole('button', { name: '左右', exact: true }).waitFor({ timeout: 10_000 })
  await popup.getByRole('button', { name: '左右', exact: true }).click()
  await sleep(300)
  await popup.getByRole('button', { name: '翻译本页', exact: true }).click()
  await sleep(500)
  await popup.close()
  return page
}

/**
 * Wait for the blocks near the viewport to finish before measuring: **three consecutive** observations of zero pending nodes are required.
 * A single zero may be the gap between two batches, or the blocks not yet all marked (startTranslation marks every block asynchronously first, then builds the observer),
 * and the geometry measured then is changed by the translations arriving after, so assertions and screenshots drift (Codex on #40). A timeout does not pass silently.
 */
async function quiesce(page, label = '') {
  let stable = 0
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    stable = (await page.evaluate(() => document.querySelectorAll('.axt-pending').length)) === 0 ? stable + 1 : 0
    if (stable >= 3 && i >= 5) return
  }
  check(`waiting for translation to settle${label ? ` (${label})` : ''}`, false, 'no three consecutive observations of zero pending within 40 s')
}

const rectOf = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), t: Math.round(r.top) } }

/** The width contract: navigation, two columns, the right gutter, no overflow */
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

// ── Paper 1: 2609.04056v1 (the acknowledgements block in the right gutter; Definition 1.2 has a formula-only list item) ──
{
  const page = await openSide('2609.04056v1')
  await quiesce(page)
  for (const vw of [1440, 2000]) {
    await page.setViewportSize({ width: vw, height: 900 })
    await sleep(400)
    const m = await measureFrame(page)
    // Body first, both sides symmetric (§7.2): the article is centred and fills up to the 96rem cap, both sides equal and no narrower than arXiv's native minimum usable width
    const centered = Math.abs((m.art.l - 0) - (m.vw - m.art.r)) <= 2
    check(`${vw}px: no horizontal overflow, article centred, sides symmetric, body filling the width (≤ 96rem), equal columns`,
      m.scrollW <= m.vw && centered && m.nav.w >= 13 * REM && m.art.w <= 96 * REM + 2 && m.art.w >= Math.min(96 * REM, m.vw - 2 * 25 * REM)
      && m.col !== null && Math.abs(m.col[0] - m.col[1]) <= 2,
      `scrollW ${m.scrollW}/${m.vw}, left ${m.art.l} / right ${m.vw - m.art.r}, nav ${m.nav.w}, article ${m.art.w}, columns ${m.col?.join(' / ')}`)
    // There used to be a “right-gutter elements fall inside [article right edge, viewport]” assertion here: this paper's 4 gutter elements **are all acknowledgement notes**,
    // and since 2026-09-06 an acknowledgement note with a translation returns to the article column in two columns by design (the gutter is only 192px, and bilingual text inside it presses letters together),
    // so this paper's gutter is empty and the assertion has no subject. The gutter geometry is covered instead by 2312.17141's
    // “body footnote: the translation copy floats from the right column into the right gutter” assertion — that one has real gutter elements and coordinates.
    // A display formula cannot wrap; one wider than a column scales by step or scrolls inside the column (§7.2): measure every formula table paired with a mirror, none wider than the column
    await page.evaluate(() => document.getElementById('S1.SS4')?.scrollIntoView({ block: 'start' }))
    await quiesce(page)
    await sleep(1500) // side prep's coalescer waits up to 1s
    const eqn = await page.evaluate(() => {
      const root = document.querySelector('.ltx_document')
      const column = Number.parseFloat(getComputedStyle(root).gridTemplateColumns.split(' ')[0])
      const tables = [...root.querySelectorAll('table.ltx_eqn_table')].filter(t => t.nextElementSibling?.classList.contains('axt-mirror') || t.classList.contains('axt-mirror'))
      const wide = tables.map(t => ({ w: Math.round(t.getBoundingClientRect().width), fit: t.dataset.axtFit ?? null })).filter(x => x.w > column + 1)
      return { column: Math.round(column), total: tables.length, fitted: tables.filter(t => t.dataset.axtFit).length, wide }
    })
    check(`${vw}px: display formulas fit one column (no paired formula table wider than the column)`, eqn.total > 0 && eqn.wide.length === 0,
      `column ${eqn.column}, ${eqn.total} formula tables, ${eqn.fitted} scaled / scrolling, too wide ${JSON.stringify(eqn.wide.slice(0, 3))}`)
    await page.screenshot({ path: `${SHOTS}/layout-2609.04056-${vw}.png` })
  }

  await page.evaluate(() => document.getElementById('S1.Thmproposition2')?.scrollIntoView({ block: 'center' }))
  await quiesce(page)
  const list = await page.evaluate(() => {
    const items = ['S1.I1.i1', 'S1.I1.i2', 'S1.I1.i3'].map(id => document.getElementById(id))
    const x = el => Math.round(el.getBoundingClientRect().left)
    return {
      tags: items.map(li => x(li.querySelector(':scope > .ltx_tag'))),
      // The body's start is measured on the content, not the box: an unpaired item's p sits inside the li's padding, a paired item's p has its own padding, so the boxes are not comparable
      texts: items.map(li => { const range = document.createRange(); range.selectNodeContents(li.querySelector('.ltx_p')); return Math.round(range.getClientRects()[0]?.left ?? -1) }),
      mirrors: items.map(li => { const m = li.nextElementSibling; const own = li.querySelector(':scope > .ltx_tag.axt-t'); return own ? x(own) : m?.classList.contains('axt-mirror') ? x(m.querySelector('.ltx_tag')) : null }),
    }
  })
  const same = xs => xs.every(v => v !== null && Math.abs(v - xs[0]) <= 1)
  check('Definition 1.2: the formula-only first item\'s marker, body and right-column marker line up with its siblings',
    same(list.tags) && same(list.texts) && same(list.mirrors),
    `markers ${list.tags.join('/')}, body ${list.texts.join('/')}, right-column markers ${list.mirrors.join('/')}`)
  // A wide marker must not cover the body: swap the first item's marker for a long label like \item[(Assumption 1)] and measure again (Codex on #40)
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
  check('a wide marker ((Assumption 1)) neither covers the body nor sticks out of the block', wide.tagR <= wide.textL + 1 && wide.tagL >= wide.itemL - 1 && wide.textL <= wide.itemR,
    `marker ${wide.tagL}–${wide.tagR}, body start ${wide.textL}, block ${wide.itemL}–${wide.itemR}`)
  // Inline short headings (§7.3, issue #68): the inline-block of `[data-axt-inline]` is not limited by mode, and Codex worried that under side
  // the source and the translation would squeeze into one column. Grid items are blockified, so that rule is void under side anyway — measured here to keep it so
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
  check('an inline short heading is flattened by the grid under side: display is block, source in the left column, translation in the right, same row (issue #68)',
    inline.rows.length >= 3 && inlineBad.length === 0,
    `${inline.rows.length - inlineBad.length}/${inline.rows.length} pairs${inlineBad.length ? `; anomaly ${JSON.stringify(inlineBad[0])}` : ''}`)
  await page.screenshot({ path: `${SHOTS}/layout-definition.png` })
  await page.close()
}

// ── Paper 2: 2609.03768v1 (Table 1 inside a single-column flex figure) ──
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
  check('Table 1: the source and translated tables on one row in the two columns; the note under the table likewise', sideBySide(tbl.table, tbl.mid) && sideBySide(tbl.note, tbl.mid),
    `table ${JSON.stringify(tbl.table)}, note ${JSON.stringify(tbl.note)}, midline ${tbl.mid}`)
  await page.screenshot({ path: `${SHOTS}/layout-table.png` })
  await page.close()
}

// ── Paper 3: 2606.07636v2 (all 5 tables wrapped in \resizebox; the reader reported “tables crossing the divider”) ──
{
  const page = await openSide('2606.07636v2')
  // The five tables are spread across the paper: translation is by viewport, so each has to be scrolled to before it translates, or only the first is measured
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
      // LaTeXML's \resizebox wrapper carries .ltx_inline-block and was once excluded from pairing as an inline context:
      // the two tables became inline-tables, centred in one row inside the full-width shell, straddling the divider
      rows.push({ id: orig.id, fit: orig.getAttribute('data-axt-fit'), ok: a.l >= -1 && a.r <= col + 1 && b.l >= col + gap - 1 && b.r <= 2 * col + gap + 1, a, b })
    }
    return { col, gap, rows }
  })
  const bad = tables.rows.filter(t => !t.ok)
  check('\\resizebox wrapped tables: source in the left column, translation in the right, neither crossing',
    tables.rows.length === 5 && bad.length === 0,
    `${tables.rows.length - bad.length}/${tables.rows.length} pairs; column ${tables.col}${bad.length ? `; crossing ${bad.map(t => `${t.id} ${t.a.l}–${t.a.r} / ${t.b.l}–${t.b.r}`).join(', ')}` : ''}`)
  // Two footnotes in one paragraph (§7.2). Both halves of the contract at once: the boxes stay
  // zero-height, so no note can size the grid row (#154's 1300px blank, and the 1442px one a
  // height-restoring fix brought back on 2609.10326v1), and margin-notes.ts has still pushed the
  // second clear of the first, so neither draws on top of the other (2509.10652v3, both 2026-09-11)
  // Wide enough for the gutter: below 96rem ar5iv folds its margin notes away into hover popovers
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.evaluate(() => document.querySelector('#S2\\.p2\\.1')?.scrollIntoView({ block: 'center' }))
  await quiesce(page, 'S2.p2.1')
  const stacked = await page.evaluate(() => {
    const source = document.querySelector('#S2\\.p2\\.1')
    const pair = [source, source?.nextElementSibling].filter(el => el?.classList.contains('ltx_p') || el?.classList.contains('axt-t'))
    const boxes = pair.flatMap(el => [...el.querySelectorAll('.ltx_note:not(.ltx_note_frontmatter) > .ltx_note_outer')])
      .filter(el => el.checkVisibility())
      .map(el => {
        // What the note actually paints: the box is zero-height on purpose, so the text spills out
        // of it — the span that must not collide with the next note is the content's, not the box's
        const c = el.querySelector('.ltx_note_content').getBoundingClientRect()
        // The box is 2rem of ar5iv's padding around a zero content height, whatever the note says —
        // that is what keeps it out of the grid row's sizing
        return { t: Math.round(c.top), b: Math.round(c.bottom), box: Math.round(el.getBoundingClientRect().height) }
      })
      .sort((a, b) => a.t - b.t)
    return { notes: pair.flatMap(el => [...el.querySelectorAll('.ltx_note:not(.ltx_note_frontmatter)')]).length, boxes }
  })
  const [first, second] = stacked.boxes
  check('two footnotes in one paragraph: zero-height boxes (no grid row grows), stacked clear of each other',
    stacked.notes === 4 && stacked.boxes.length === 2 && stacked.boxes.every(b => b.box < b.b - b.t) && second.t >= first.b,
    `${stacked.notes} notes, ${stacked.boxes.length} painted, ${stacked.boxes.map(b => `${b.t}–${b.b} in a ${b.box}px box`).join(' / ')}`)
  await page.screenshot({ path: `${SHOTS}/layout-margin-notes.png` })
  await page.close()
}

// ── Paper 4: 2312.17141 (multi-panel flex figures stay side by side; body footnote copies in the right gutter) ──
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
  check('a multi-panel flex figure: still flex, the first two panels side by side on one row, no mirror inside the cells',
    // side by side = vertical overlap, horizontal offset (the panels differ in height, so the top edges need not align)
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
  // The baseline before the width change: longest 175ms, 625ms in all (same paper, same three screens scrolled); the budget leaves a 2× margin
  check('no long-task jank on the main thread (side prep measures widths read-only)', tasks.max <= 400 && tasks.total <= 1500,
    `longest ${tasks.max} ms, ${tasks.total} ms in all, ${tasks.n} tasks; ${tasks.eqn} formula tables`)
  check('body footnote: the translation copy floats from the right column into the right gutter, the original hidden',
    note.which === 'copy' && note.origHidden && note.l >= note.artR - 4 && note.r <= note.vw + 1,
    `${note.which}, original hidden ${note.origHidden}, ${note.l}–${note.r}, article right edge ${note.artR}`)
  await page.screenshot({ path: `${SHOTS}/layout-footnote.png` })

  // The convergence check of incremental tidying (issue #46): once the whole paper is settled, every source / translation pair has equal top margins,
  // and every figure with a real translation and loose media is split. A hole in the touch-only-changed-areas invalidation shows here —
  // record it then, rather than papering over it with “a full pass as a fallback”
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
  check('converged after settling: every pair\'s margins equal, every figure due for a split is split (incremental tidying missed no area)',
    c1.pairs > 0 && c1.misaligned === 0 && c1.figures > 0 && c1.unsplit === 0,
    `${c1.pairs} pairs, ${c1.misaligned} misaligned; ${c1.figures} figures, ${c1.unsplit} unsplit; ${c1.mirrors} mirrors`)

  // side → stack → side: the alignment margins are cleared on leaving and must be fully recomputed on return; the mirrors stay in the DOM and their count must not change
  {
    const popup = await context.newPage()
    await popup.goto(`chrome-extension://${extId}/popup.html`)
    await page.bringToFront()
    await popup.getByRole('button', { name: '上下', exact: true }).waitFor({ timeout: 10_000 })
    await popup.getByRole('button', { name: '上下', exact: true }).click()
    await sleep(600)
    await popup.getByRole('button', { name: '左右', exact: true }).click()
    await popup.close()
    await sleep(1500)
    const c2 = await converge()
    // The pair count can only grow: switching to stack reflows the page, blocks that were beyond the preload distance enter the margin, and the observer asks for a few more
    check('after side → stack → side the mirror count is unchanged and the pairs still aligned',
      c2.mirrors === c1.mirrors && c2.misaligned === 0 && c2.pairs >= c1.pairs,
      `mirrors ${c1.mirrors} → ${c2.mirrors}, pairs ${c1.pairs} → ${c2.pairs}, misaligned ${c2.misaligned}`)
  }

  // The tidying cost (the metric of issue #46): prep prints one line per pass with the timing of each stage; summed here
  const prepLines = page.axtLogs.filter(l => l.includes('[axt] side prep'))
  const stage = k => +prepLines.reduce((n, l) => n + (Number(l.match(new RegExp(`${k}=([\\d.]+)`))?.[1]) || 0), 0).toFixed(1)
  const cost = { runs: prepLines.length, notes: stage('notes'), split: stage('split'), mirrors: stage('mirrors'), tables: stage('tables'), margins: stage('margins'), total: stage('total') }
  check('tidying cost: prep totals no more than 600 ms (baseline 1912 ms over 31 passes; the target of #46 < 400)',
    cost.runs > 0 && cost.total < 600,
    JSON.stringify(cost))
  await page.close()
}

// ── The band below the gutter (1280–1535px): frontmatter acknowledgement / corresponding-author notes pair left and right too ──────────
// side applies from ≥1280px, the gutter rule from ≥96rem (1536px), and the band between falls under neither: ar5iv leaves that note in the body flow
// with a hard-coded 800px width, so it overflows the article sideways and the translation stacks right under the source, looking as if it fell into the left column (reader's report, 2026-09-06)
{
  const page = await openSide('2609.04169v1')
  await quiesce(page, 'frontmatter footnote below the gutter')
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
    check(`${vw}px (below the gutter): the frontmatter footnote's source and translation in the two columns, not overflowing the article`,
      !!m && m.orig.r <= m.mid && m.trans.l >= m.mid && m.outer.r <= m.art.r + 1,
      m ? `source ${m.orig.l}–${m.orig.r}, translation ${m.trans.l}–${m.trans.r}, midline ${m.mid}, article right edge ${m.art.r}, note box right edge ${m.outer.r}` : 'frontmatter footnote or its translation not found')
  }
  // The gutter band (≥96rem): a frontmatter note with a translation also returns to the article column in two columns, no longer squeezed into the 192px gutter.
  // In the gutter ar5iv positions them absolutely at a fixed rhythm of 160px per author, with the height computed for the source alone —
  // with the translation inside each grows from 26–50px to 148–194px, and neighbours press letters into each other (measured: 1 overlapping pair at 1800px)
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
  check('1800px (the gutter band): frontmatter footnotes pair left and right too, and do not overlap each other',
    wide.overlaps === 0 && wide.orig.r <= wide.mid && wide.trans.l >= wide.mid,
    `${wide.count} notes, ${wide.overlaps} overlapping pairs; source ${wide.orig.l}–${wide.orig.r}, translation ${wide.trans.l}–${wide.trans.r}, midline ${wide.mid}`)
  await page.screenshot({ path: `${SHOTS}/layout-frontmatter-note.png` })
  await page.close()
}

// ── The grid disables margin collapsing: block spacing must not grow because side is on (reader's report, 2026-09-06) ──────
// Under side .ltx_document is the grid container (the two column lines are defined once, on it), and a grid disables margin collapsing
// between children. arXiv puts two zero-height .ltx_pagination between the abstract and the body, each with a 32px top margin:
// in block layout they collapse with the abstract's bottom margin into one, in the grid each adds up. Measured on 2609.03001v1: 32px → 96px
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
  await quiesce(translated, 'the gap between abstract and body')
  await translated.setViewportSize({ width: 1800, height: 900 })
  await sleep(800)
  const after = await translated.evaluate(() => {
    const abs = document.querySelector('.ltx_abstract')
    const sec = document.querySelector('article.ltx_document > section')
    return {
      gap: Math.round(sec.getBoundingClientRect().top - abs.getBoundingClientRect().bottom),
      // The abstract block's bottom should touch **the taller of the last row**: the grid does not collapse margins with its children,
      // and the last row's bottom margin shows as real blank space (Chinese is shorter than English, so the translation column alone is not enough)
      tail: Math.round(abs.getBoundingClientRect().bottom - Math.max(...[...abs.children].map(el => el.getBoundingClientRect().bottom))),
      translated: document.querySelectorAll('.ltx_abstract .axt-t').length,
    }
  })
  check('side mode did not widen the gap between abstract and body (the grid disables margin collapsing)',
    after.translated > 0 && after.gap === before && after.tail <= 1,
    `untranslated ${before}px, side ${after.gap}px; abstract block bottom vs last paragraph bottom ${after.tail}px apart; ${after.translated} translation nodes in the abstract`)
  await translated.close()
}

// issue #67: a mirror (the right column's visual counterweight copy) must not land on a translation unit. createMirrors cannot tell
// “a block not yet marked” from “static content that will never have a translation”, and with incomplete marks a whole .ltx_para / .ltx_proof
// is cloned into the right column, and once the blocks inside translate there is a whole extra passage of English.
//
// **This assertion cannot be moved today**: with the marking changed back to slices it still passes. Measured: marking 828 blocks takes 2 ms,
// while the first prep pass runs only after 1140 ms (150 ms debounce), a window 570 times apart, and that path is out of reach.
// It stays to guard the result, not the path — whenever, for whatever reason, whole-block clones appear in the right column, it speaks.
// What is really sensitive to the marking method is tests/pipeline/marking.test.ts
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
  check('side mode\'s mirrors do not land on translation units (no whole-block clone of the source in the right column)',
    dup.mirrors > 0 && dup.translations > 0 && dup.clonedCount === 0,
    `${dup.mirrors} mirrors, ${dup.translations} translations, ${dup.clonedCount} whole-block clones${dup.cloned.length ? `: ${dup.cloned.join(', ')}` : ''}`)
  await page.close()
}

// The observer's ratio points must cover the clamped threshold (issue #32 / #76). happy-dom's fake observer calls back directly
// and cannot reproduce the browser's hard constraint of notifying **only when a registered value is crossed**; only real Chromium can verify it.
// No extension and no translation here, pure semantics: for a block taller than the root, whose ratio cap is below the threshold,
// which registration receives the “cap reached” callback
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
  // The element is 3000px, the root 900px: the ratio can reach 0.3 at most
  const CAP = 0.3
  const coarse = await probe([0, 1])                                        // the old form
  const grid = await probe(Array.from({ length: 21 }, (_, i) => i / 20))    // the values of observerThresholds(t>0)
  check('the observer\'s ratio points cover a huge block\'s reachable cap (the fine grid, issue #76)',
    coarse < CAP && grid >= CAP,
    `element 3000px / root 900px, cap ${CAP}; registering [0,1] reaches ${coarse} at most, the fine grid ${grid}`)

  // With the cap between two grid points (2700px / 900px = 0.3333, grid 0.30 / 0.35), a slow scroll only gets
  // the callback crossing 0.30; comparing against the exact cap never passes, so the verdict must be aligned to the grid (issue #81)
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
  check('with the cap between grid points the verdict has to align to the grid to receive that callback (issue #81)',
    slowMax < exactCap - 1e-6 && slowMax >= quantized - 1e-6,
    `exact cap ${exactCap.toFixed(4)}, the largest ratio a slow scroll got ${slowMax.toFixed(6)}; the aligned threshold ${quantized.toFixed(2)}`)
  await page.close()
}

await context.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
