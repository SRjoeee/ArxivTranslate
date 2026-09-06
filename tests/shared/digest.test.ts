import { describe, expect, it } from 'vitest'
import { sha256Hex } from '@/shared/digest'

describe('sha256Hex', () => {
  it('字符串与它的 UTF-8 字节同值，且是 64 位 hex', async () => {
    const text = 'Static charge — 静态电荷'
    const fromText = await sha256Hex(text)
    expect(fromText).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256Hex(new TextEncoder().encode(text))).toBe(fromText)
    expect(await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer)).toBe(fromText)
  })

  it('已知向量：空串', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
