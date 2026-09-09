import { describe, expect, it } from 'vitest'
import { buildCacheKey, normalizeText, ocrCacheKey, type CacheIdentity } from '@/cache/key'

const base: CacheIdentity = {
  providerId: 'openai-compat', model: 'm', promptVersion: '1', promptKey: 'default', context: { paperTitle: 'P', abstract: 'A' }, rulesVersion: '0.2.0', target: 'zh-CN', renderPath: 'markup',
  text: 'Hello <x id="1"/> world',
}

describe('normalizeText', () => {
  it('normalizes NFC, collapses all whitespace, and trims', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b')
    expect(normalizeText('é')).toBe('é')
    expect(normalizeText('a  b')).toBe('a b')
  })
})

describe('buildCacheKey', () => {
  it('returns a stable 64-digit hex value', async () => {
    const key = await buildCacheKey(base)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await buildCacheKey({ ...base })).toBe(key)
  })

  it('equivalent normalized text produces the same key', async () => {
    expect(await buildCacheKey({ ...base, text: '  Hello   <x id="1"/>\n world ' })).toBe(await buildCacheKey(base))
  })

  it('changing any field changes the key', async () => {
    const key = await buildCacheKey(base)
    const variants: Partial<CacheIdentity>[] = [
      { providerId: 'x' }, { model: 'x' }, { promptVersion: '2' }, { rulesVersion: '0.3.0' }, { target: 'ja' }, { renderPath: 'runs' }, { text: 'Hello <x id="2"/> world' },
    ]
    for (const v of variants) expect(await buildCacheKey({ ...base, ...v }), JSON.stringify(v)).not.toBe(key)
  })

  it('delimiters in text do not cause key collisions', async () => {
    const a = await buildCacheKey({ ...base, model: 'm|x', text: 'y' })
    const b = await buildCacheKey({ ...base, model: 'm', text: 'x|y' })
    expect(a).not.toBe(b)
  })

  it('different prompt fingerprints produce different keys so new prompts cannot reuse old translations', async () => {
    const a = await buildCacheKey({ ...base, promptKey: 'default' })
    const b = await buildCacheKey({ ...base, promptKey: 'custom:abc' })
    expect(a).not.toBe(b)
  })

  it('different context changes the key so identical text in another paper or section cannot reuse a translation (Codex #28)', async () => {
    const a = await buildCacheKey({ ...base, context: { paperTitle: 'P1', abstract: 'A' } })
    const b = await buildCacheKey({ ...base, context: { paperTitle: 'P2', abstract: 'A' } })
    expect(a).not.toBe(b)
    expect(await buildCacheKey({ ...base, context: undefined })).toBe(await buildCacheKey({ ...base, context: undefined }))
  })

  it('changing a glossary translation changes the key; an empty glossary matches an omitted glossary without invalidating existing caches', async () => {
    const withA = await buildCacheKey({ ...base, context: { glossary: [{ term: 'weights', translation: '权重' }] } })
    const withB = await buildCacheKey({ ...base, context: { glossary: [{ term: 'weights', translation: '重量' }] } })
    expect(withA).not.toBe(withB)
    const empty = await buildCacheKey({ ...base, context: { glossary: [] } })
    expect(empty).toBe(await buildCacheKey({ ...base, context: {} }))
  })

  it('hashes original context with SHA-256 rather than a 32-bit hash: colliding DJB2 titles still get distinct keys (Codex example)', async () => {
    const a = await buildCacheKey({ ...base, context: { paperTitle: '19k04n01vcr73f' } })
    const b = await buildCacheKey({ ...base, context: { paperTitle: '1efm0uaep90s9' } })
    expect(a).not.toBe(b)
  })
})

describe('ocrCacheKey (DESIGN §15.2)', () => {
  it('depends only on the image byte hash and helper version, in a namespace separate from translations', async () => {
    const key = await ocrCacheKey('abc', '0.1.0')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await ocrCacheKey('abc', '0.1.0')).toBe(key)
    expect(await ocrCacheKey('abd', '0.1.0')).not.toBe(key)
    expect(await ocrCacheKey('abc', '0.2.0')).not.toBe(key)
    expect(await buildCacheKey({ ...base, text: 'abc' })).not.toBe(key)
  })
})
