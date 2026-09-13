import { describe, expect, it } from 'vitest'
import { buildCacheKey, cacheKeyFor, normalizeText, ocrCacheKey, wireFormatOf, type CacheIdentity, type RenderPath } from '@/cache/key'
import type { WireFormat } from '@/core/protector'

const base: CacheIdentity = {
  providerId: 'openai-compat', model: 'm', promptVersion: '1', promptKey: 'default', context: { paperTitle: 'P', abstract: 'A' }, rulesVersion: '0.2.0', target: 'zh-CN', renderPath: 'tags',
  text: 'Hello <x id="1"/> world',
}

describe('normalizeText', () => {
  it('NFC, all whitespace collapsed, trimmed', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b')
    expect(normalizeText('é')).toBe('é')
    expect(normalizeText('a  b')).toBe('a b')
  })
})

describe('buildCacheKey', () => {
  it('64 hex digits and stable', async () => {
    const key = await buildCacheKey(base)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await buildCacheKey({ ...base })).toBe(key)
  })

  it('texts equal after normalisation give equal keys', async () => {
    expect(await buildCacheKey({ ...base, text: '  Hello   <x id="1"/>\n world ' })).toBe(await buildCacheKey(base))
  })

  it('any field differing gives a different key', async () => {
    const key = await buildCacheKey(base)
    const variants: Partial<CacheIdentity>[] = [
      { providerId: 'x' }, { model: 'x' }, { promptVersion: '2' }, { rulesVersion: '0.3.0' }, { target: 'ja' }, { renderPath: 'runs' }, { text: 'Hello <x id="2"/> world' },
    ]
    for (const v of variants) expect(await buildCacheKey({ ...base, ...v }), JSON.stringify(v)).not.toBe(key)
  })

  it('separators inside the text cannot collide keys', async () => {
    const a = await buildCacheKey({ ...base, model: 'm|x', text: 'y' })
    const b = await buildCacheKey({ ...base, model: 'm', text: 'x|y' })
    expect(a).not.toBe(b)
  })

  it('a different prompt fingerprint gives a different key: a changed prompt must not hit the old translation', async () => {
    const a = await buildCacheKey({ ...base, promptKey: 'default' })
    const b = await buildCacheKey({ ...base, promptKey: 'custom:abc' })
    expect(a).not.toBe(b)
  })

  it('a different context gives a different key: the same passage in another paper / another section must not hit (Codex on #28)', async () => {
    const a = await buildCacheKey({ ...base, context: { paperTitle: 'P1', abstract: 'A' } })
    const b = await buildCacheKey({ ...base, context: { paperTitle: 'P2', abstract: 'A' } })
    expect(a).not.toBe(b)
    expect(await buildCacheKey({ ...base, context: undefined })).toBe(await buildCacheKey({ ...base, context: undefined }))
  })

  it('changing one term\'s translation changes the key; an empty table and no table share a key (or adding a table would void the whole cache at once)', async () => {
    const withA = await buildCacheKey({ ...base, context: { glossary: [{ term: 'weights', translation: '权重' }] } })
    const withB = await buildCacheKey({ ...base, context: { glossary: [{ term: 'weights', translation: '重量' }] } })
    expect(withA).not.toBe(withB)
    const empty = await buildCacheKey({ ...base, context: { glossary: [] } })
    expect(empty).toBe(await buildCacheKey({ ...base, context: {} }))
  })

  it('the context enters the SHA-256 payload as source text, not squeezed into a 32-bit hash first: two titles with a DJB2 collision get different keys too (the instance Codex gave)', async () => {
    const a = await buildCacheKey({ ...base, context: { paperTitle: '19k04n01vcr73f' } })
    const b = await buildCacheKey({ ...base, context: { paperTitle: '1efm0uaep90s9' } })
    expect(a).not.toBe(b)
  })
})

describe('ocrCacheKey (DESIGN §15.2)', () => {
  it('varies with the image bytes\' hash and the helper version only; does not overlap the translation key space', async () => {
    const key = await ocrCacheKey('abc', '0.1.0')
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await ocrCacheKey('abc', '0.1.0')).toBe(key)
    expect(await ocrCacheKey('abd', '0.1.0')).not.toBe(key)
    expect(await ocrCacheKey('abc', '0.2.0')).not.toBe(key)
    expect(await buildCacheKey({ ...base, text: 'abc' })).not.toBe(key)
  })
})

describe('renderPath enters the key (#104)', () => {
  // Most blocks have different wire text under the two formats anyway (markers are shorter, paired placeholders flattened), so the keys separate by themselves;
  // but a plain-text block without placeholders reads exactly the same on both sides, and then only renderPath can tell them apart.
  // The batch key uses the same field (translate-service's batchKey), so segments of the two formats are not gathered into one batch
  it('the same placeholder-free source gives three different keys on the three paths', async () => {
    const base = { providerId: 'p', model: 'm', promptKey: '', target: 'zh-CN', text: 'Hello world.' }
    const keys = await Promise.all((['tags', 'markers', 'runs'] as const).map(renderPath => cacheKeyFor({ ...base, renderPath })))
    expect(new Set(keys).size).toBe(3)
  })

  it('wireFormatOf has one real thing left: runs escapes as tags, the rest as it is (#108)', () => {
    // Before the rename it also did “markup ↔ tags renaming”, two sets of names for one thing;
    // now RenderPath = WireFormat | 'runs', the same-named part is the identity, and only runs has to land on a format
    expect(wireFormatOf('markers')).toBe('markers')
    expect(wireFormatOf('tags')).toBe('tags')
    expect(wireFormatOf('runs')).toBe('tags')
  })

  it('RenderPath and WireFormat share names: serialize takes renderPath directly, no renaming first (#108)', () => {
    // This pins the type relation, not a runtime value: the two formats' values must be identical character for character,
    // or the “a new call site with one wrong literal” trap comes back
    const asWire: WireFormat[] = ['tags', 'markers']
    const asPath: RenderPath[] = [...asWire, 'runs']
    expect(asPath).toEqual(['tags', 'markers', 'runs'])
  })
})

describe('why whitespace collapsing had to bump CACHE_KEY_VERSION (#122)', () => {
  it('text with hard line breaks and the collapsed text compute the same key — so the old bad translations would not expire by themselves', async () => {
    // Before #119 a request with line breaks made Microsoft translate line by line (state explosion → 「州级爆炸性质」).
    // On the key side normalizeText collapsed whitespace long ago, so the two texts **collide**: with collapsing live,
    // blocks translated already would hit the same old record and keep returning the bad translation for the 30-day TTL, the fix never reaching them.
    // Bumping CACHE_KEY_VERSION is the only way to void them — this case pins exactly that collision
    const withNewlines = 'Automatic verification faces state\nexplosion due to\nthe interleavings.'
    const collapsed = withNewlines.replace(/[\t\n\f\r ]+/g, ' ')
    expect(withNewlines).not.toBe(collapsed)
    const identity = { providerId: 'microsoft', model: '', promptKey: '', target: 'cmn', renderPath: 'markers' as const }
    const [a, b] = await Promise.all([
      cacheKeyFor({ ...identity, text: withNewlines }),
      cacheKeyFor({ ...identity, text: collapsed }),
    ])
    expect(a).toBe(b)
  })
})
