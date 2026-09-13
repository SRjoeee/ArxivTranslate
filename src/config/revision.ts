// Which settings shape the translation chain, and the identity of a set of them. The background rebuilds the chain
// when one of these changes (`chainConfigChanged`); a page records the digest of the settings it started on, and the
// popup and the context-menu toggle compare it with the digest of what is saved now (`chainRevision`, shared/page-action.ts).
// Nothing heavy is imported here: the popup bundle reads this without the providers behind providers/transport.ts
import type { Config } from './schema'
import { sha256Hex } from '@/shared/digest'

/**
 * The configuration fields a chain build reads. A change to any other field (mode, style, preload, glossary) must
 * **not** rebuild: the content script writes the configuration on every display-mode switch, usually while the page is
 * translating, and a rebuild would clear the token buckets and the hand-over records with it. `tests/providers/transport.test.ts` guards this table: a new configuration field must be classified explicitly.
 */
export const CHAIN_CONFIG_FIELDS = ['provider', 'services', 'prompts', 'targetLanguage', 'fallback'] as const
/** The complement of CHAIN_CONFIG_FIELDS; the two together must cover every field of Config */
export const VOLATILE_CONFIG_FIELDS = ['version', 'mode', 'glossary', 'appearance', 'preload', 'image', 'reading', 'uiLanguage'] as const

export function chainConfigChanged(a: Config, b: Config): boolean {
  return CHAIN_CONFIG_FIELDS.some(field => !deepEqual(a[field], b[field]))
}

/**
 * The identity of the settings a chain is built from: a digest of the chain fields above, so a page can tell whether
 * the settings moved on since its session started. Not a build counter — that restarted with the worker, so a page
 * that outlived one worker looked "behind the settings" once the next had rebuilt the same chain, and a rebuild from
 * unchanged settings bumped it too (INVENTORY S8, open question 2). API keys go in as their own digests: the
 * serialised document never holds one, the rule `deepEqual` keeps. Sixteen hex digits are plenty for "same or not"
 */
export async function chainRevision(config: Config): Promise<string> {
  const picked: Record<string, unknown> = {}
  for (const field of CHAIN_CONFIG_FIELDS) picked[field] = config[field]
  picked.services = await Promise.all(config.services.map(async service => ({ ...service, apiKey: await sha256Hex(service.apiKey) })))
  return (await sha256Hex(JSON.stringify(canonical(picked)))).slice(0, 16)
}

/** Objects with their keys sorted, recursively: the digest must not depend on the order storage hands the fields back in */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical((value as Record<string, unknown>)[key])]))
}

/** Compared field by field rather than serialised: the configuration holds an API key, and it gets no extra copy (hard rule 7) */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
