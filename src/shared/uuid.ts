// 移植自 reference/read-frog/src/utils/crypto-polyfill.ts@9b44f82（GPL-3.0），2026-09-05 移植、有修改：仅改名与文件头。
// 有 crypto.randomUUID 就用它；只暴露 getRandomValues 的环境（部分扩展上下文、非安全上下文）退回手写 UUIDv4。

function getCryptoWithRandomValues(): Crypto {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new TypeError('[uuid] crypto.getRandomValues is required but not available. This polyfill only works in browser environments.')
  }
  return crypto
}

/** 用 crypto.getRandomValues 生成 UUIDv4（非安全上下文也能用） */
export function generateUUIDv4(): string {
  const cryptoWithRandomValues = getCryptoWithRandomValues()
  const bytes = new Uint8Array(16)
  cryptoWithRandomValues.getRandomValues(bytes)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40 // Version 4: set bits 12-15 to 0100
  bytes[8] = (bytes[8]! & 0x3f) | 0x80 // Variant 1: set bits 6-7 to 10

  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
  // Format: xxxxxxxx-xxxx-4xxx-Nxxx-xxxxxxxxxxxx (8-4-4-4-12)
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20, 32)].join('-')
}

export function getRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return generateUUIDv4()
}
