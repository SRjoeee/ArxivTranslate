// Phase 0：§5.3 数值格正则校准。用法：pnpm exec tsx scripts/phase0/td-numeric-calib.ts
import { readFileSync, readdirSync } from 'node:fs'
import { join, basename } from 'node:path'
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
    // 可见文本：排除 math 子树
    const parts: string[] = []
    const walk = (n: any) => { for (const c of Array.from(n.childNodes) as any[]) { if (c.nodeType === 3) parts.push(c.data); else if (c.nodeType === 1 && !c.matches(MATH)) walk(c) } }
    walk(td)
    const txt = parts.join('').replace(/\s+/g, ' ').trim()
    if (!txt) { hasMath ? tot.mathOnly++ : tot.empty++; continue }
    if (NUM.test(txt)) { tot.num++; if (/[a-zA-Z]{2,}/.test(txt)) fpSamples.set(txt, (fpSamples.get(txt) ?? 0) + 1) }
    else { tot.text++; if (txt.length <= 10) missSamples.set(txt, (missSamples.get(txt) ?? 0) + 1); else if (txt.length <= 40) textSamples.set(txt, (textSamples.get(txt) ?? 0) + 1) }
  }
}
const top = (m: Map<string, number>, n: number) => Array.from(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${v}× ${JSON.stringify(k)}`).join('\n')
console.log('合计', tot)
console.log('\n--- 正则未命中、长度≤10 的短单元格（疑似漏判的数值/符号）---\n' + top(missSamples, 30))
console.log('\n--- 正则命中但含 ≥2 个字母（疑似误判为数值）---\n' + top(fpSamples, 15))
console.log('\n--- 正则未命中、长度 11–40 的散文单元格样本 ---\n' + top(textSamples, 12))
