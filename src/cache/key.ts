// 缓存键（DESIGN §9）：sha256(providerId | model | PROMPT_VERSION | RULES_VERSION | target | renderPath | normalizedText)。
// 借鉴 FluentRead：identity 做结构化的确定性序列化（JSON 数组），不用分隔符拼用户文本，避免撞键。
export type RenderPath = 'markup' | 'runs'

export interface CacheIdentity {
  providerId: string
  model: string
  promptVersion: string
  rulesVersion: string
  target: string
  renderPath: RenderPath
  /** 发给模型的文本（含占位符），归一化在这里做 */
  text: string
}

/** 改变键的算法或归一化规则时递增，旧数据自然失效 */
export const CACHE_KEY_VERSION = 1

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
    identity.rulesVersion,
    identity.target,
    identity.renderPath,
    normalizeText(identity.text),
  ])
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
