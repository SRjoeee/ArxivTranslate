// A/B accessibility audit (issue #72, DESIGN §7.4b): run axe twice on the same paper, without the extension as baseline and with it as comparison,
// reporting only newly introduced violations. arXiv determines the absolute score; we cannot and should not fix it (§7.4b: changing host-page
// heading levels / landmarks / table headers rewrites the original subtree and violates the §7.1 DOM invariant), so the gate checks only the difference.
//
// Why automate this: a colleague’s previous audit attributed four arXiv / LaTeXML issues to the extension;
// only manual comparison with the same page without the extension established ownership. Any injected-extension audit can repeat this mistake.
//
// Usage: pnpm build && pnpm e2e:a11y (first run: npx playwright install chromium)
// Environment: AXT_PAPER selects a different paper; AXT_HEADED=1 shows the browser.
// Also test 2401.00596 (linked references + unlabeled <object>): it originally exposed missing inert on mirrors.
import { mkdirSync, rmSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import AxeBuilder from '@axe-core/playwright'
import { chromium } from 'playwright'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const EXT = process.env.AXT_EXT_DIR ?? fileURLToPath(new URL('../../.output/chrome-mv3', import.meta.url))
const PROFILE = `${HERE}.profile-a11y`
const BASE_PROFILE = `${HERE}.profile-a11y-base`
const SHOTS = `${HERE}.shots`
/** The original manual §7.4b audit used this paper: one h6, one h5, no main, eight of twelve tables without th */
const PAPER = process.env.AXT_PAPER ?? '2410.00260'
const PAPER_URL = `https://arxiv.org/html/${PAPER}`
const IDLE = /session idle: (\d+)\/(\d+) requested of (\d+), (\d+) failed, (\d+) cached/
const LAUNCH = { channel: 'chromium', headless: !process.env.AXT_HEADED, viewport: { width: 1440, height: 900 } }

/**
 * Document-level rules: the reported element depends on sibling structure. For content outside landmarks, axe reports
 * the outermost element outside a landmark; inserting translations can change which element it reports, making element-level differencing a false positive.
 * Compare only whether the rule existed in the baseline: the root cause is the host page lacking landmarks (§7.4b measured zero main elements),
 * and adding landmarks to someone else’s page would rewrite its subtree, prohibited by §7.1. New rules absent from baseline are still reported.
 */
const DOCUMENT_RULES = new Set([
  'region', 'landmark-one-main', 'landmark-unique', 'landmark-no-duplicate-contentinfo',
  'landmark-no-duplicate-banner', 'landmark-complementary-is-top-level', 'landmark-banner-is-top-level',
  'landmark-contentinfo-is-top-level', 'page-has-heading-one', 'bypass',
])

/**
 * Rules where axe’s heuristic differs from actual browser behavior: never exempt by version alone; **test every element in the browser running this audit**.
 * Fail when the behavior is absent (Codex #99: unconditional exemptions would pass browsers that lack it).
 *
 * - `scrollable-region-focusable`: axe checks scroll containers for `tabindex`. Since Chrome 127,
 *   scroll containers without focusable descendants receive sequential focus automatically; the manifest’s `minimum_chrome_version` is 131
 *   (required for §15.2 anchor positioning), so all supported Chrome versions qualify. Verify each with a round trip:
 *   focus → Shift+Tab to the previous element → Tab back. Returning proves sequential focusability.
 *   Also, even if adding `tabindex` as axe requests, half the side-mode scroll containers are **original nodes**
 *   (`#alg1.4`, `#S2.T1.2`, `#S2.F2`); adding attributes would violate the §7.1 DOM invariant.
 */
const VERIFY_KEYBOARD = new Set(['scrollable-region-focusable'])

/** Verify keyboard reachability by round trip: focus → Shift+Tab → Tab must return to the element */
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

/** Flatten axe results into individual node/rule violations */
const flatten = result => result.violations.flatMap(v =>
  v.nodes.map(n => ({ rule: v.id, impact: v.impact ?? '', target: n.target, html: (n.html ?? '').replace(/\s+/g, ' ').slice(0, 140) })))

/**
 * Compute a key for each violation that is comparable across both runs.
 *
 * Do not difference axe selectors directly (the core difficulty of issue #72): translation siblings shift
 * `:nth-child` indices, giving the same host-page issue different selectors and producing false positives.
 *
 * Key algorithm:
 * - Injected translation content → follow `data-axt-for` to its original block and use the **original block’s** key.
 *   This automatically classifies §7.4b’s duplicated h6 as inherited: the translated copy maps back to its original,
 *   whose key already exists in baseline. Translation-only issues (missing lang, insufficient overlay contrast) have no baseline match,
 *   so they count as new.
 * - Injected content without an original counterpart (image overlays, error widgets) → `axt:` key prefix, necessarily new.
 * - Host element → use its own stable key.
 *
 * Stable key: use `#id` when present (LaTeXML gives most blocks IDs such as `S1.p1`, so coverage is high);
 * otherwise walk to the nearest ancestor with an id, recording tags and same-tag sibling indices **excluding `.axt-*`**.
 * Excluding injected siblings keeps indices aligned across runs.
 */
const KEYED = items => {
  const INJECTED = '.axt-t, .axt-img, .axt-note-t, .axt-spinner'
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
  // Translations copy the original structure, so each translated element has an original counterpart:
  // record its path from the translation root (tag + same-tag index), then follow that path from the original block
  // Exclude injected siblings on both sides: stack mode can insert translations within original blocks too (nested blocks such as table cells);
  // otherwise copy and original indices differ
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
    // target is an array; multiple entries mean crossing a shadow root (only error widgets use shadow, §7.6)
    const [outer] = item.target
    const el = typeof outer === 'string' ? document.querySelector(outer) : null
    if (!el) return { ...item, key: `${item.rule}@?${item.target.join(' ')}`, origin: 'unresolved' }
    const injected = el.closest(INJECTED)
    if (!injected) return { ...item, key: `${item.rule}@${stable(el)}`, origin: 'host' }
    // Nearest anchor that maps back to original: data-axt-for for translations, data-axt-split-of for side-mode figure clones.
    // Clone data-axt-for uses synthetic `split:N`, which matches no data-axt-id (Codex #99);
    // ignoring data-axt-split-of would attribute inherited original issues (such as unlabeled <object>)
    // inside the clone to the extension
    const anchor = el.closest('[data-axt-for], [data-axt-split-of]')
    const forId = anchor?.getAttribute('data-axt-for')
    const splitOf = anchor?.getAttribute('data-axt-split-of')
    const original = forId && !forId.startsWith('split:')
      ? document.querySelector(`[data-axt-id="${CSS.escape(forId)}"]`)
      : splitOf ? document.getElementById(splitOf) : null
    const path = original && anchor ? pathTo(el, anchor) : null
    const counterpart = path ? follow(original, path) : null
    if (counterpart) return { ...item, key: `${item.rule}@${stable(counterpart)}`, origin: splitOf && !counterpart.closest(INJECTED) ? 'split' : 'translation' }
    // Injected content with no original counterpart (image overlays, error widgets, or non-isomorphic structure) is absent from baseline and counts as new
    return { ...item, key: `${item.rule}@axt:${injected.className}:${stable(injected.parentElement ?? injected)}`, origin: 'injected' }
  })
}

/** Run axe once and convert every violation into a comparable key */
const audit = async page => page.evaluate(KEYED, flatten(await new AxeBuilder({ page }).analyze()))

/**
 * Scroll one screen at a time: jumping to the bottom observes only the last screen.
 * **Reread** document height on every step (Codex #99): inserted translations grow the document while scrolling;
 * using the initial height stops halfway. Unobserved blocks have no pending nodes, so the idle condition still passes,
 * silently skipping the lower part of the paper from audit coverage
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
 * Use extension.mjs’s idle criterion: the last idle line is unchanged for 3 seconds and no pending nodes remain.
 * An idle line alone is insufficient (Codex #99): timeouts and failed blocks can also produce one,
 * leaving spinners and errors rather than translations to audit, with a misleadingly empty difference.
 * Require all three: actually stable, every requested block completed, and zero failures
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

// ── Baseline: same paper, no extension ─────────────────────────────────────
const baseContext = await chromium.launchPersistentContext(BASE_PROFILE, LAUNCH)
const basePage = await baseContext.newPage()
await basePage.goto(PAPER_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 })
await sleep(2_000) // Wait for arXiv scripts (theme, ToC, reading mode) before auditing
const baseline = await audit(basePage)
await basePage.screenshot({ path: `${SHOTS}/a11y-baseline.png` })
await baseContext.close()

const baseKeys = new Set(baseline.map(i => i.key))
const baseRuleSet = new Set(baseline.map(i => i.rule))
const baseRules = [...baseRuleSet].sort()
// Baseline must find violations: zero likely means axe did not run, making an empty difference vacuous
check('Baseline (without extension) found existing host-page issues', baseline.length > 0,
  `${baseline.length} violations, ${baseRules.length} rules: ${baseRules.join(' / ')}`)

// ── Comparison: extension installed, audit each of three modes ─────────────
const context = await chromium.launchPersistentContext(PROFILE, {
  ...LAUNCH,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
})
let [worker] = context.serviceWorkers()
if (!worker) worker = await context.waitForEvent('serviceworker')
const extId = worker.url().split('/')[2]

const options = await context.newPage()
await options.goto(`chrome-extension://${extId}/options.html`)
await options.selectOption('select >> nth=0', 'google-web') // Free engine, no cost
await options.getByRole('button', { name: 'Save', exact: true }).click()
await options.getByText('Saved', { exact: true }).waitFor({ timeout: 10_000 })
await options.close()

const logs = []
const page = await context.newPage()
page.on('console', m => { if (m.text().includes('[axt]')) logs.push(m.text()) })
await page.goto(`${PAPER_URL}#axt-translate`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
// Scroll the entire paper: first-screen translation misses most body content in the audit (§10 loading model)
await scrollThrough(page)
const settled = await waitSettled(page, logs)
check('Audit after full translation: stable, every requested block complete, zero failures', settled.ok,
  `${settled.idle ? `${settled.idle.requested}/${settled.idle.total} blocks requested; ` : ''}${settled.text}`)

// Popup reads the active tab: without the paper in front it renders different UI and has no mode buttons.
// After goto, bring the paper to front before waiting for buttons; never bring popup to front (same order as image.mjs)
const popupUrl = `chrome-extension://${extId}/popup.html`

for (const [label, button] of [['stack', 'Stacked'], ['side', 'Side by side'], ['only', 'Translation only']]) {
  const popup = await context.newPage()
  await popup.goto(popupUrl)
  await page.bringToFront()
  const control = popup.getByRole('button', { name: button, exact: true })
  await control.waitFor({ timeout: 10_000 })
  await control.click()
  await popup.close()
  await sleep(2_000) // Allow layout to settle after side-mode figure splitting and mirroring
  const withExt = await audit(page)
  const isNew = i => (DOCUMENT_RULES.has(i.rule) ? !baseRuleSet.has(i.rule) : !baseKeys.has(i.key))
  const candidates = withExt.filter(i => isNew(i) && VERIFY_KEYBOARD.has(i.rule))
  const reachable = await keyboardReachable(page, candidates.map(i => i.target[0]))
  const excused = candidates.filter((_, n) => reachable[n])
  const introduced = [
    ...withExt.filter(i => isNew(i) && !VERIFY_KEYBOARD.has(i.rule)),
    ...candidates.filter((_, n) => !reachable[n]), // Do not exempt elements that fail actual keyboard reachability
  ]
  await page.screenshot({ path: `${SHOTS}/a11y-${label}.png` })
  const byRule = [...new Set(introduced.map(i => i.rule))].sort()
  const tail = excused.length > 0 ? `; ${excused.length} additional ${[...new Set(excused.map(i => i.rule))].join(' / ')} violations exempted after verifying keyboard access in this browser` : ''
  check(`${label} mode: no extension-introduced accessibility issues`, introduced.length === 0,
    (introduced.length === 0
      ? `${withExt.length} violations, all present in baseline (inherited from host)`
      : `${introduced.length} new violations, ${byRule.length} rules: ${byRule.join(' / ')}`) + tail)
  const show = (items, mark) => {
    for (const item of items.slice(0, 12)) {
      console.log(`    ${mark} ${item.impact.padEnd(8)} ${item.rule}  [${item.origin}]  ${item.key}`)
      console.log(`               ${item.html}`)
    }
    if (items.length > 12) console.log(`    … ${items.length - 12} more`)
  }
  show(introduced, '✗')
  show(excused, '·') // Print exemptions too, so growth cannot go unnoticed
}

await context.close()
const pass = results.filter(r => r.ok).length
console.log(`\n${pass}/${results.length} passed; screenshots in ${SHOTS}`)
process.exit(pass === results.length ? 0 : 1)
