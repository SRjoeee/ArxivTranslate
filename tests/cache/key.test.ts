import { describe, expect, it } from 'vitest'
import { buildCacheKey, contextKey, normalizeText, type CacheIdentity } from '@/cache/key'

const base: CacheIdentity = {
  providerId: 'openai-compat', model: 'm', promptVersion: '1', promptKey: 'default', contextKey: 'c1', rulesVersion: '0.2.0', target: 'zh-CN', renderPath: 'markup',
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

  it('上下文指纹不同则键不同：同一段文字在另一篇论文 / 另一章里不能拿来命中（Codex 在 #28 指出）', async () => {
    const a = await buildCacheKey({ ...base, contextKey: contextKey({ paperTitle: 'P1', abstract: 'A' }) })
    const b = await buildCacheKey({ ...base, contextKey: contextKey({ paperTitle: 'P2', abstract: 'A' }) })
    expect(a).not.toBe(b)
    expect(contextKey(undefined)).toBe('')
    expect(contextKey({ paperTitle: 'P', sectionTitle: 'S' })).toBe(contextKey({ paperTitle: 'P', sectionTitle: 'S' }))
  })
})
