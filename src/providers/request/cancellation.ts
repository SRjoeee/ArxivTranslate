// Ported from reference/read-frog/src/utils/request/cancellation.ts@9b44f82 (GPL-3.0), 2026-09-05, modified: header only;
// 2026-09-12 (ADR-0005): CancelledScopeRegistry rewritten — no prefix marks, no expiry (its comment says why); the error class is as ported.
// The cancellation error is recognised by name (prototype chains do not survive a message boundary);
// CancelledScopeRegistry remembers cancelled scopes to close the window in which a request sits in no cancellable structure.
export const TRANSLATION_CANCELLED_ERROR_NAME = "TranslationCancelledError"

/**
 * Rejection used when the user cancels a page-translation session and its
 * queued/in-flight requests are drained (#1881). Detection is name-based so it
 * survives the content↔background messaging boundary: background rejections
 * are re-created on the sender side by zero-serialize-error, which preserves
 * `name` but not the prototype chain.
 */
export class TranslationCancelledError extends Error {
  constructor(scope?: string) {
    super(`Translation request cancelled${scope ? ` (scope: ${scope})` : ""}`)
    this.name = TRANSLATION_CANCELLED_ERROR_NAME
  }
}

export function isTranslationCancelledError(error: unknown): boolean {
  return error instanceof Error && error.name === TRANSLATION_CANCELLED_ERROR_NAME
}

/**
 * The scopes ended for certain (ADR-0005): the session router marks, every service that takes a scope reads, so a
 * call that was suspended on an await (the cache read, a chain build) when its scope was drained is refused when it
 * wakes instead of entering a queue with a dead scope that no future cancel will ever drain (#1881).
 *
 * Session ids are never reused, so remembering a scope can never wrongly reject a live request. Forgetting one can
 * revive a dead session whose call was still suspended — the ported registry's TTL and size cap did exactly that
 * under the local review's probe (a forCall held on a chain build while its tab closed, then 256 other drops) —
 * so nothing here expires: an entry is a few dozen bytes per ended session, and the worker's own life bounds the
 * set (it is recycled after thirty idle seconds).
 */
export class CancelledScopeRegistry {
  private readonly scopes = new Set<string>()

  markScope(scopeKey: string): void {
    this.scopes.add(scopeKey)
  }

  has(scopeKey: string): boolean {
    return this.scopes.has(scopeKey)
  }
}
