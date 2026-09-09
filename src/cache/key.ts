// Cache keys (DESIGN §9): sha256(providerId | model | PROMPT_VERSION | promptKey | context | RULES_VERSION | target | renderPath | normalizedText).
// Include prompt/context as structured full text, not a preliminary 32-bit hash: outer SHA-256 cannot distinguish DJB2 collisions
// (Codex #28 example: titles 19k04n01vcr73f and 1efm0uaep90s9 have the same DJB2 hash).
// Following FluentRead, serialize identity deterministically as a JSON array instead of delimiter-joining user text, avoiding collisions.
// Do not import ./store: content needs keys without bundling Dexie (DESIGN §8.0).
import { RULES_VERSION } from '@/core/rules/latexml'
import { PROMPT_VERSION } from '@/providers/prompt'
import { sha256Hex } from '@/shared/digest'
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
  /** Prompt identity (prompt-library.promptKey: built-in id or full custom text); empty for free engines with no prompts. */
  promptKey: string
  /** Prompt context: titles/abstracts/sections/glossaries affect output, so the same text in another paper cannot hit. Undefined for free engines that ignore context. */
  context?: CacheContext
  rulesVersion: string
  target: string
  renderPath: RenderPath
  /** Text sent to the model, including placeholders; normalized here for key generation. */
  text: string
}

/** Increment when key algorithms or normalization rules change, invalidating old data. */
export const CACHE_KEY_VERSION = 2

/** NFC + collapse consecutive whitespace + trim. Key generation only; translation input remains unchanged. */
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

/** Add PROMPT_VERSION / RULES_VERSION to the identity before computing its key. */
export function cacheKeyFor(identity: Omit<CacheIdentity, 'promptVersion' | 'rulesVersion'>): Promise<string> {
  return buildCacheKey({ ...identity, promptVersion: PROMPT_VERSION, rulesVersion: RULES_VERSION })
}

/** Deterministic context serialization: fixed field order; missing values become empty. */
function contextPayload(context: CacheContext | undefined): unknown[] {
  if (!context) return []
  return [context.paperTitle ?? '', context.abstract ?? '', context.sectionTitle ?? '', (context.glossary ?? []).map(g => [g.term, g.translation])]
}

/** Increment when stored OCR shape or line-filtering conditions change. */
export const OCR_KEY_VERSION = 1

/**
 * OCR cache key (DESIGN §15.2): recognition is deterministic, depending only on image bytes and helper version.
 * Separate from translation keys: each line uses the normal text cache without imageHash.
 */
export function ocrCacheKey(imageHash: string, helperVersion: string): Promise<string> {
  return sha256Hex(JSON.stringify(['ocr', OCR_KEY_VERSION, imageHash, helperVersion]))
}
