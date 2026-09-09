// Ported from reference/read-frog/src/utils/host/translate/translation-session.ts@9b44f82 (GPL-3.0), 2026-09-05; modified:
// removed two providerRef functions (upstream hosted state; our start() resolves the provider once).
//
// Current page translation session identity. Module state is appropriate: one session per frame.
// Every request carries this ID as scope; translate-service cancels queued and in-flight requests by scope (Read Frog #1881).
// Each session gets a fresh ID, so cancellation of old requests never affects a restarted session.
// This ID is a correlation key, not cryptographic material. Deliberately separate from getRandomUUID and walk IDs; randomness distinguishes frames in one tab.

let currentSessionId: string | null = null
let sessionCounter = 0

export function beginSession(): string {
  sessionCounter += 1
  currentSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${sessionCounter}`
  return currentSessionId
}

export function endSession(): string | null {
  const ended = currentSessionId
  currentSessionId = null
  return ended
}

export function getSessionId(): string | null {
  return currentSessionId
}
