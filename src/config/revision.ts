// Which settings shape the translation chain, and the identity of a set of them. The background rebuilds the chain
// when one of these changes (`chainConfigChanged`); a page records the digest of the settings it started on, and the
// popup and the context-menu toggle compare it with the digest of what is saved now (`chainRevision`, shared/page-action.ts).
// Nothing heavy is imported here: the popup bundle reads this without the providers behind providers/transport.ts
import type { Config } from './schema'
import { sha256Hex } from '@/shared/digest'

/**
 * 建链要读的配置字段。其余字段（模式、样式、预加载、术语表）改了**不能**重建：
 * content 每切一次显示模式就写一次配置，而那时页面往往正在翻，重建会把令牌桶和降级记录一起清掉。
 * `tests/providers/transport.test.ts` 守着这张表：新增配置字段必须显式归类。
 */
export const CHAIN_CONFIG_FIELDS = ['provider', 'services', 'prompts', 'targetLanguage', 'fallback'] as const
/** 与 CHAIN_CONFIG_FIELDS 互补，两者之和必须覆盖 Config 的全部字段 */
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

/** 逐字段比较而不是序列化：配置里有 API key，不给它多留一份副本（硬规则 7） */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const keys = Object.keys(a)
  if (keys.length !== Object.keys(b).length) return false
  return keys.every(key => deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]))
}
