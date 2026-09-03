// 占位符完整性校验（DESIGN §6.3）。DOM-free，可在 background 里跑。
import type { ProtectedBlock } from './serialize'
import { tokenize } from './tokens'

export type IntegrityReason = 'missing' | 'duplicate' | 'unknown' | 'unbalanced' | 'kind-mismatch'

export type ValidationResult = { ok: true } | { ok: false; reason: IntegrityReason; detail: string }

export class PlaceholderIntegrityError extends Error {
  constructor(readonly reason: IntegrityReason, readonly detail: string) {
    super(`占位符校验失败（${reason}）：${detail}`)
    this.name = 'PlaceholderIntegrityError'
  }
}

/**
 * 通过条件：void id 集合与原文一致且各出现一次；paired 成对、嵌套合法、各出现一次；
 * 没有原文里不存在的 id；void / paired 种类不能互换。占位符顺序可以与原文不同。
 */
export function validate(translated: string, block: ProtectedBlock): ValidationResult {
  const fail = (reason: IntegrityReason, detail: string): ValidationResult => ({ ok: false, reason, detail })
  const seen = new Set<number>()
  const stack: number[] = []

  for (const t of tokenize(translated)) {
    if (t.kind === 'text') continue
    if (t.kind === 'close') {
      if (stack.length === 0) return fail('unbalanced', '多余的 </t>')
      stack.pop()
      continue
    }
    if (!block.slots.has(t.id)) return fail('unknown', `id ${t.id} 不存在于原文`)
    const isPaired = block.paired.has(t.id)
    if (t.kind === 'void' && isPaired) return fail('kind-mismatch', `id ${t.id} 应为 <t id="${t.id}">…</t>`)
    if (t.kind === 'open' && !isPaired) return fail('kind-mismatch', `id ${t.id} 应为 <x id="${t.id}"/>`)
    if (seen.has(t.id)) return fail('duplicate', `id ${t.id} 出现多次`)
    seen.add(t.id)
    if (t.kind === 'open') stack.push(t.id)
  }

  if (stack.length > 0) return fail('unbalanced', `<t id="${stack[stack.length - 1]}"> 未闭合`)
  const missing = [...block.slots.keys()].filter(id => !seen.has(id))
  if (missing.length > 0) return fail('missing', `缺少 id ${missing.join(', ')}`)
  return { ok: true }
}
