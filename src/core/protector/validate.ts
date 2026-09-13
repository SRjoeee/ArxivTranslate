// Placeholder integrity validation (DESIGN §6.3). DOM-free, runnable in the background.
import { type WireFormat, tokenize, writeVoid } from './tokens'

/**
 * Validation needs to know only “which slots the source has, and which of them are paired”, no DOM nodes.
 * `ProtectedBlock` has that shape of itself; a caller across a message boundary derives it from the request text
 * with `expectationsFromText`.
 */
export interface PlaceholderExpectations {
  format: WireFormat
  slots: ReadonlyMap<number, unknown>
  paired: ReadonlySet<number>
}

/**
 * Derive the expectations from the request text. Both formats' escaping guarantees “a placeholder on the wire was
 * written by us” (the unforgeability argument of text.ts), so one scan recovers both sets. With it the background
 * keeps a broken translation out of the cache without receiving an `accept` callback across a message (issue #42).
 *
 * **The format must be the right one**: the tags tokeniser over markers text recognises not one placeholder,
 * `slots` is empty → `validate` always passes → a torn translation enters the cache silently.
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
    super(`placeholder validation failed (${reason}): ${detail}`)
    this.name = 'PlaceholderIntegrityError'
  }
}

/**
 * Passes when: the void ids equal the source's and each appears once; paired ones are paired, nest legally and each
 * appears once; no id absent from the source; void and paired kinds never swap. The placeholder order may differ from the source's.
 */
export function validate(translated: string, block: PlaceholderExpectations): ValidationResult {
  const fail = (reason: IntegrityReason, detail: string): ValidationResult => ({ ok: false, reason, detail })
  const seen = new Set<number>()
  const stack: number[] = []

  for (const t of tokenize(translated, block.format)) {
    if (t.kind === 'text') continue
    if (t.kind === 'close') {
      if (stack.length === 0) return fail('unbalanced', 'stray </t>')
      stack.pop()
      continue
    }
    if (!block.slots.has(t.id)) return fail('unknown', `id ${t.id} is not in the source`)
    const isPaired = block.paired.has(t.id)
    if (t.kind === 'void' && isPaired) return fail('kind-mismatch', `id ${t.id} should be <t id="${t.id}">…</t>`)
    if (t.kind === 'open' && !isPaired) return fail('kind-mismatch', `id ${t.id} should be ${writeVoid(t.id, block.format)}`)
    if (seen.has(t.id)) return fail('duplicate', `id ${t.id} appears more than once`)
    seen.add(t.id)
    if (t.kind === 'open') stack.push(t.id)
  }

  if (stack.length > 0) return fail('unbalanced', `<t id="${stack[stack.length - 1]}"> is not closed`)
  const missing = [...block.slots.keys()].filter(id => !seen.has(id))
  if (missing.length > 0) return fail('missing', `missing ${missing.map(id => writeVoid(id, block.format)).join(', ')}`)
  return { ok: true }
}
