// SHA-256 的十六进制摘要。缓存键（cache/key.ts）与图片字节的 imageHash（DESIGN §15.2）共用这一份，
// 两边都是 Web Crypto，content / background / 测试（tests/setup.ts 接了 node:crypto）都能跑。
export async function sha256Hex(data: string | ArrayBuffer | Uint8Array<ArrayBuffer>): Promise<string> {
  const bytes: BufferSource = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
