// The cache key (DESIGN §9): sha256(providerId | model | PROMPT_VERSION | promptKey | context | RULES_VERSION | target | renderPath | normalizedText).
// The prompt and the context enter the payload as **structured source text**, not squeezed into a 32-bit hash first:
// a DJB2 collision cannot be told apart by the outer SHA-256 (Codex on #28 gave the instance: the titles
// 19k04n01vcr73f and 1efm0uaep90s9 share a DJB2). After FluentRead: identity is a structured, deterministic
// serialisation (a JSON array), never user text joined with separators, so keys cannot collide.
// ./store is not imported here: the content side computes keys but must not bundle Dexie (DESIGN §8.0).
import { RULES_VERSION } from '@/core/rules/latexml'
import { PROMPT_VERSION } from '@/providers/prompt'
import type { WireFormat } from '@/core/protector/tokens'
import { sha256Hex } from '@/shared/digest'

/**
 * The render path = the wire format (see protector/tokens.ts) plus the run-splitting fallback `runs`.
 *
 * Once `markup` / `markers` / `runs`, **two sets of names for the same thing** as `WireFormat`'s `tags` / `markers`,
 * converted back and forth by a mapping function. That was the breeding ground of “three hard-coded `'tags'` will
 * miss one” — a new call site with one wrong literal, and the type system cannot catch it. Unified, `serialize(el, renderPath)` simply holds (issue #108).
 */
export type RenderPath = WireFormat | 'runs'

/**
 * Render path → wire format. With the names unified only one **real** thing remains here: `runs` takes no
 * placeholders, sends cut plain-text runs, yet still has to escape by some rule, and takes `tags` (`& < >` as entities).
 */
export function wireFormatOf(path: RenderPath): WireFormat {
  return path === 'runs' ? 'tags' : path
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
  /** The prompt's identity (prompt-library.promptKey: the id for a built-in, the full text for a custom one); a free engine has no prompt and passes the empty string */
  promptKey: string
  /** The context that enters the prompt: the translation follows the title / abstract / section / glossary, and the same passage in another paper must not hit. A free engine reads no context and passes undefined */
  context?: CacheContext
  rulesVersion: string
  target: string
  renderPath: RenderPath
  /** The text sent to the model (placeholders included); normalised here */
  text: string
  /**
   * The sentence boundaries (§8.6). **Must enter the key**: two blocks can serialise to the same wire text with
   * different slot semantics, and `cutsOf` then gives different cut points — without it in the key the second block
   * hits the first's entry, its mismatched alignment included (`verifyAlignment` checks counts and total lengths only
   * and cannot catch this) (Codex on #137). A call that cuts no sentences omits the field, and the key is as before
   */
  cuts?: readonly number[]
}

/**
 * Bumped when the key's algorithm or the normalisation rules change, so old data expires of itself.
 * 3: the markers path added (#104); 4: markup renamed tags (#108; the key stores that string); 5: serialisation
 * started collapsing whitespace (#119). **That time the key's algorithm did not change; the old entries' content was
 * wrong** — requests with hard line breaks made Microsoft translate line by line (`state explosion` → 「州级爆炸性质」),
 * and `normalizeText` gave the broken-line and collapsed texts the same key, so those bad translations would have
 * been served as they were for the 30-day TTL, the fix never reaching blocks translated already. Bumping the version
 * voided them at once (Codex on #122).
 * 6: sentence alignment started inserting markers for engines that report no boundaries (§8.6, #105). **The request
 * sent changed** — the same text now goes out with `<x id="N"/>` boundary markers — so an old entry no longer
 * describes the same request. Unbumped, every paper translated within the 30-day TTL would hit the old entries
 * without alignment, and the highlight would stay dark on those pages (Codex on #137).
 */
export const CACHE_KEY_VERSION = 6

/** NFC + runs of whitespace collapsed to one space + trimmed. For the key only; the text sent for translation is untouched */
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
    identity.cuts ?? null,
  ])
  return sha256Hex(payload)
}

/** Compute the key with PROMPT_VERSION / RULES_VERSION filled into the identity */
export function cacheKeyFor(identity: Omit<CacheIdentity, 'promptVersion' | 'rulesVersion'>): Promise<string> {
  return buildCacheKey({ ...identity, promptVersion: PROMPT_VERSION, rulesVersion: RULES_VERSION })
}

/** The context's deterministic serialisation: fixed field order, absent as empty */
function contextPayload(context: CacheContext | undefined): unknown[] {
  if (!context) return []
  return [context.paperTitle ?? '', context.abstract ?? '', context.sectionTitle ?? '', (context.glossary ?? []).map(g => [g.term, g.translation])]
}

/** Bumped when the OCR result's stored shape or the line-filtering premises change */
export const OCR_KEY_VERSION = 1

/**
 * The OCR result's cache key (DESIGN §15.2): recognition is deterministic and varies with the image bytes and the
 * helper version only; computed apart from the translation key — each line's translation goes through the ordinary text cache, whose key carries no imageHash
 */
export function ocrCacheKey(imageHash: string, helperVersion: string): Promise<string> {
  return sha256Hex(JSON.stringify(['ocr', OCR_KEY_VERSION, imageHash, helperVersion]))
}
