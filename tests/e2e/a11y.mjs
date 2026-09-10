// A/B 无障碍审计（issue #72，DESIGN §7.4b）：同一篇论文跑两次 axe——不装扩展是基线，装了扩展是对照，
// 只报「装扩展之后新增」的那些。绝对分数由 arXiv 决定，我们改不了也不该改（§7.4b：改宿主页面的
// 标题层级 / 地标 / 表头都要改写原文档子树，直接违反 §7.1 的 DOM 不变量），所以门槛只看差集。
//
// 这件事之所以要自动化：同事上一轮的审计把 arXiv / LaTeXML 自己的四个问题算到了扩展头上，
// 当时是手工对照「不装扩展的同一页面」才分清归属的。审计任何注入型扩展都会重复这场误会。
//
// 用法：pnpm build && pnpm e2e:a11y   （首次先 npx playwright install chromium）
// 环境变量：AXT_PAPER 换论文；AXT_HEADED=1 看着跑。
// 换论文值得跑一跑：2401.00596（参考文献带链接 + 无标签 <object>）当初就是靠它抓到镜像漏标 inert 的。
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'
import { chooseBuiltIn, openOptions } from './options-page.mjs'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile-a11y`
const BASE_PROFILE = `${HERE}.profile-a11y-base`
const SHOTS = `${HERE}.shots`
/** §7.4b 当初手工实测的就是这篇：h6 1 个、h5 1 个、main 0 个、12 张表里 8 张没 th */
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
const PAPER_URL = `https://arxiv.org/html/${PAPER}`
const IDLE = /session idle: (\d+)\/(\d+) requested of (\d+), (\d+) failed, (\d+) cached/
const LAUNCH = { channel: 'chromium', headless: !process.env.AXT_HEADED, viewport: { width: 1440, height: 900 } }

/**
 * 文档级规则：命中**哪个**元素取决于兄弟结构——「页面内容没被 landmark 包住」这类规则，axe 报的是
 * 最外层那个不在 landmark 里的元素，我们往里插译文就会让它换一个元素来报，按元素求差必然误报。
 * 这类只比「基线里这条规则出现过没有」：根因是宿主页面一个 landmark 都没有（§7.4b 实测 main 为 0），
 * 而给别人的页面补 landmark 要改写原文档子树，§7.1 不允许。真出现基线里没有的新规则，照样会报出来。
 */
const DOCUMENT_RULES = new Set([
  'region', 'landmark-one-main', 'landmark-unique', 'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-banner', 'landmark-complementary-is-top-level', 'landmark-banner-is-top-level',
  'landmark-contentinfo-is-top-level', 'page-has-heading-one', 'bypass',
])

/**
 * axe 的判据与浏览器实际行为脱节的规则：不凭版本号豁免，**在跑这一轮的浏览器里逐个实测**，
 * 过不了的照样判失败（Codex 在 #99 指出：无条件豁免会在没有该行为的浏览器上给出绿灯）。
 *
 * - `scrollable-region-focusable`：axe 查的是滚动容器上有没有 `tabindex`。Chrome 从 127 起给
 *   「没有可聚焦子元素的滚动容器」内置了顺序焦点，而 manifest 的 `minimum_chrome_version` 是 131
 *   （§15.2 的锚点定位要求），所有能装上本扩展的 Chrome 都在范围内。这里用往返法逐个验：
 *   聚焦 → Shift+Tab 退到上一个 → Tab 应当回到它，回得来才说明它真在顺序焦点里。
 *   另一半理由是就算想按 axe 说的加 `tabindex`，side 模式那几个滚动容器里有一半是**原节点**
 *   （`#alg1.4`、`#S2.T1.2`、`#S2.F2`），给它们加属性会违反 §7.1 的 DOM 不变量。
 */
const VERIFY_KEYBOARD = new Set(['scrollable-region-focusable'])

/** 往返法实测键盘够不够得到：聚焦 → Shift+Tab → Tab 能回来，才算在顺序焦点里 */
async function keyboardReachable(page, selectors) {
  const out = []
  for (const sel of selectors) {
    const focused = await page.evaluate(s => {
      const el = document.querySelector(s)
      if (!el) return false
      el.scrollIntoView({ block: 'center' })
      el.focus()
      return document.activeElement === el
    }, sel).catch(() => false)
    if (!focused) { out.push(false); continue }
    await page.keyboard.press('Shift+Tab')
    await page.keyboard.press('Tab')
    out.push(await page.evaluate(s => document.activeElement === document.querySelector(s), sel).catch(() => false))
  }
  return out
}

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} — ${detail}`)
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

/** axe 的结果拍平成一条条「某个节点违反了某条规则」 */
const flatten = result => result.violations.flatMap(v =>
  v.nodes.map(n => ({ rule: v.id, impact: v.impact ?? '', target: n.target, html: (n.html ?? '').replace(/\s+/g, ' ').slice(0, 140) })))

/**
 * 在页面里给每条违规算一个**两次运行可比的键**。
 *
 * 不能直接拿 axe 给的选择器求差（issue #72 的核心难点）：我们把译文作为兄弟节点插进去，
 * `:nth-child` 会整体位移，同一个宿主页面的问题在两次运行里选择器就不一样了，全是误报。
 *
 * 键的算法：
 * - 节点落在我们注入的内容里 → 顺着 `data-axt-for` 找回它翻译的那个原块，用**原块**的键。
 *   §7.4b 说的「双语渲染让 h6 从 1 个变 2 个」由此自动归为继承：译文那份映射回原块，
 *   而原块的键基线里已经有了。译文上原块没有的问题（漏标 lang、叠加层对比度不足）则映射不到，
 *   基线里找不到 → 判为新增。
 * - 映射不回原块的注入内容（图片叠加层、失败控件）→ 键带 `axt:` 前缀，基线里必然没有，一律算新增。
 * - 宿主元素 → 用它自己的稳定键。
 *
 * 稳定键：有 `id` 就用 `#id`（LaTeXML 给绝大多数块都发了 `S1.p1` 这类 id，命中率很高）；
 * 没有就往上走到最近一个带 id 的祖先，沿途拼标签名与**排除 `.axt-*` 之后**的同标签兄弟序号。
 * 排除注入的兄弟，正是让两次运行的序号对得上的关键。
 */
const KEYED = items => {
  const INJECTED = '.axt-t, .axt-img, .axt-note-t, .axt-skel'
  const stable = el => {
    const parts = []
    let cur = el
    while (cur?.nodeType === 1 && cur !== document.documentElement) {
      if (cur.id) {
        parts.unshift(`#${cur.id}`)
        return parts.join('>')
      }
      const parent = cur.parentElement
      if (!parent) break
      const tag = cur.tagName.toLowerCase()
      const sibs = [...parent.children].filter(s => !s.matches(INJECTED) && s.tagName === cur.tagName)
      parts.unshift(`${tag}[${sibs.indexOf(cur)}]`)
      cur = parent
    }
    return parts.join('>') || '<root>'
  }
  // 译文是原块的结构副本，所以「译文里的这个元素」在原块里有个对应元素：
  // 记下它相对译文根的路径（标签 + 同标签序号），再拿同一条路径从原块走下去
  // 序号两侧都排除注入的兄弟：原块在 stack 下自己也会被插进译文（嵌套块，例如表格单元格），
  // 不排除的话副本与原件的序号对不上
  const sameTag = (parent, tag) => [...parent.children].filter(s => s.tagName === tag && !s.matches(INJECTED))
  const pathTo = (el, root) => {
    const parts = []
    let cur = el
    while (cur && cur !== root) {
      const parent = cur.parentElement
      if (!parent) return null
      const i = sameTag(parent, cur.tagName).indexOf(cur)
      if (i < 0) return null
      parts.unshift([cur.tagName, i])
      cur = parent
    }
    return cur === root ? parts : null
  }
  const follow = (root, path) => {
    let cur = root
    for (const [tag, i] of path) {
      cur = sameTag(cur, tag)[i]
      if (!cur) return null
    }
    return cur
  }
  return items.map(item => {
    // target 是数组；多于一项说明穿过了 shadow root（只有失败控件用 shadow，§7.6）
    const [outer] = item.target
    const el = typeof outer === 'string' ? document.querySelector(outer) : null
    if (!el) return { ...item, key: `${item.rule}@?${item.target.join(' ')}`, origin: 'unresolved' }
    const injected = el.closest(INJECTED)
    if (!injected) return { ...item, key: `${item.rule}@${stable(el)}`, origin: 'host' }
    // 最近的那个「能对回原文」的锚：译文用 data-axt-for，side 的拆图副本用 data-axt-split-of。
    // 副本的 data-axt-for 是合成的 `split:N`，指不到任何 data-axt-id（Codex 在 #99 指出）——
    // 不认 data-axt-split-of 的话，副本里那些**继承自原件**的问题（例如没标签的 <object>）
    // 会被算成扩展引入的
    const anchor = el.closest('[data-axt-for], [data-axt-split-of]')
    const forId = anchor?.getAttribute('data-axt-for')
    const splitOf = anchor?.getAttribute('data-axt-split-of')
    const original = forId && !forId.startsWith('split:')
      ? document.querySelector(`[data-axt-id="${CSS.escape(forId)}"]`)
      : splitOf ? document.getElementById(splitOf) : null
    const path = original && anchor ? pathTo(el, anchor) : null
    const counterpart = path ? follow(original, path) : null
    if (counterpart) return { ...item, key: `${item.rule}@${stable(counterpart)}`, origin: splitOf && !counterpart.closest(INJECTED) ? 'split' : 'translation' }
    // 对不上原文的注入内容（图片叠加层、失败控件，或结构与原件不同构）→ 基线里必然没有，算新增
    return { ...item, key: `${item.rule}@axt:${injected.className}:${stable(injected.parentElement ?? injected)}`, origin: 'injected' }
  })
}

/** 跑一次 axe，把每条违规都换算成可比的键 */
const audit = async page => page.evaluate(KEYED, flatten(await new AxeBuilder({ page }).analyze()))

/**
 * 逐屏往下滚：一次跳到底只会让最后一屏进入观察器。
 * 每一步都**重读**文档高度（Codex 在 #99 指出）：译文是边滚边插进去的，文档会越滚越长，
 * 拿滚之前那个高度当上界会停在半路；而没进过视口的块不会有 pending 节点，静止判定照样成立，
 * 于是下半篇被悄悄跳过、审计覆盖不到
 */
async function scrollThrough(page) {
  for (let y = 0, guard = 0; guard < 500; guard++, y += 800) {
    const height = await page.evaluate(top => {
      window.scrollTo(0, top)
      return document.documentElement.scrollHeight
    }, y)
    if (y >= height) break
    await sleep(120)
  }
  await page.evaluate(() => window.scrollTo(0, 0))
}

/**
 * 静止的判定照 extension.mjs：最后一条 idle 行连续 3 秒没变，且页面上没有 pending 节点。
 * 光看「有没有 idle 行」不够（Codex 在 #99 指出）：超时退出、或者有块翻失败时也拿得到一行，
 * 那时页面上是圆环与错误控件，审计的就不是译文了，还会报出一个漂亮的空差集。
 * 所以要同时满足：真的稳住了、请求过的块全部完成、零失败
 */
async function waitSettled(page, logs) {
  let last = null
  let stable = 0
  for (let i = 0; i < 90 && stable < 3; i++) {
    await sleep(1_000)
    const line = logs.findLast(l => IDLE.test(l))
    const pending = await page.evaluate(() => document.querySelectorAll('.axt-pending').length)
    stable = line && pending === 0 && line === last ? stable + 1 : 0
    last = line
  }
  const m = last ? IDLE.exec(last) : null
  const idle = m ? { done: +m[1], requested: +m[2], total: +m[3], failed: +m[4] } : null
  const ok = stable >= 3 && !!idle && idle.requested > 0 && idle.done === idle.requested && idle.failed === 0
  return { ok, idle, text: last ?? '(no idle line)' }
}

rmSync(PROFILE, { recursive: true, force: true })
rmSync(BASE_PROFILE, { recursive: true, force: true })
mkdirSync(SHOTS, { recursive: true })

// ── 基线：同一篇，不装扩展 ────────────────────────────────────────────────
const baseContext = await chromium.launchPersistentContext(BASE_PROFILE, LAUNCH)
const basePage = await baseContext.newPage()
await basePage.goto(PAPER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await sleep(2_000) // arXiv 自己的脚本（主题、ToC、阅读模式）跑完再审
const baseline = await audit(basePage)
await basePage.screenshot({ path: `${SHOTS}/a11y-baseline.png` })
await baseContext.close()

const baseKeys = new Set(baseline.map(i => i.key))
const baseRuleSet = new Set(baseline.map(i => i.rule))
const baseRules = [...baseRuleSet].sort()
// 基线本身必须查出东西来：一条都没有多半是 axe 没跑起来，那样"差集为空"就成了空断言
check('基线（不装扩展）确实查出了宿主页面自带的问题', baseline.length > 0,
  `${baseline.length} 条、${baseRules.length} 类：${baseRules.join(' / ')}`)

// ── 对照：装扩展，三种模式各审一次 ────────────────────────────────────────
const context = await chromium.launchPersistentContext(PROFILE, {
  ...LAUNCH,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]

const options = await openOptions(context, extId)
await chooseBuiltIn(options, 'Google 翻译') // 免费服务，不花钱
await options.close()

const logs = []
const page = await context.newPage()
page.on('console', m => { if (m.text().includes('[axt]')) logs.push(m.text()) })
await page.goto(`${PAPER_URL}#axt-translate`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
// 整篇滚一遍：只翻首屏的话，审计覆盖不到正文的绝大部分（§10 的加载模式）
await scrollThrough(page)
const settled = await waitSettled(page, logs)
check('整篇翻完再审计：翻译静止、请求过的块全部完成、零失败', settled.ok,
  `${settled.idle ? `${settled.idle.requested}/${settled.idle.total} 个块请求过；` : ''}${settled.text}`)

// popup 按**活动标签页**取状态：论文页不在前台时它渲染的是另一套 UI，模式按钮根本不出现。
// 所以 goto 之后必须先把论文页提回前台再等按钮，而且全程不能把 popup 提到前台（照 image.mjs 的顺序）
const popupUrl = `chrome-extension://${extId}/popup.html`

for (const [label, button] of [['stack', '上下'], ['side', '左右'], ['only', '仅译文']]) {
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await page.bringToFront()
  const control = popup.getByRole('button', { name: button, exact: true })
  await control.waitFor({ timeout: 10_000 })
  await control.click()
  await popup.close()
  await sleep(2_000) // side 要拆图与镜像，给版式一点时间落定
  const withExt = await audit(page)
  const isNew = i => (DOCUMENT_RULES.has(i.rule) ? !baseRuleSet.has(i.rule) : !baseKeys.has(i.key))
  const candidates = withExt.filter(i => isNew(i) && VERIFY_KEYBOARD.has(i.rule))
  const reachable = await keyboardReachable(page, candidates.map(i => i.target[0]))
  const excused = candidates.filter((_, n) => reachable[n])
  const introduced = [
    ...withExt.filter(i => isNew(i) && !VERIFY_KEYBOARD.has(i.rule)),
    ...candidates.filter((_, n) => !reachable[n]), // 实测键盘够不到的，不豁免
  ]
  await page.screenshot({ path: `${SHOTS}/a11y-${label}.png` })
  const byRule = [...new Set(introduced.map(i => i.rule))].sort()
  const tail = excused.length > 0 ? `；另有 ${excused.length} 条 ${[...new Set(excused.map(i => i.rule))].join(' / ')} 已当场实测键盘够得到、豁免` : ''
  check(`${label} 模式：没有由扩展引入的无障碍问题`, introduced.length === 0,
    (introduced.length === 0
      ? `共 ${withExt.length} 条，全部在基线里已有（宿主页面自带）`
      : `新增 ${introduced.length} 条、${byRule.length} 类：${byRule.join(' / ')}`) + tail)
  const show = (items, mark) => {
    for (const item of items.slice(0, 12)) {
      console.log(`    ${mark} ${item.impact.padEnd(8)} ${item.rule}  [${item.origin}]  ${item.key}`)
      console.log(`               ${item.html}`)
    }
    if (items.length > 12) console.log(`    …… 另有 ${items.length - 12} 条`)
  }
  show(introduced, '✗')
  show(excused, '·') // 豁免的也打出来，免得它悄悄变多
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
