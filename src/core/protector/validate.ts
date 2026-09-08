// 占位符完整性校验（DESIGN §6.3）。DOM-free，可在 background 里跑。
import { type WireFormat, tokenize, writeVoid } from './tokens'

/**
 * 校验只需要知道「原文有哪些槽位、其中哪些是成对的」，不需要 DOM 节点。
 * `ProtectedBlock` 天然满足这个形状；跨消息边界的调用方用 `expectationsFromText` 从请求文本反推。
 */
export interface PlaceholderExpectations {
  format: WireFormat
  slots: ReadonlyMap<number, unknown>
  paired: ReadonlySet<number>
}

/**
 * 从请求文本反推期望。两种格式的转义都保证「线上出现的占位符必然是我们写进去的」（见 text.ts 的
 * 不可伪造性论证），扫一遍就能还原两个集合。有了它，background 不必跨消息接收 `accept` 回调
 * 也能把坏译文挡在缓存之外（issue #42）。
 *
 * **格式必须传对**：拿 tags 的分词器去扫 markers 文本会一个占位符都认不出来，
 * `slots` 为空 → `validate` 恒真 → 被打烂的译文静默进缓存。
 */
export function expectationsFromText(text: string, format: WireFormat = 'tags'): PlaceholderExpectations {
  const slots = new Map<number, null>()
  const paired = new Set<number>()
  for (const t of tokenize(text, format)) {
    if (t.kind === 'text' || t.kind === 'close') continue
    slots.set(t.id, null)
    if (t.kind === 'open') paired.add(t.id)
  }
  return { format, slots, paired }
}

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
export function validate(translated: string, block: PlaceholderExpectations): ValidationResult {
  const fail = (reason: IntegrityReason, detail: string): ValidationResult => ({ ok: false, reason, detail })
  const seen = new Set<number>()
  const stack: number[] = []

  for (const t of tokenize(translated, block.format)) {
    if (t.kind === 'text') continue
    if (t.kind === 'close') {
      if (stack.length === 0) return fail('unbalanced', '多余的 </t>')
      stack.pop()
      continue
    }
    if (!block.slots.has(t.id)) return fail('unknown', `id ${t.id} 不存在于原文`)
    const isPaired = block.paired.has(t.id)
    if (t.kind === 'void' && isPaired) return fail('kind-mismatch', `id ${t.id} 应为 <t id="${t.id}">…</t>`)
    if (t.kind === 'open' && !isPaired) return fail('kind-mismatch', `id ${t.id} 应为 ${writeVoid(t.id, block.format)}`)
    if (seen.has(t.id)) return fail('duplicate', `id ${t.id} 出现多次`)
    seen.add(t.id)
    if (t.kind === 'open') stack.push(t.id)
  }

  if (stack.length > 0) return fail('unbalanced', `<t id="${stack[stack.length - 1]}"> 未闭合`)
  const missing = [...block.slots.keys()].filter(id => !seen.has(id))
  if (missing.length > 0) return fail('missing', `缺少 ${missing.map(id => writeVoid(id, block.format)).join(', ')}`)
  return { ok: true }
}
