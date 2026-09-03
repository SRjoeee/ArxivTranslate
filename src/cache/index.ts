// 译文缓存（DESIGN §9）。只在 background 使用：IndexedDB 按 origin 隔离，content 侧的库属于 arxiv.org。
import { RULES_VERSION } from '@/core/rules/latexml'
import { PROMPT_VERSION } from '@/providers/prompt'
import { buildCacheKey, type CacheIdentity } from './key'
import { TranslationCache } from './store'

export const translationCache = new TranslationCache()

/** 把 PROMPT_VERSION / RULES_VERSION 填进 identity 后算键 */
export function cacheKeyFor(identity: Omit<CacheIdentity, 'promptVersion' | 'rulesVersion'>): Promise<string> {
  return buildCacheKey({ ...identity, promptVersion: PROMPT_VERSION, rulesVersion: RULES_VERSION })
}

export * from './key'
export * from './store'
