import { describe, expect, it } from 'vitest'
import { sha256Hex } from '@/shared/digest'

describe('sha256Hex', () => {
  it('a string and its UTF-8 bytes hash alike, 64 hex digits', async () => {
    const text = 'Static charge — 静态电荷'
    const fromText = await sha256Hex(text)
    expect(fromText).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256Hex(new TextEncoder().encode(text))).toBe(fromText)
    expect(await sha256Hex(new TextEncoder().encode(text).buffer as ArrayBuffer)).toBe(fromText)
  })

  it('a known vector: the empty string', async () => {
    expect(await sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
  })
})
