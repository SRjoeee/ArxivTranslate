// The A/B accessibility audit (issue #72, DESIGN §7.4b): axe runs twice on the same paper — without the extension as the baseline, with it as the treatment,
// reporting only what is “added once the extension is installed”. The absolute score is arXiv's, which we cannot and should not change (§7.4b: fixing the host page's
// heading levels / landmarks / table headers means rewriting the original document subtree, a direct breach of the DOM invariant of §7.1), so the gate looks at the difference only.
//
// Why this is automated: a colleague's earlier audit charged four of arXiv / LaTeXML's own problems to the extension,
// and only a manual comparison against “the same page without the extension” sorted out who owned what. Auditing any injecting extension repeats that confusion.
//
// Usage: pnpm build && pnpm e2e:a11y   (first time: npx playwright install chromium)
// Environment: AXT_PAPER picks the paper; AXT_HEADED=1 watches it run.
// Changing the paper is worth a run: 2401.00596 (references with links + unlabelled <object>) is what caught the mirror missing inert in the first place.
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
/** The one §7.4b measured by hand back then: 1 h6, 1 h5, 0 main, 8 of 12 tables without th */
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
const PAPER_URL = `https://arxiv.org/html/${PAPER}`
const IDLE = /session idle: (\d+)\/(\d+) requested of (\d+), (\d+) failed, (\d+) cached/
const LAUNCH = { channel: 'chromium', headless: !process.env.AXT_HEADED, viewport: { width: 1440, height: 900 } }

/**
 * Document-level rules: **which** element they hit depends on the sibling structure — for a rule like “page content is not wrapped in a landmark”, axe reports
 * the outermost element outside a landmark, and inserting our translation makes it report a different element, so a per-element difference is a certain false positive.
 * These are compared only as “did the rule appear in the baseline”: the root cause is the host page having no landmark at all (§7.4b measured main = 0),
 * and adding a landmark to somebody else's page means rewriting the original document subtree, which §7.1 forbids. A new rule absent from the baseline is still reported.
 */
const DOCUMENT_RULES = new Set([
  'region', 'landmark-one-main', 'landmark-unique', 'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-banner', 'landmark-complementary-is-top-level', 'landmark-banner-is-top-level',
  'landmark-contentinfo-is-top-level', 'page-has-heading-one', 'bypass',
])

/**
 * Rules whose axe criterion has drifted from real browser behaviour: not excused by version number, but **measured one by one in the browser running this round**,
 * and one that fails is still a failure (Codex on #99: an unconditional excuse gives a green light on a browser without that behaviour).
 *
 * - `scrollable-region-focusable`: axe checks whether the scroll container has a `tabindex`. Since 127 Chrome gives
 *   “a scroll container without focusable children” sequential focus built in, and the manifest's `minimum_chrome_version` is 131
 *   (required by §15.2's anchor positioning), so every Chrome that can install this extension is in range. Verified here one by one with the round trip:
 *   focus → Shift+Tab back to the previous → Tab should return to it; only if it returns is it really in sequential focus.
 *   The other half of the reason: even to add `tabindex` as axe says, half of side mode's scroll containers are **original nodes**
 *   (`#alg1.4`, `#S2.T1.2`, `#S2.F2`), and adding an attribute to them would breach the DOM invariant of §7.1.
 */
const VERIFY_KEYBOARD = new Set(['scrollable-region-focusable'])

/** Round-trip measurement of keyboard reachability: focus → Shift+Tab → Tab returns, only then is it in sequential focus */
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

/** axe's result flattened into “this node broke this rule” entries */
const flatten = result => result.violations.flatMap(v =>
  v.nodes.map(n => ({ rule: v.id, impact: v.impact ?? '', target: n.target, html: (n.html ?? '').replace(/\s+/g, ' ').slice(0, 140) })))

/**
 * Compute a **key comparable across two runs** for every violation on the page.
 *
 * The selector axe gives cannot be differenced directly (the core difficulty of issue #72): we insert translations as sibling nodes,
 * `:nth-child` shifts wholesale, and the same host-page problem gets a different selector in the two runs — all false positives.
 *
 * The key's algorithm:
 * - A node inside content we injected → follow `data-axt-for` back to the original block it translates and use the **original block's** key.
 *   §7.4b's “bilingual rendering turns 1 h6 into 2” is thereby classed as inherited of itself: the translation's copy maps back to the original block,
 *   whose key the baseline already has. A problem on the translation that the original does not have (a missing lang, insufficient overlay contrast) maps nowhere,
 *   is not found in the baseline → counted as new.
 * - Injected content that maps to no original block (the image overlay, the failure widget) → the key carries an `axt:` prefix, is never in the baseline, and always counts as new.
 * - A host element → its own stable key.
 *
 * The stable key: with an `id`, `#id` (LaTeXML gives most blocks an id like `S1.p1`, so the hit rate is high);
 * without one, walk up to the nearest ancestor with an id, joining tag names and the same-tag sibling index **with `.axt-*` excluded** along the way.
 * Excluding the injected siblings is exactly what makes the indices agree across the two runs.
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
  // The translation is a structural copy of the original block, so “this element inside the translation” has a counterpart in the original:
  // record its path relative to the translation root (tag + same-tag index), then walk the same path down from the original block
  // The index excludes injected siblings on both sides: under stack the original itself gets translations inserted into it (nested blocks, table cells for instance),
  // and without the exclusion the copy's and the original's indices would not agree
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
    // target is an array; more than one entry means it crossed a shadow root (only the failure widget uses shadow, §7.6)
    const [outer] = item.target
    const el = typeof outer === 'string' ? document.querySelector(outer) : null
    if (!el) return { ...item, key: `${item.rule}@?${item.target.join(' ')}`, origin: 'unresolved' }
    const injected = el.closest(INJECTED)
    if (!injected) return { ...item, key: `${item.rule}@${stable(el)}`, origin: 'host' }
    // The nearest anchor that “maps back to the source”: a translation uses data-axt-for, side's split copy data-axt-split-of.
    // The copy's data-axt-for is a synthetic `split:N` pointing at no data-axt-id (Codex on #99) —
    // without recognising data-axt-split-of, the problems inside the copy **inherited from the original** (an unlabelled <object>, say)
    // would be counted as introduced by the extension
    const anchor = el.closest('[data-axt-for], [data-axt-split-of]')
    const forId = anchor?.getAttribute('data-axt-for')
    const splitOf = anchor?.getAttribute('data-axt-split-of')
    const original = forId && !forId.startsWith('split:')
      ? document.querySelector(`[data-axt-id="${CSS.escape(forId)}"]`)
      : splitOf ? document.getElementById(splitOf) : null
    const path = original && anchor ? pathTo(el, anchor) : null
    const counterpart = path ? follow(original, path) : null
    if (counterpart) return { ...item, key: `${item.rule}@${stable(counterpart)}`, origin: splitOf && !counterpart.closest(INJECTED) ? 'split' : 'translation' }
    // Injected content that maps to no source (the image overlay, the failure widget, or a structure not isomorphic to the original) → never in the baseline, counts as new
    return { ...item, key: `${item.rule}@axt:${injected.className}:${stable(injected.parentElement ?? injected)}`, origin: 'injected' }
  })
}

/** Run axe once and convert every violation into a comparable key */
const audit = async page => page.evaluate(KEYED, flatten(await new AxeBuilder({ page }).analyze()))

/**
 * Scroll down screen by screen: jumping to the bottom at once only lets the last screen enter the observer.
 * Every step **re-reads** the document height (Codex on #99): translations are inserted while scrolling, the document keeps growing,
 * and the height from before the scroll as the bound would stop halfway; blocks that never entered the viewport have no pending node, so the settled check still holds,
 * and the lower half of the paper would be skipped silently, out of the audit's reach
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
 * The settled check follows extension.mjs: the last idle line unchanged for 3 seconds in a row, and no pending node on the page.
 * “Is there an idle line” alone is not enough (Codex on #99): a timeout exit, or a block failing to translate, also yields a line,
 * and then the page shows rings and error widgets, what is audited is not the translation, and a fine empty difference is reported.
 * So all three must hold: really settled, every requested block done, zero failures
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

// ── The baseline: the same paper, no extension ────────────────────────────────
const baseContext = await chromium.launchPersistentContext(BASE_PROFILE, LAUNCH)
const basePage = await baseContext.newPage()
await basePage.goto(PAPER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await sleep(2_000) // let arXiv's own scripts (theme, ToC, reading mode) finish before auditing
const baseline = await audit(basePage)
await basePage.screenshot({ path: `${SHOTS}/a11y-baseline.png` })
await baseContext.close()

const baseKeys = new Set(baseline.map(i => i.key))
const baseRuleSet = new Set(baseline.map(i => i.rule))
const baseRules = [...baseRuleSet].sort()
// The baseline itself must find something: none at all most likely means axe did not run, and “the difference is empty” would be an empty assertion
check('the baseline (no extension) really finds the host page\'s own problems', baseline.length > 0,
  `${baseline.length} violations, ${baseRules.length} rules: ${baseRules.join(' / ')}`)

// ── The treatment: with the extension, one audit per mode ────────────────────────────────
const context = await chromium.launchPersistentContext(PROFILE, {
  ...LAUNCH,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})

// Navigation to a real paper gets ample time: Playwright's default is 30 s, and arXiv slows down markedly after dozens of consecutive runs
// (measured: curl on the same paper took 26 s). No assertion's own wait is loosened; only the “get the page” step is
context.setDefaultNavigationTimeout(90_000)
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]

const options = await openOptions(context, extId)
await chooseBuiltIn(options, 'Google 翻译') // the free service, costs nothing
await options.close()

const logs = []
const page = await context.newPage()
page.on('console', m => { if (m.text().includes('[axt]')) logs.push(m.text()) })
await page.goto(`${PAPER_URL}#axt-translate`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
// Scroll the whole paper: translating the first screen only, the audit would miss most of the body (the loading model of §10)
await scrollThrough(page)
const settled = await waitSettled(page, logs)
check('audit after the whole paper is translated: settled, every requested block done, zero failures', settled.ok,
  `${settled.idle ? `${settled.idle.requested}/${settled.idle.total} blocks requested; ` : ''}${settled.text}`)

// The popup takes the status from the **active tab**: with the paper page not in front it renders another UI, and the mode buttons never appear.
// So after goto the paper page must be brought to the front before waiting for the buttons, and the popup must never be brought to the front (the order image.mjs uses)
const popupUrl = `chrome-extension://${extId}/popup.html`

for (const [label, button] of [['stack', '上下'], ['side', '左右'], ['only', '仅译文']]) {
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await page.bringToFront()
  const control = popup.getByRole('button', { name: button, exact: true })
  await control.waitFor({ timeout: 10_000 })
  await control.click()
  await popup.close()
  await sleep(2_000) // side splits figures and mirrors; give the layout a moment to settle
  const withExt = await audit(page)
  const isNew = i => (DOCUMENT_RULES.has(i.rule) ? !baseRuleSet.has(i.rule) : !baseKeys.has(i.key))
  const candidates = withExt.filter(i => isNew(i) && VERIFY_KEYBOARD.has(i.rule))
  const reachable = await keyboardReachable(page, candidates.map(i => i.target[0]))
  const excused = candidates.filter((_, n) => reachable[n])
  const introduced = [
    ...withExt.filter(i => isNew(i) && !VERIFY_KEYBOARD.has(i.rule)),
    ...candidates.filter((_, n) => !reachable[n]), // measured as unreachable by keyboard: not excused
  ]
  await page.screenshot({ path: `${SHOTS}/a11y-${label}.png` })
  const byRule = [...new Set(introduced.map(i => i.rule))].sort()
  const tail = excused.length > 0 ? `; ${excused.length} more of ${[...new Set(excused.map(i => i.rule))].join(' / ')} measured keyboard-reachable on the spot and excused` : ''
  check(`${label} mode: no accessibility problem introduced by the extension`, introduced.length === 0,
    (introduced.length === 0
      ? `${withExt.length} in all, every one already in the baseline (the host page's own)`
      : `${introduced.length} new, ${byRule.length} rules: ${byRule.join(' / ')}`) + tail)
  const show = (items, mark) => {
    for (const item of items.slice(0, 12)) {
      console.log(`    ${mark} ${item.impact.padEnd(8)} ${item.rule}  [${item.origin}]  ${item.key}`)
      console.log(`               ${item.html}`)
    }
    if (items.length > 12) console.log(`    … ${items.length - 12} more`)
  }
  show(introduced, '✗')
  show(excused, '·') // the excused are printed too, so they cannot grow quietly
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
