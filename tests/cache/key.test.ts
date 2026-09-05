import { describe, expect, it } from 'vitest'
import { buildCacheKey, normalizeText, type CacheIdentity } from '@/cache/key'

const base: CacheIdentity = {
  providerId: 'openai-compat', model: 'm', promptVersion: '1', promptKey: 'default', context: { paperTitle: 'P', abstract: 'A' }, rulesVersion: '0.2.0', target: 'zh-CN', renderPath: 'markup',
  text: 'Hello <x id="1"/> world',
}

describe('normalizeText', () => {
  it('NFC、折叠所有空白、去首尾', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b')
    expect(normalizeText('é')).toBe('é')
    expect(normalizeText('a  b')).toBe('a b')
  })
})

describe('buildCacheKey', () => {
  it('64 位 hex 且稳定', async () => {
    const key = await buildCacheKey(base)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
    expect(await buildCacheKey({ ...base })).toBe(key)
  })

  it('文本归一化后相同则键相同', async () => {
    expect(await buildCacheKey({ ...base, text: '  Hello   <x id="1"/>\n world ' })).toBe(await buildCacheKey(base))
  })

  it('任一字段不同则键不同', async () => {
    const key = await buildCacheKey(base)
    const variants: Partial<CacheIdentity>[] = [
      { providerId: 'x' }, { model: 'x' }, { promptVersion: '2' }, { rulesVersion: '0.3.0' }, { target: 'ja' }, { renderPath: 'runs' }, { text: 'Hello <x id="2"/> world' },
    ]
    for (const v of variants) expect(await buildCacheKey({ ...base, ...v }), JSON.stringify(v)).not.toBe(key)
  })

  it('文本里的分隔符不会撞键', async () => {
    const a = await buildCacheKey({ ...base, model: 'm|x', text: 'y' })
    const b = await buildCacheKey({ ...base, model: 'm', text: 'x|y' })
    expect(a).not.toBe(b)
  })

  it('提示词指纹不同则键不同：换了提示词不能命中旧译文', async () => {
    const a = await buildCacheKey({ ...base, promptKey: 'default' })
    const b = await buildCacheKey({ ...base, promptKey: 'custom:abc' })
    expect(a).not.toBe(b)
  })

  it('上下文不同则键不同：同一段文字在另一篇论文 / 另一章里不能拿来命中（Codex 在 #28 指出）', async () => {
    const a = await buildCacheKey({ ...base, context: { paperTitle: 'P1', abstract: 'A' } })
    const b = await buildCacheKey({ ...base, context: { paperTitle: 'P2', abstract: 'A' } })
    expect(a).not.toBe(b)
    expect(await buildCacheKey({ ...base, context: undefined })).toBe(await buildCacheKey({ ...base, context: undefined }))
  })

  it('改一条术语的译法，键就变；空表与不带术语表同键（否则加表那一刻全部缓存失效）', async () => {
    const withA = await buildCacheKey({ ...base, context: { glossary: [{ term: 'weights', translation: '权重' }] } })
    const withB = await buildCacheKey({ ...base, context: { glossary: [{ term: 'weights', translation: '重量' }] } })
    expect(withA).not.toBe(withB)
    const empty = await buildCacheKey({ ...base, context: { glossary: [] } })
    expect(empty).toBe(await buildCacheKey({ ...base, context: {} }))
  })

  it('上下文以原文进 SHA-256 载荷，不先压成 32 位 hash：DJB2 相撞的两个标题也不同键（Codex 给的实例）', async () => {
    const a = await buildCacheKey({ ...base, context: { paperTitle: '19k04n01vcr73f' } })
    const b = await buildCacheKey({ ...base, context: { paperTitle: '1efm0uaep90s9' } })
    expect(a).not.toBe(b)
  })
})
