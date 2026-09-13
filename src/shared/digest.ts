// The SHA-256 hex digest. Shared by the cache key (cache/key.ts) and the image bytes' imageHash (DESIGN §15.2); both
// sides are Web Crypto, so it runs in content / background / tests (tests/setup.ts wires node:crypto).
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes: BufferSource = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
