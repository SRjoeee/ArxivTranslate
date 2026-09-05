import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { CONFIG_VERSION, DEFAULT_CONFIG, GLOSSARY_LIMITS, normalizeGlossary } from '@/config/schema'
import { configItem, getConfig, setConfig } from '@/config/storage'

describe('config storage', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('空存储返回默认配置', async () => {
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG.openaiCompat.apiKey).toBe('')
    expect(DEFAULT_CONFIG.openaiCompat.baseURL).toBe('https://openrouter.ai/api/v1')
  })

  it('写入后读回', async () => {
    await setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'sk-test', model: 'x/y' }, targetLanguage: 'jpn' })
    const c = await getConfig()
    expect(c.openaiCompat.apiKey).toBe('sk-test')
    expect(c.openaiCompat.model).toBe('x/y')
    expect(c.targetLanguage).toBe('jpn')
  })

  it('存储里是坏数据时回退默认', async () => {
    await configItem.setValue({ nonsense: true } as never)
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('setConfig 拒绝非法值', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, model: '' } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, baseURL: 'not a url' } })).rejects.toThrow()
  })
})

describe('provider 选择', () => {
  it('两个 provider 都能存取，getProvider 返回对应实现', async () => {
    const { getProvider } = await import('@/providers')
    const llm = getProvider({ ...DEFAULT_CONFIG, provider: 'openai-compat' })
    expect(llm.id).toBe('openai-compat')
    expect(llm.kind).toBe('llm')

    const free = getProvider({ ...DEFAULT_CONFIG, provider: 'google-web' })
    expect(free.id).toBe('google-web')
    expect(free.kind).toBe('mt')
    expect(free.preservesMarkup).toBe(true)
    expect(await free.isAvailable()).toBe(true)

    await setConfig({ ...DEFAULT_CONFIG, provider: 'google-web' })
    expect((await getConfig()).provider).toBe('google-web')
  })

  it('未知 provider 被 schema 拒绝', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, provider: 'nope' } as never)).rejects.toThrow()
  })

  it('v1 配置一路升到最新：补上提示词库与预翻译范围、语言码换成 ISO 639-3，API key 与其他字段原样保留', async () => {
    // WXT 在 defineItem 时就跑迁移，所以要先写入 v1 数据再重新加载模块
    const v1 = {
      version: 1, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      targetLanguage: 'ja', mode: 'side',
    }
    await fakeBrowser.storage.local.set({ config: v1, config$: { v: 1 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    const c = await fresh.getConfig()
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.openaiCompat.apiKey).toBe('sk-keep')
    expect(c.targetLanguage).toBe('jpn')
    expect(c.prompts).toEqual({ promptId: 'default', patterns: [] })
    expect(c.preload).toEqual({ margin: 1000, threshold: 0 })
  })

  it('v2 配置升级到最新：补上预翻译范围（Read Frog 默认 1000px / 0）、zh-TW 变 cmn-Hant，其余原样', async () => {
    const v2 = {
      version: 2, provider: 'google-web',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: '', model: 'x/y', thinking: 'enabled' },
      targetLanguage: 'zh-TW', mode: 'only', prompts: { promptId: 'precision-rewrite', patterns: [] },
    }
    await fakeBrowser.storage.local.set({ config: v2, config$: { v: 2 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    const c = await fresh.getConfig()
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.targetLanguage).toBe('cmn-Hant')
    expect(c.preload).toEqual({ margin: 1000, threshold: 0 })
    expect(c.prompts.promptId).toBe('precision-rewrite')
    expect(c.mode).toBe('only')
    expect(c.openaiCompat.thinking).toBe('enabled')
  })

  it('v3 配置升级到最新：zh-CN 变 cmn，认不出的语言码回退 cmn', async () => {
    const base = {
      version: 3, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      mode: 'stack', prompts: { promptId: 'default', patterns: [] }, preload: { margin: 300, threshold: 0.5 },
    }
    for (const [stored, expected] of [['zh-CN', 'cmn'], ['en', 'eng'], ['xx-YY', 'cmn']]) {
      fakeBrowser.reset()
      await fakeBrowser.storage.local.set({ config: { ...base, targetLanguage: stored }, config$: { v: 3 } })
      vi.resetModules()
      const fresh = await import('@/config/storage')
      const c = await fresh.getConfig()
      expect(c.version).toBe(CONFIG_VERSION)
      expect(c.targetLanguage).toBe(expected)
      expect(c.openaiCompat.apiKey).toBe('sk-keep')
      expect(c.preload).toEqual({ margin: 300, threshold: 0.5 })
    }
  })

  it('目标语言必须是语言表里的 ISO 639-3 码', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, targetLanguage: 'zh-CN' as never })).rejects.toThrow()
  })

  it('v4 配置升级到 v5：补上降级链开关，默认开启', async () => {
    const v4 = {
      version: 4, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      targetLanguage: 'jpn', mode: 'side', prompts: { promptId: 'default', patterns: [] }, preload: { margin: 1000, threshold: 0 },
    }
    await fakeBrowser.storage.local.set({ config: v4, config$: { v: 4 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    const c = await fresh.getConfig()
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.fallback).toEqual({ enabled: true })
    expect(c.openaiCompat.apiKey).toBe('sk-keep')
    expect(c.targetLanguage).toBe('jpn')
  })

  it('v5 配置升级到 v6：补上空术语表，其余原样', async () => {
    const v5 = {
      version: 5, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      targetLanguage: 'jpn', mode: 'side', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: false },
    }
    await fakeBrowser.storage.local.set({ config: v5, config$: { v: 5 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    const c = await fresh.getConfig()
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.glossary).toEqual([])
    expect(c.fallback).toEqual({ enabled: false })
    expect(c.openaiCompat.apiKey).toBe('sk-keep')
  })

  it('v6 配置升级到 v7：补上默认样式（none，与实现之前的外观一致）', async () => {
    const v6 = {
      version: 6, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      targetLanguage: 'cmn', mode: 'stack', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: true }, glossary: [{ term: 'weights', translation: '权重' }],
    }
    await fakeBrowser.storage.local.set({ config: v6, config$: { v: 6 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    const c = await fresh.getConfig()
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.style).toEqual({ preset: 'none', customCss: '' })
    expect(c.glossary).toEqual([{ term: 'weights', translation: '权重' }])
  })

  it('v6 里超限的术语表在迁移时被规整，配置的其余部分（含 API key）不受牵连（Codex 在 #52 指出）', async () => {
    // v6 没有单条与总长限额，这些值当时是合法的；照抄进 v7 会让整份配置校验失败、回退默认值
    const v6 = {
      version: 6, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      targetLanguage: 'cmn', mode: 'stack', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: true },
      glossary: [
        { term: 'weights', translation: '权重' },
        { term: 'x'.repeat(500), translation: '整篇文档被当成一条粘了进来' },
        { term: 'bias', translation: '偏'.repeat(500) },
      ],
    }
    await fakeBrowser.storage.local.set({ config: v6, config$: { v: 6 } })
    vi.resetModules()
    const c = await (await import('@/config/storage')).getConfig()
    expect(c.openaiCompat.apiKey).toBe('sk-keep')
    expect(c.glossary).toEqual([{ term: 'weights', translation: '权重' }])
  })

  it('规整只丢不合法的条目，合法的一条不少', () => {
    const ok = Array.from({ length: 200 }, (_, i) => ({ term: `t${i}`, translation: `译${i}` }))
    expect(normalizeGlossary(ok)).toHaveLength(200)
    // 超出条数上限的截断，不是整表作废
    expect(normalizeGlossary([...ok, { term: 'extra', translation: '多的' }])).toHaveLength(200)
    expect(normalizeGlossary('不是数组')).toEqual([])
    expect(normalizeGlossary([{ term: 1, translation: '译' }, null, { term: 'a', translation: '甲' }])).toEqual([{ term: 'a', translation: '甲' }])
    // 总长上限：单条都合法但加起来超了，从超出的那条起截断
    const long = Array.from({ length: 30 }, (_, i) => ({ term: `${i}`.padEnd(120, 'x'), translation: '译'.repeat(200) }))
    expect(normalizeGlossary(long).length).toBeLessThan(30)
    expect(normalizeGlossary(long).reduce((n, e) => n + e.term.length + e.translation.length, 0)).toBeLessThanOrEqual(GLOSSARY_LIMITS.totalChars)
  })

  it('样式预设只认清单里的 id，自定义 CSS 有长度上限', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, style: { preset: 'rainbow' as never, customCss: '' } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, style: { preset: 'custom', customCss: 'x'.repeat(2001) } })).rejects.toThrow()
  })

  it('术语表超过 200 条被 schema 拒绝，条目缺字段也拒绝', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ term: `t${i}`, translation: `译${i}` }))
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: many })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: '', translation: '空' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x', translation: '' }] })).rejects.toThrow()
  })

  it('单条与总长都有上限：整篇文档被当成一条粘进来要拒掉（Codex 在 #52 指出）', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x'.repeat(121), translation: '译' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x', translation: '译'.repeat(201) }] })).rejects.toThrow()
    // 100 条 × 每条 60 字符 = 6000，正好在线上；再多一条就超
    const at = Array.from({ length: 100 }, () => ({ term: 'a'.repeat(30), translation: '译'.repeat(30) }))
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: at })).resolves.toBeUndefined()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [...at, { term: 'a', translation: '译' }] })).rejects.toThrow()
  })

  it('降级链：配置引擎在前，免费引擎兜底；关掉开关时只剩配置的那个', async () => {
    const { buildChain } = await import('@/providers')
    const withKey = { ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'sk-x' } }
    expect((await buildChain(withKey)).map(p => p.id)).toEqual(['openai-compat', 'google-web'])
    expect((await buildChain({ ...withKey, fallback: { enabled: false } })).map(p => p.id)).toEqual(['openai-compat'])
    // 免费引擎自己当首选时不重复出现
    expect((await buildChain({ ...withKey, provider: 'google-web' })).map(p => p.id)).toEqual(['google-web'])
    // 首选没配 key 也留在链首：popup 要据此提示去设置页，而不是悄悄换引擎
    expect((await buildChain(DEFAULT_CONFIG)).map(p => p.id)).toEqual(['openai-compat', 'google-web'])
  })

  it('预翻译范围越界被 schema 拒绝', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: -1, threshold: 0 } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: 1000, threshold: 1.5 } })).rejects.toThrow()
  })
})
