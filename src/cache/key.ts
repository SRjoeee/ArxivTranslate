// 缓存键（DESIGN §9）：sha256(providerId | model | PROMPT_VERSION | promptKey | contextKey | RULES_VERSION | target | renderPath | normalizedText)。
// 借鉴 FluentRead：identity 做结构化的确定性序列化（JSON 数组），不用分隔符拼用户文本，避免撞键。
// 这里不引用 ./store：content 侧要算键但不能把 Dexie 打进包（DESIGN §8.0）。
import { RULES_VERSION } from '@/core/rules/latexml'
import { PROMPT_VERSION } from '@/providers/prompt'
export type RenderPath = 'markup' | 'runs'

export interface CacheIdentity {
  providerId: string
  model: string
  promptVersion: string
  /** 提示词指纹（prompt-library.promptKey）；免费引擎没有提示词，传空串 */
  promptKey: string
  /** 上下文指纹（contextKey）：译文随标题 / 摘要 / 章节 / 术语表变化，同一段文字在另一篇论文里不能拿来命中 */
  contextKey: string
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
    identity.contextKey,
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

/** 上下文指纹：进 prompt 的几个字段一起 hash。免费引擎不看上下文，调用方传空串 */
export function contextKey(context: { paperTitle?: string; abstract?: string; sectionTitle?: string; glossary?: { term: string; translation: string }[] } | undefined): string {
  if (!context) return ''
  const payload = JSON.stringify([context.paperTitle ?? '', context.abstract ?? '', context.sectionTitle ?? '', context.glossary ?? []])
  let hash = 5381
  for (const ch of payload) hash = ((hash * 33) ^ ch.charCodeAt(0)) >>> 0
  return hash.toString(36)
}
