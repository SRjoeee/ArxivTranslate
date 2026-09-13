// A UUIDv4 for correlation keys (session ids, queue task ids). Every context this extension runs in — MV3
// service worker, content script, extension pages — is a secure context on Chrome 131+, so `crypto.randomUUID` is
// always there; the hand-rolled fallback ported from Read Frog's crypto-polyfill was never reached and is gone (ADR-0001 §9).
export function getRandomUUID(): string {
  return crypto.randomUUID()
}
