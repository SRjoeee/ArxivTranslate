// Phase 0: calibrating the numeric-cell regex of §5.3. Usage: pnpm exec tsx scripts/phase0/td-numeric-calib.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { Window } from 'happy-dom'
import { DOCUMENT_ROOT, UNIT_RULES, SKIP_RULES } from '../../src/core/rules/latexml'
const TD = UNIT_RULES.find(r => r.id === 'td')!.selector
const MATH = SKIP_RULES.find(r => r.id === 'math')!.selector
const NUM = /^[\s\d.,+\-±×^%()/*eE−–—:;~<>=≤≥∼]+(\s*[a-zA-Zμ°%]{1,4})?$/
const dir = join(import.meta.dirname, '../../tests/fixtures/arxiv')
const tot = { cells: 0, empty: 0, mathOnly: 0, num: 0, text: 0 }
const missSamples = new Map<string, number>(), fpSamples = new Map<string, number>(), textSamples = new Map<string, number>()
for (const f of readdirSync(dir).filter(f => f.endsWith('.html'))) {
  const w = new Window({ settings: { disableJavaScriptEvaluation: true, disableCSSFileLoading: true, disableJavaScriptFileLoading: true } })
  const doc = new w.DOMParser().parseFromString(readFileSync(join(dir, f), 'utf8'), 'text/html')
  const root = doc.querySelector(DOCUMENT_ROOT)!
  for (const td of Array.from(root.querySelectorAll(TD))) {
    tot.cells++
    const hasMath = !!td.querySelector(MATH)
    // Visible text: the math subtree excluded
    const parts: string[] = []
    // biome-ignore lint/suspicious/noExplicitAny: a Phase 0 script; happy-dom's node types are not worth importing
    const walk = (n: any) => { for (const c of Array.from(n.childNodes) as any[]) { if (c.nodeType === 3) parts.push(c.data); else if (c.nodeType === 1 && !c.matches(MATH)) walk(c) } }
    walk(td)
    const txt = parts.join('').replace(/\s+/g, ' ').trim()
    if (!txt) { hasMath ? tot.mathOnly++ : tot.empty++; continue }
    if (NUM.test(txt)) { tot.num++; if (/[a-zA-Z]{2,}/.test(txt)) fpSamples.set(txt, (fpSamples.get(txt) ?? 0) + 1) }
    else { tot.text++; if (txt.length <= 10) missSamples.set(txt, (missSamples.get(txt) ?? 0) + 1); else if (txt.length <= 40) textSamples.set(txt, (textSamples.get(txt) ?? 0) + 1) }
  }
}
const top = (m: Map<string, number>, n: number) => Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}× ${JSON.stringify(k)}`).join('\n')
console.log('total', tot)
console.log(`\n--- short cells (length ≤ 10) the regex misses (numbers / symbols possibly missed) ---\n${top(missSamples, 30)}`)
console.log(`\n--- cells the regex matches that hold ≥ 2 letters (possibly misjudged as numeric) ---\n${top(fpSamples, 15)}`)
console.log(`\n--- sample prose cells of length 11–40 the regex misses ---\n${top(textSamples, 12)}`)
