// Ported from reference/read-frog/src/utils/host/translate/translation-session.ts@9b44f82 (GPL-3.0), 2026-09-05,
// modified: the two providerRef functions are dropped (that is its hosted state; our provider is fetched once in start());
// 2026-09-12 (ADR-0004): the module-level "current session" singleton is gone — the page session owns its id — and
// only the id format remains.
//
// The id is a correlation key, not cryptographic material — deliberately not getRandomUUID, and a source of its own
// separate from the walk ids; the random part keeps several frames of one tab apart, the counter keeps one frame's
// sessions apart within a millisecond.
let sessionCounter = 0

export function newSessionId(): string {
  sessionCounter += 1
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${sessionCounter}`
}
