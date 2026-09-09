// Hexadecimal SHA-256 digest shared by cache/key.ts and image-byte imageHash (DESIGN §15.2).
// Web Crypto runs in content, background and tests (tests/setup.ts supplies node:crypto).
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes: BufferSource = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
