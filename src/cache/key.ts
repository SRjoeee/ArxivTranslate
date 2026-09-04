// 缓存键（DESIGN §9）：sha256(providerId | model | PROMPT_VERSION | promptKey | context | RULES_VERSION | target | renderPath | normalizedText)。
// 提示词与上下文以**结构化原文**进载荷，不先压成 32 位 hash：DJB2 撞了外层 SHA-256 也分不开
//（Codex 在 #28 给出实例：标题 19k04n01vcr73f 与 1efm0uaep90s9 的 DJB2 相同）。
// 借鉴 FluentRead：identity 做结构化的确定性序列化（JSON 数组），不用分隔符拼用户文本，避免撞键。
// 这里不引用 ./store：content 侧要算键但不能把 Dexie 打进包（DESIGN §8.0）。
import { RULES_VERSION } from '@/core/rules/latexml'
import { PROMPT_VERSION } from '@/providers/prompt'
export type RenderPath = 'markup' | 'runs'

export interface CacheContext {
  paperTitle?: string
  abstract?: string
  sectionTitle?: string
  glossary?: { term: string; translation: string }[]
}

export interface CacheIdentity {
  providerId: string
  model: string
  promptVersion: string
  /** 提示词身份（prompt-library.promptKey：内置是 id，自定义是全文）；免费引擎没有提示词，传空串 */
  promptKey: string
  /** 进 prompt 的上下文：译文随标题 / 摘要 / 章节 / 术语表变化，同一段文字在另一篇论文里不能拿来命中。免费引擎不看上下文，传 undefined */
  context?: CacheContext
  rulesVersion: string
  target: string
  renderPath: RenderPath
  /** 发给模型的文本（含占位符），归一化在这里做 */
  text: string
}

/** 改变键的算法或归一化规则时递增，旧数据自然失效 */
export const CACHE_KEY_VERSION = 2

/** NFC + 连续空白折成一个空格 + 首尾 trim。只用于算键，不改动送翻译的文本 */
export function normalizeText(text: string): string {
  return text.normalize('NFC').replace(/\s+/g, ' ').trim()
}

export async function buildCacheKey(identity: CacheIdentity): Promise<string> {
  const payload = JSON.stringify([
    CACHE_KEY_VERSION,
    identity.providerId,
    identity.model,
    identity.promptVersion,
    identity.promptKey,
    contextPayload(identity.context),
    identity.rulesVersion,
    identity.target,
    identity.renderPath,
    normalizeText(identity.text),
  ])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** 把 PROMPT_VERSION / RULES_VERSION 填进 identity 后算键 */
export function cacheKeyFor(identity: Omit<CacheIdentity, 'promptVersion' | 'rulesVersion'>): Promise<string> {
  return buildCacheKey({ ...identity, promptVersion: PROMPT_VERSION, rulesVersion: RULES_VERSION })
}

/** 上下文的确定性序列化：字段顺序固定，缺省当空 */
function contextPayload(context: CacheContext | undefined): unknown[] {
  if (!context) return []
  return [context.paperTitle ?? '', context.abstract ?? '', context.sectionTitle ?? '', (context.glossary ?? []).map(g => [g.term, g.translation])]
}
