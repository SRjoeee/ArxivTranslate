// 真实浏览器的 side 模式布局断言（DESIGN §7.2 宽度契约、§11）：happy-dom 没有布局引擎，
// 列宽、浮动的边注、列表标记槽、flex 图的配对只能在 Chromium 里量。与 extension.mjs 同一套启动方式，
// 用 google-web 引擎，不碰用户浏览器与 key。
//
// 用法：pnpm build && pnpm e2e:layout        （首次先 npx playwright install chromium）
// 环境变量：AXT_HEADED=1 看着跑。
import { mkdirSync, rmSync } from 'node:fs'
import { chromium } from 'playwright'

const HERE = new URL('.', import.meta.url).pathname
const EXT = process.env.AXT_EXT_DIR ?? new URL('../../.output/chrome-mv3', import.meta.url).pathname
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
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
await options.close()

/** 打开论文，经 popup 选左右模式并开始翻译 */
async function openSide(id) {
  const page = await context.newPage()
  await page.goto(`https://arxiv.org/html/${id}`, { waitUntil: 'domcontentloaded' })
  const popup = await context.newPage()
  await popup.goto(`chrome-extension://${extId}/popup.html`)
  await page.bringToFront()
  await popup.getByRole('button', { name: '左右', exact: true }).waitFor({ timeout: 10_000 })
  await popup.getByRole('button', { name: '左右', exact: true }).click()
  await sleep(300)
  await popup.getByRole('button', { name: '翻译', exact: true }).click()
  await sleep(500)
  await popup.close()
  return page
}

/** 等视口附近的块都翻完（没有 pending 节点且连续两次不变） */
async function quiesce(page) {
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    if (i > 2 && (await page.evaluate(() => document.querySelectorAll('.axt-pending').length)) === 0) return
  }
}

const rectOf = el => { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), w: Math.round(r.width), t: Math.round(r.top) } }

/** 宽度契约：导航、两栏、右侧沟槽、不溢出 */
async function measureFrame(page) {
  return page.evaluate(rectSrc => {
    const rectOf = new Function('el', `return (${rectSrc})(el)`)
    const art = rectOf(document.querySelector('.ltx_page_main'))
    const nav = rectOf(document.querySelector('.ltx_page_navbar'))
    const paragraphs = [...document.querySelectorAll('.ltx_document .ltx_para > .ltx_p[data-axt-state="translated"]')]
    const p = paragraphs[2] ?? paragraphs[0]
    const t = p?.nextElementSibling?.classList.contains('axt-t') ? p.nextElementSibling : null
    const asides = [...document.querySelectorAll('.ltx_note_outer, .ltx_pubnotes_content, .ltx_role_thanks')]
      .filter(el => { const b = el.getBoundingClientRect(); const c = getComputedStyle(el); return b.width > 0 && c.display !== 'none' && c.opacity !== '0' })
      .map(el => ({ ...rectOf(el), inGutter: el.getBoundingClientRect().left >= art.r - 4 && el.getBoundingClientRect().right <= innerWidth + 1 }))
    return { vw: innerWidth, scrollW: document.documentElement.scrollWidth, nav, art, col: p && t ? [rectOf(p).w, rectOf(t).w] : null, asides }
  }, rectOf.toString())
}

// ── 论文 1：2609.04056v1（致谢块在右侧沟槽；Definition 1.2 有只含公式的列表项）──
{
  const page = await openSide('2609.04056v1')
  await quiesce(page)
  for (const vw of [1440, 2000]) {
    await page.setViewportSize({ width: vw, height: 900 })
    await sleep(400)
    const m = await measureFrame(page)
    // 主内容优先、两侧对称（§7.2）：文章居中，目录列与右侧沟槽等宽，两栏等宽且在 28–40rem 之间
    const centered = Math.abs((m.art.l - 0) - (m.vw - m.art.r)) <= 2
    check(`${vw}px：不横向溢出、文章居中、两侧对称、两栏等宽且 ≤ 40rem`,
      m.scrollW <= m.vw && centered && m.nav.w >= 8 * REM && m.col !== null && Math.abs(m.col[0] - m.col[1]) <= 2 && m.col[0] >= 27 * REM && m.col[0] <= 40 * REM,
      `scrollW ${m.scrollW}/${m.vw}，左 ${m.art.l} / 右 ${m.vw - m.art.r}，导航 ${m.nav.w}，文章 ${m.art.w}，两栏 ${m.col?.join(' / ')}`)
    if (vw >= 96 * REM) {
      check(`${vw}px：右侧沟槽元素落在 [文章右缘, 视口] 内`, m.asides.length > 0 && m.asides.every(a => a.inGutter),
        `${m.asides.length} 个：${m.asides.slice(0, 3).map(a => `${a.l}–${a.r}`).join('，')}；文章右缘 ${m.art.r}`)
    }
    // 行间公式不能换行，宽过一栏的要按档缩放或栏内滚动（§7.2）：量所有配对了镜像的公式表，没有一张比栏宽
    await page.evaluate(() => document.getElementById('S1.SS4')?.scrollIntoView({ block: 'start' }))
    await quiesce(page)
    await sleep(1500) // side prep 的合并器最长等 1s
    const eqn = await page.evaluate(() => {
      const root = document.querySelector('.ltx_document')
      const column = Number.parseFloat(getComputedStyle(root).gridTemplateColumns.split(' ')[0])
      const tables = [...root.querySelectorAll('table.ltx_eqn_table')].filter(t => t.nextElementSibling?.classList.contains('axt-mirror') || t.classList.contains('axt-mirror'))
      const wide = tables.map(t => ({ w: Math.round(t.getBoundingClientRect().width), fit: t.dataset.axtFit ?? null })).filter(x => x.w > column + 1)
      return { column: Math.round(column), total: tables.length, fitted: tables.filter(t => t.dataset.axtFit).length, wide }
    })
    check(`${vw}px：行间公式装进一栏（配对的公式表没有一张宽过栏宽）`, eqn.total > 0 && eqn.wide.length === 0,
      `栏宽 ${eqn.column}，公式表 ${eqn.total} 张、缩放 / 滚动 ${eqn.fitted} 张，超宽 ${JSON.stringify(eqn.wide.slice(0, 3))}`)
    await page.screenshot({ path: `${SHOTS}/layout-2609.04056-${vw}.png` })
  }

  await page.evaluate(() => document.getElementById('S1.Thmproposition2')?.scrollIntoView({ block: 'center' }))
  await quiesce(page)
  const list = await page.evaluate(() => {
    const items = ['S1.I1.i1', 'S1.I1.i2', 'S1.I1.i3'].map(id => document.getElementById(id))
    const x = el => Math.round(el.getBoundingClientRect().left)
    return {
      tags: items.map(li => x(li.querySelector(':scope > .ltx_tag'))),
      // 正文起点量内容而不是盒子：未配对项的 p 在 li 的内边距里、配对项的 p 自带内边距，盒子不可比
      texts: items.map(li => { const range = document.createRange(); range.selectNodeContents(li.querySelector('.ltx_p')); return Math.round(range.getClientRects()[0]?.left ?? -1) }),
      mirrors: items.map(li => { const m = li.nextElementSibling; const own = li.querySelector(':scope > .ltx_tag.axt-t'); return own ? x(own) : m?.classList.contains('axt-mirror') ? x(m.querySelector('.ltx_tag')) : null }),
    }
  })
  const same = xs => xs.every(v => v !== null && Math.abs(v - xs[0]) <= 1)
  check('Definition 1.2：只含公式的第一项与兄弟项标记对齐、正文对齐、右栏标记对齐',
    same(list.tags) && same(list.texts) && same(list.mirrors),
    `标记 ${list.tags.join('/')}，正文 ${list.texts.join('/')}，右栏标记 ${list.mirrors.join('/')}`)
  await page.screenshot({ path: `${SHOTS}/layout-definition.png` })
  await page.close()
}

// ── 论文 2：2609.03768v1（Table 1 在单列 flex 图里）──
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
  check('Table 1：原表与译表同一行、分居两栏；表下脚注同样', sideBySide(tbl.table, tbl.mid) && sideBySide(tbl.note, tbl.mid),
    `表 ${JSON.stringify(tbl.table)}，脚注 ${JSON.stringify(tbl.note)}，中线 ${tbl.mid}`)
  await page.screenshot({ path: `${SHOTS}/layout-table.png` })
  await page.close()
}

// ── 论文 3：2312.17141（多面板 flex 图仍并排；正文脚注副本在右侧沟槽）──
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
  check('多面板 flex 图：仍是 flex，前两个面板同一行并排，格内没有镜像',
    // 并排 = 纵向有重叠、横向错开（面板高矮不一，顶边不必齐）
    panels.display === 'flex' && panels.cells.length === 2 && panels.cells[1].t < panels.cells[0].b && panels.cells[0].t < panels.cells[1].b && panels.cells[1].l > panels.cells[0].l + 50 && panels.mirrors === 0,
    `${panels.display}，面板 ${JSON.stringify(panels.cells)}，镜像 ${panels.mirrors}`)

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
  check('正文脚注：译文副本从右栏起浮、落在右侧沟槽里，原件隐藏',
    note.which === 'copy' && note.origHidden && note.l >= note.artR - 4 && note.r <= note.vw + 1,
    `${note.which}，原件隐藏 ${note.origHidden}，${note.l}–${note.r}，文章右缘 ${note.artR}`)
  await page.screenshot({ path: `${SHOTS}/layout-footnote.png` })
  await page.close()
}

await context.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
