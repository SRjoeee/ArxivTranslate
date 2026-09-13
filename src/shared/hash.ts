// The text fingerprint (part of the cache key). By code point rather than charCodeAt(0): for…of iterates code points,
// while charCodeAt(0) takes only the high surrogate of a supplementary character, and "😀" and "😁" would share a key (Codex on #28).
export function hashText(text: string): string {
  let hash = 5381
  for (const ch of text) hash = ((hash * 33) ^ ch.codePointAt(0)!) >>> 0
  return hash.toString(36)
}
