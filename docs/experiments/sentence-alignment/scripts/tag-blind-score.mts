import { readFileSync } from 'node:fs'
const dir = '/private/tmp/claude-501/-Users-cheongzhiyan-Developer-ArxivTranslate/6d482bd8-5c21-4216-9edd-225cdeff7f9e/scratchpad/wt-exp/docs/experiments/sentence-alignment/data/'
const key = JSON.parse(readFileSync(dir + 'tag-blind-key.json', 'utf8')) as Array<{ n: number; first: 'tagged' | 'plain' }>
const v = JSON.parse(readFileSync(dir + 'tag-blind-verdicts.json', 'utf8')) as Record<string, string>
let tagged = 0, plain = 0, tie = 0
const detail: string[] = []
for (const { n, first } of key) {
  const verdict = v[String(n)]; if (!verdict) continue
  if (verdict === '平') { tie++; detail.push(`  ${n}. 平`); continue }
  const winner = (verdict === '甲') === (first === 'tagged') ? 'tagged' : 'plain'
  winner === 'tagged' ? tagged++ : plain++
  detail.push(`  ${n}. ${verdict} → ${winner === 'tagged' ? '插标签' : '不插'}`)
}
console.log(detail.join('\n'))
console.log(`\n插标签胜 ${tagged}   不插胜 ${plain}   平 ${tie}   （共 ${tagged + plain + tie}）`)
