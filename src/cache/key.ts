// 缓存键（DESIGN §9）：sha256(providerId | model | PROMPT_VERSION | promptKey | context | RULES_VERSION | target | renderPath | normalizedText)。
// 提示词与上下文以**结构化原文**进载荷，不先压成 32 位 hash：DJB2 撞了外层 SHA-256 也分不开
//（Codex 在 #28 给出实例：标题 19k04n01vcr73f 与 1efm0uaep90s9 的 DJB2 相同）。
// 借鉴 FluentRead：identity 做结构化的确定性序列化（JSON 数组），不用分隔符拼用户文本，避免撞键。
// 这里不引用 ./store：content 侧要算键但不能把 Dexie 打进包（DESIGN §8.0）。
import { RULES_VERSION } from '@/core/rules/latexml'
import { PROMPT_VERSION } from '@/providers/prompt'
import type { WireFormat } from '@/core/protector/tokens'
import { sha256Hex } from '@/shared/digest'

/**
 * 渲染路径。`markup` / `markers` 是两种线上格式（见 protector/tokens.ts），`runs` 是切段兜底。
 * 名字与 `WireFormat` 的 `tags` 不对称是历史包袱（DESIGN §9 一直叫 markup），映射只在 `wireFormatOf` 一处。
 */
export type RenderPath = 'markup' | 'markers' | 'runs'

/** 渲染路径 → 线上格式。`runs` 不走占位符，取 `tags` 只是给它一个确定的转义规则 */
export function wireFormatOf(path: RenderPath): WireFormat {
  return path === 'markers' ? 'markers' : 'tags'
}

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

/** 改变键的算法或归一化规则时递增，旧数据自然失效。3：加入 markers 路径（#104） */
export const CACHE_KEY_VERSION = 3

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
  return sha256Hex(payload)
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

/** 改变 OCR 结果的存储形状或行的过滤前提时递增 */
export const OCR_KEY_VERSION = 1

/**
 * OCR 结果的缓存键（DESIGN §15.2）：识别是确定性的，只随图片字节与 helper 版本变；
 * 与译文的键分开算——每行的翻译走普通文字缓存，键里不带 imageHash
 */
export function ocrCacheKey(imageHash: string, helperVersion: string): Promise<string> {
  return sha256Hex(JSON.stringify(['ocr', OCR_KEY_VERSION, imageHash, helperVersion]))
}
