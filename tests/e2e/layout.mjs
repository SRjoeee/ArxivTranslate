// 真实浏览器的 side 模式布局断言（DESIGN §7.2 宽度契约、§11）：happy-dom 没有布局引擎，
// 列宽、浮动的边注、列表标记槽、flex 图的配对只能在 Chromium 里量。与 extension.mjs 同一套启动方式，
// 用 google-web 引擎，不碰用户浏览器与 key。
//
// 用法：pnpm build && pnpm e2e:layout        （首次先 npx playwright install chromium）
// 环境变量：AXT_HEADED=1 看着跑。
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
// 图片翻译（DESIGN §15）默认三种模式都开；这台机器装了 helper 的话叠加层与拆图会扰动下面的布局 / 计数断言，
// 这里关掉，专门的 e2e:image 再开（AXT_E2E_IMAGES=1 时保留）
if (!process.env.AXT_E2E_IMAGES) {
  for (const name of ['左右对照', '上下对照', '仅译文']) {
    const box = options.getByRole('checkbox', { name, exact: true })
    if (await box.isEnabled()) await box.uncheck()
  }
}
await options.getByRole('button', { name: '保存', exact: true }).click()
await options.getByText('已保存', { exact: true }).waitFor({ timeout: 10_000 })
await options.close()

/** 打开论文，经 popup 选左右模式并开始翻译 */
async function openSide(id) {
  const page = await context.newPage()
  // 扩展的控制台日志：side prep 每趟一行带各阶段耗时，整理成本的断言靠它
  page.axtLogs = []
  page.on('console', message => { const text = message.text(); if (text.includes('[axt]')) page.axtLogs.push(text) })
  // 主线程长任务记下来：side prep 曾经每张公式表克隆一份去量宽度，392 张公式的 2312.17141 上一趟 45 秒、页面无响应
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
  await popup.getByRole('button', { name: '翻译', exact: true }).click()
  await sleep(500)
  await popup.close()
  return page
}

/**
 * 等视口附近的块都翻完再量：要求**连续三次**观察到没有 pending 节点。
 * 单次为零可能只是两批之间的空档，或者块还没标记完（startTranslation 是先异步标记全部块再建观察器），
 * 那时量到的几何会被随后到达的译文改掉，断言与截图都会飘（Codex 在 #40 指出）。超时不静默通过。
 */
async function quiesce(page, label = '') {
  let stable = 0
  for (let i = 0; i < 80; i++) {
    await sleep(500)
    stable = (await page.evaluate(() => document.querySelectorAll('.axt-pending').length)) === 0 ? stable + 1 : 0
    if (stable >= 3 && i >= 5) return
  }
  check(`等待翻译静止${label ? `（${label}）` : ''}`, false, '40 s 内没有连续三次观察到零 pending')
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
    return { vw: innerWidth, scrollW: document.documentElement.scrollWidth, nav, art, col: p && t ? [rectOf(p).w, rectOf(t).w] : null }
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
    // 正文优先、两侧对称（§7.2）：文章居中且吃到 96rem 封顶，两侧同宽且不小于 arXiv 原生下限的可用宽度
    const centered = Math.abs((m.art.l - 0) - (m.vw - m.art.r)) <= 2
    check(`${vw}px：不横向溢出、文章居中、两侧对称、正文吃满（≤ 96rem）、两栏等宽`,
      m.scrollW <= m.vw && centered && m.nav.w >= 13 * REM && m.art.w <= 96 * REM + 2 && m.art.w >= Math.min(96 * REM, m.vw - 2 * 25 * REM)
      && m.col !== null && Math.abs(m.col[0] - m.col[1]) <= 2,
      `scrollW ${m.scrollW}/${m.vw}，左 ${m.art.l} / 右 ${m.vw - m.art.r}，导航 ${m.nav.w}，文章 ${m.art.w}，两栏 ${m.col?.join(' / ')}`)
    // 这里原有一条「右侧沟槽元素落在 [文章右缘, 视口] 内」：本篇的 4 个沟槽元素**全是致谢注**，
    // 而带译文的致谢注 2026-09-06 起按设计回到文章列两栏排（沟槽只有 192px，塞进双语会互相压字），
    // 于是这一篇的沟槽空了、断言没有了对象。沟槽几何改由 2312.17141 那一篇的
    // 「正文脚注：译文副本从右栏起浮、落在右侧沟槽里」断言覆盖——那里有真实的沟槽元素与坐标。
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
  // 宽标记不能盖住正文：把第一项的标记临时换成 \item[(Assumption 1)] 那种长标签再量（Codex 在 #40 指出）
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
  check('宽标记（(Assumption 1)）不盖正文、不伸出块外', wide.tagR <= wide.textL + 1 && wide.tagL >= wide.itemL - 1 && wide.textL <= wide.itemR,
    `标记 ${wide.tagL}–${wide.tagR}，正文起点 ${wide.textL}，块 ${wide.itemL}–${wide.itemR}`)
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
  const tasks = await page.evaluate(() => { const t = window.__axtLongTasks.slice().sort((a, b) => b - a); return { max: t[0] ?? 0, total: t.reduce((a, b) => a + b, 0), n: t.length, eqn: document.querySelectorAll('table.ltx_eqn_table').length } })
  // 改宽度之前的基线：最长 175ms、合计 625ms（同一篇、同样滚三屏）；预算留一倍余量
  check('主线程没有长任务卡顿（side prep 只读量宽度）', tasks.max <= 400 && tasks.total <= 1500,
    `最长 ${tasks.max} ms，合计 ${tasks.total} ms，${tasks.n} 次；公式表 ${tasks.eqn} 张`)
  check('正文脚注：译文副本从右栏起浮、落在右侧沟槽里，原件隐藏',
    note.which === 'copy' && note.origHidden && note.l >= note.artR - 4 && note.r <= note.vw + 1,
    `${note.which}，原件隐藏 ${note.origHidden}，${note.l}–${note.r}，文章右缘 ${note.artR}`)
  await page.screenshot({ path: `${SHOTS}/layout-footnote.png` })

  // 增量整理的收敛检查（issue #46）：整篇静止后，每一对原文 / 译文的上边距相等、
  // 含真译文且有游离媒体的插图都已拆开。只碰变动区域的失效表若有洞，这里会露出来——
  // 那就记录它，不用"兜底跑一次全量"糊过去
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
  check('静止后收敛：配对边距全部相等、该拆的图全拆了（增量整理没有漏区域）',
    c1.pairs > 0 && c1.misaligned === 0 && c1.figures > 0 && c1.unsplit === 0,
    `${c1.pairs} 对、错位 ${c1.misaligned}；${c1.figures} 张图、未拆 ${c1.unsplit}；镜像 ${c1.mirrors}`)

  // side → stack → side：离开时对齐边距被清掉，回来必须全量重算；镜像留在 DOM 里，数量不该变
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
    // 配对数只会增不会减：切到 stack 页面重排，原本在预翻译距离之外的块进了边距，观察器会再要几块
    check('side → stack → side 之后镜像数不变、配对仍对齐',
      c2.mirrors === c1.mirrors && c2.misaligned === 0 && c2.pairs >= c1.pairs,
      `镜像 ${c1.mirrors} → ${c2.mirrors}，配对 ${c1.pairs} → ${c2.pairs}、错位 ${c2.misaligned}`)
  }

  // 整理成本（issue #46 的指标）：prep 每趟都打一行带各阶段耗时的日志，这里把它们加起来
  const prepLines = page.axtLogs.filter(l => l.includes('[axt] side prep'))
  const stage = k => +prepLines.reduce((n, l) => n + (Number(l.match(new RegExp(`${k}=([\\d.]+)`))?.[1]) || 0), 0).toFixed(1)
  const cost = { runs: prepLines.length, notes: stage('notes'), split: stage('split'), mirrors: stage('mirrors'), tables: stage('tables'), margins: stage('margins'), total: stage('total') }
  check('整理成本：prep 累计不超过 600 ms（基线 1912 ms，31 趟；#46 的目标 < 400）',
    cost.runs > 0 && cost.total < 600,
    JSON.stringify(cost))
  await page.close()
}

// ── 沟槽以下那一档（1280–1535px）：frontmatter 的致谢 / 通讯作者注也要左右配对 ──────────
// side 在 ≥1280px 生效，沟槽规则在 ≥96rem(1536px)，中间这段两头不着：ar5iv 把这条注留在正文流里
// 并写死 800px 宽，于是它横着溢出文章、译文堆在原文正下方，看上去像掉进了左栏（用户反馈，2026-09-06）
{
  const page = await openSide('2609.04169v1')
  await quiesce(page, '沟槽以下的 frontmatter 脚注')
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
    check(`${vw}px（沟槽以下）：frontmatter 脚注的原文与译文分居两栏、不溢出文章`,
      !!m && m.orig.r <= m.mid && m.trans.l >= m.mid && m.outer.r <= m.art.r + 1,
      m ? `原文 ${m.orig.l}–${m.orig.r}，译文 ${m.trans.l}–${m.trans.r}，中线 ${m.mid}，文章右缘 ${m.art.r}，注框右缘 ${m.outer.r}` : '没找到 frontmatter 脚注或它的译文')
  }
  // 沟槽档（≥96rem）：带译文的 frontmatter 注也回到文章列按两栏排，不再挤进 192px 的沟槽。
  // 沟槽里 ar5iv 按每位作者 160px 的固定节奏绝对定位它们，高度却是按只有原文算的——
  // 塞进译文后每条从 26–50px 涨到 148–194px，相邻两条互相压字（实测 1800px 有 1 对重叠）
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
    return { 条数: notes.length, overlaps, orig: b(orig), trans: b(trans), mid: Math.round((art.left + art.right) / 2), artR: Math.round(art.right) }
  })
  check('1800px（沟槽档）：frontmatter 脚注也左右配对，且彼此不重叠',
    wide.overlaps === 0 && wide.orig.r <= wide.mid && wide.trans.l >= wide.mid,
    `${wide.条数} 条、重叠 ${wide.overlaps} 对；原文 ${wide.orig.l}–${wide.orig.r}，译文 ${wide.trans.l}–${wide.trans.r}，中线 ${wide.mid}`)
  await page.screenshot({ path: `${SHOTS}/layout-frontmatter-note.png` })
  await page.close()
}

// ── 网格禁用外边距折叠：块间距不能因为开了 side 就被撑大（用户反馈，2026-09-06）──────
// .ltx_document 在 side 模式下是网格容器（两条列线只在它身上定义一次），而网格禁用子元素间的
// 外边距折叠。arXiv 在摘要与正文之间放了两个高度为 0 的 .ltx_pagination，各带 32px 上边距：
// 块布局里它们与摘要的下边距折叠成一段，网格里各自累加。实测 2609.03001v1：32px → 96px
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
  await quiesce(translated, '摘要与正文的间距')
  await translated.setViewportSize({ width: 1800, height: 900 })
  await sleep(800)
  const after = await translated.evaluate(() => {
    const abs = document.querySelector('.ltx_abstract')
    const sec = document.querySelector('article.ltx_document > section')
    return {
      gap: Math.round(sec.getBoundingClientRect().top - abs.getBoundingClientRect().bottom),
      // 摘要块的底边应当贴着**最后一行里较高的那个**：网格不与子元素折叠外边距，
      // 最后一行的下边距会露成实打实的空白（中文比英文短，所以不能只看译文那一列）
      tail: Math.round(abs.getBoundingClientRect().bottom - Math.max(...[...abs.children].map(el => el.getBoundingClientRect().bottom))),
      translated: document.querySelectorAll('.ltx_abstract .axt-t').length,
    }
  })
  check('side 模式没有把摘要与正文之间的间距撑大（网格禁用了外边距折叠）',
    after.translated > 0 && after.gap === before && after.tail <= 1,
    `未翻译 ${before}px，side ${after.gap}px；摘要块底与末段底相差 ${after.tail}px；摘要里有 ${after.translated} 个译文节点`)
  await translated.close()
}

// issue #67：镜像（右栏的视觉配平副本）不能落在翻译单元上。createMirrors 分辨不出
// "还没轮到标记的块"与"永远没有译文的静态内容"，标记若不完整，整个 .ltx_para / .ltx_proof
// 会被克隆到右栏，等里面的块翻出来就多一整段英文。
//
// **这条断言当前撼不动**：把标记改回切片它照样通过。实测 828 块的标记只要 2 ms，
// 而第一趟 prep 在 1140 ms 后才跑（150 ms 去抖），窗口差 570 倍，那条路径够不着。
// 留着它守的是结果而不是路径——不论哪天因为什么原因右栏出现整块克隆，它都会说话。
// 真正对标记方式敏感的是 tests/pipeline/marking.test.ts
{
  const page = await openSide('2312.17141')
  await quiesce(page, '镜像与译文不重叠')
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
  check('side 模式的镜像没有落在翻译单元上（右栏没有整块克隆的原文）',
    dup.mirrors > 0 && dup.translations > 0 && dup.clonedCount === 0,
    `${dup.mirrors} 个镜像、${dup.translations} 个译文，整块克隆 ${dup.clonedCount} 个${dup.cloned.length ? `：${dup.cloned.join('、')}` : ''}`)
  await page.close()
}

// 观察器的比例点必须覆盖钳过的阈值（issue #32 / #76）。happy-dom 的假观察器直接调回调，
// 复现不了浏览器「**只在跨越注册值时**才通知」这条硬约束，只能在真实 Chromium 上验。
// 这里不装扩展、不翻译，纯测语义：一个比 root 还高的块，比例上限低于 threshold 时，
// 用哪种注册方式才收得到「达到上限」的那次回调
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
  // 元素 3000px、root 900px：比例最高只能到 0.3
  const CAP = 0.3
  const coarse = await probe([0, 1])                                        // 旧写法
  const grid = await probe(Array.from({ length: 21 }, (_, i) => i / 20))    // observerThresholds(t>0) 的值
  check('观察器的比例点覆盖得到超大块的可达上限（细网格，issue #76）',
    coarse < CAP && grid >= CAP,
    `元素 3000px / root 900px，上限 ${CAP}；注册 [0,1] 最大只到 ${coarse}，细网格到 ${grid}`)

  // 上限落在两个网格点之间时（2700px / 900px = 0.3333，网格 0.30 / 0.35），慢滚只会拿到
  // 跨越 0.30 的那一次；拿精确上限去比就永远不通过，所以判定必须对齐到网格（issue #81）
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
  check('上限落在网格点之间时，判定对齐到网格才收得到那次回调（issue #81）',
    slowMax < exactCap - 1e-6 && slowMax >= quantized - 1e-6,
    `精确上限 ${exactCap.toFixed(4)}，慢滚拿到的最大 ratio ${slowMax.toFixed(6)}；对齐后的阈值 ${quantized.toFixed(2)}`)
  await page.close()
}

await context.close()
const failed = results.filter(r => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(failed.length ? 1 : 0)
