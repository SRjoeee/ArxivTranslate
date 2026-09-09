// Placeholder integrity validation (DESIGN §6.3). DOM-free; can run in the background.
import { tokenize } from './tokens'

/**
 * Validation needs only the original slot IDs and which are paired, not DOM nodes.
 * `ProtectedBlock` already has this shape; callers across message boundaries derive it with `expectationsFromText`.
 */
export interface PlaceholderExpectations {
  slots: ReadonlyMap<number, unknown>
  paired: ReadonlySet<number>
}

/**
 * Derive expectations from request text. `serialize` has already escaped literal `<` and `>` (§6.1),
 * so every `<x>` / `<t>` in a request is a real placeholder. One scan reconstructs both sets.
 * This lets the background reject invalid translations before caching without receiving an `accept` callback (issue #42).
 */
export function expectationsFromText(text: string): PlaceholderExpectations {
  const slots = new Map<number, null>()
  const paired = new Set<number>()
  for (const t of tokenize(text)) {
    if (t.kind === 'text' || t.kind === 'close') continue
    slots.set(t.id, null)
    if (t.kind === 'open') paired.add(t.id)
  }
  return { slots, paired }
}

export type IntegrityReason = 'missing' | 'duplicate' | 'unknown' | 'unbalanced' | 'kind-mismatch'

export type ValidationResult = { ok: true } | { ok: false; reason: IntegrityReason; detail: string }

export class PlaceholderIntegrityError extends Error {
  constructor(readonly reason: IntegrityReason, readonly detail: string) {
    super(`Placeholder validation failed (${reason}): ${detail}`)
    this.name = 'PlaceholderIntegrityError'
  }
}

/**
 * Pass conditions: void IDs match the original, each exactly once; paired IDs occur once, balanced and properly nested.
 * No unknown IDs or void / paired swaps. Placeholder order may differ from the original.
 */
export function validate(translated: string, block: PlaceholderExpectations): ValidationResult {
  const fail = (reason: IntegrityReason, detail: string): ValidationResult => ({ ok: false, reason, detail })
  const seen = new Set<number>()
  const stack: number[] = []

  for (const t of tokenize(translated)) {
    if (t.kind === 'text') continue
    if (t.kind === 'close') {
      if (stack.length === 0) return fail('unbalanced', 'Unexpected </t>')
      stack.pop()
      continue
    }
    if (!block.slots.has(t.id)) return fail('unknown', `ID ${t.id} is not in the original`)
    const isPaired = block.paired.has(t.id)
    if (t.kind === 'void' && isPaired) return fail('kind-mismatch', `ID ${t.id} must be <t id="${t.id}">…</t>`)
    if (t.kind === 'open' && !isPaired) return fail('kind-mismatch', `ID ${t.id} must be <x id="${t.id}"/>`)
    if (seen.has(t.id)) return fail('duplicate', `ID ${t.id} occurs more than once`)
    seen.add(t.id)
    if (t.kind === 'open') stack.push(t.id)
  }

  if (stack.length > 0) return fail('unbalanced', `Unclosed <t id="${stack[stack.length - 1]}">`)
  const missing = [...block.slots.keys()].filter(id => !seen.has(id))
  if (missing.length > 0) return fail('missing', `Missing IDs: ${missing.join(', ')}`)
  return { ok: true }
}
