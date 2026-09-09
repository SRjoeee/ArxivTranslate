// Text fingerprint for cache keys. Use code points via for…of, not charCodeAt(0): for supplementary characters,
// charCodeAt(0) returns only the high surrogate, making "😀" and "😁" collide (Codex #28).
export function hashText(text: string): string {
  let hash = 5381
  for (const ch of text) hash = ((hash * 33) ^ ch.codePointAt(0)!) >>> 0
  return hash.toString(36)
}
