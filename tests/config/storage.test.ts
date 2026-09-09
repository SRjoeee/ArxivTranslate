import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { CONFIG_VERSION, DEFAULT_CONFIG, GLOSSARY_LIMITS, normalizeGlossary } from '@/config/schema'
import { configItem, getConfig, setConfig } from '@/config/storage'

describe('config storage', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('empty storage returns the default configuration', async () => {
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG.openaiCompat.apiKey).toBe('')
    expect(DEFAULT_CONFIG.openaiCompat.baseURL).toBe('https://openrouter.ai/api/v1')
  })

  it('reads back a written configuration', async () => {
    await setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'sk-test', model: 'x/y' }, targetLanguage: 'jpn' })
    const c = await getConfig()
    expect(c.openaiCompat.apiKey).toBe('sk-test')
    expect(c.openaiCompat.model).toBe('x/y')
    expect(c.targetLanguage).toBe('jpn')
  })

  it('fallback is explicit: a newer stored version explains that an older extension is installed (observed 2026-09-06)', async () => {
    // After WXT rejects a downgrade migration, getValue() returns the v8 object unchanged, which fails the schema version literal.
    await fakeBrowser.storage.local.set({ config: { ...DEFAULT_CONFIG, version: CONFIG_VERSION + 1 }, config$: { v: CONFIG_VERSION + 1 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toContain(`v${CONFIG_VERSION + 1}`)
    expect(fresh.configFallbackReason()).toContain('older version')
  })

  it('identifies the malformed field instead of reporting only an invalid configuration', async () => {
    await fakeBrowser.storage.local.set({ config: { ...DEFAULT_CONFIG, targetLanguage: 'nope' }, config$: { v: CONFIG_VERSION } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toContain('targetLanguage')
  })

  it('a valid configuration has no fallback reason and produces no false warning', async () => {
    vi.resetModules()
    const fresh = await import('@/config/storage')
    await fresh.setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'sk-ok' } })
    expect((await fresh.getConfig()).openaiCompat.apiKey).toBe('sk-ok')
    expect(fresh.configFallbackReason()).toBeNull()
  })

  it('defaults from empty storage are not a fallback and must not warn on first installation', async () => {
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toBeNull()
  })

  it('invalid stored data falls back to defaults', async () => {
    await configItem.setValue({ nonsense: true } as never)
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('setConfig rejects invalid values', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, model: '' } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, baseURL: 'not a url' } })).rejects.toThrow()
  })
})

describe('provider selection', () => {
  it('both providers can be stored and retrieved; getProvider returns the matching implementation', async () => {
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

  it('the schema rejects unknown providers', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, provider: 'nope' } as never)).rejects.toThrow()
  })

  it('migrates v1 to the latest version: adds prompt library and preload settings, converts language codes to ISO 639-3, and preserves API keys and other fields', async () => {
    // WXT migrates during defineItem, so write v1 data before reloading the module.
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

  it('migrates v2 to the latest version: adds Read Frog preload defaults (1000px / 0), maps zh-TW to cmn-Hant, and preserves other fields', async () => {
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

  it('migrates v3 to the latest version: maps zh-CN to cmn and falls back to cmn for unknown language codes', async () => {
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

  it('target language must be an ISO 639-3 code from the language table', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, targetLanguage: 'zh-CN' as never })).rejects.toThrow()
  })

  it('migrates v4 to v5: adds the fallback-chain switch, enabled by default', async () => {
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

  it('migrates v5 to v6: adds an empty glossary and preserves other fields', async () => {
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

  it('migrates v6 to v7: adds the none style default to preserve the previous appearance', async () => {
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

  it('normalizes oversized v6 glossaries during migration without affecting other fields or API keys (Codex #52)', async () => {
    // v6 imposed no entry or total length limits, so these values were valid; copying them into v7 would reject the whole configuration and restore defaults.
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

  it('Normalization drops only invalid entries and preserves every valid entry.', () => {
    const ok = Array.from({ length: 200 }, (_, i) => ({ term: `t${i}`, translation: `译${i}` }))
    expect(normalizeGlossary(ok)).toHaveLength(200)
    // Truncate entries beyond the count limit without discarding the whole glossary.
    expect(normalizeGlossary([...ok, { term: 'extra', translation: '多的' }])).toHaveLength(200)
    expect(normalizeGlossary('not an array')).toEqual([])
    expect(normalizeGlossary([{ term: 1, translation: '译' }, null, { term: 'a', translation: '甲' }])).toEqual([{ term: 'a', translation: '甲' }])
    // Total length limit: individually valid entries can exceed the total; truncate starting with the first excess entry.
    const long = Array.from({ length: 30 }, (_, i) => ({ term: `${i}`.padEnd(120, 'x'), translation: '译'.repeat(200) }))
    expect(normalizeGlossary(long).length).toBeLessThan(30)
    expect(normalizeGlossary(long).reduce((n, e) => n + e.term.length + e.translation.length, 0)).toBeLessThanOrEqual(GLOSSARY_LIMITS.totalChars)
  })

  it('migrates v7 to v8: enables image translation in all three modes by default and preserves other fields including API keys', async () => {
    const v7 = {
      version: 7, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      targetLanguage: 'cmn', mode: 'side', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: true }, glossary: [], style: { preset: 'quote', customCss: '' },
    }
    await fakeBrowser.storage.local.set({ config: v7, config$: { v: 7 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    const c = await fresh.getConfig()
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.image).toEqual({ modes: ['stack', 'side', 'only'] })
    expect(c.style).toEqual({ preset: 'quote', customCss: '' })
    expect(c.openaiCompat.apiKey).toBe('sk-keep')
  })

  it('image translation accepts only the three modes; an empty array is valid and disables it', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, image: { modes: ['split' as never] } })).rejects.toThrow()
    await setConfig({ ...DEFAULT_CONFIG, image: { modes: [] } })
    expect((await getConfig()).image.modes).toEqual([])
  })

  it('style preset IDs must be listed and custom CSS has a length limit', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, style: { preset: 'rainbow' as never, customCss: '' } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, style: { preset: 'custom', customCss: 'x'.repeat(2001) } })).rejects.toThrow()
  })

  it('the schema rejects glossaries over 200 entries and entries with missing fields', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ term: `t${i}`, translation: `译${i}` }))
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: many })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: '', translation: '空' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x', translation: '' }] })).rejects.toThrow()
  })

  it('enforces entry and total length limits, rejecting a whole document pasted as one entry (Codex #52)', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x'.repeat(121), translation: '译' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x', translation: '译'.repeat(201) }] })).rejects.toThrow()
    // 100 entries × 60 characters = 6000, exactly the limit; one more entry exceeds it.
    const at = Array.from({ length: 100 }, () => ({ term: 'a'.repeat(30), translation: '译'.repeat(30) }))
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: at })).resolves.toBeUndefined()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [...at, { term: 'a', translation: '译' }] })).rejects.toThrow()
  })

  it('fallback chain starts with the configured engine and ends with free engines; disabling fallback keeps only the configured engine', async () => {
    const { buildChain } = await import('@/providers')
    const withKey = { ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'sk-x' } }
    // Without the built-in translation API (happy-dom or old Chrome), isAvailable filters out the built-in engine.
    expect((await buildChain(withKey)).map(p => p.id)).toEqual(['openai-compat', 'google-web'])
    expect((await buildChain({ ...withKey, fallback: { enabled: false } })).map(p => p.id)).toEqual(['openai-compat'])
    // A preferred free engine is not duplicated.
    expect((await buildChain({ ...withKey, provider: 'google-web' })).map(p => p.id)).toEqual(['google-web'])
    // Keep a preferred engine with no API key at the head: the popup must direct users to settings instead of silently switching engines.
    expect((await buildChain(DEFAULT_CONFIG)).map(p => p.id)).toEqual(['openai-compat', 'google-web'])
  })

  it('a ready built-in language model precedes google-web; an unready one is skipped', async () => {
    const { buildChain } = await import('@/providers')
    const withKey = { ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'sk-x' } }
    const stub = (availability: string) => ({ availability: async () => availability, create: async () => ({ translate: async () => '' }) })

    vi.stubGlobal('Translator', stub('available'))
    expect((await buildChain(withKey)).map(p => p.id)).toEqual(['openai-compat', 'chrome-builtin', 'google-web'])
    // The preferred built-in engine is not duplicated in fallback.
    expect((await buildChain({ ...withKey, provider: 'chrome-builtin' })).map(p => p.id)).toEqual(['chrome-builtin', 'google-web'])

    vi.stubGlobal('Translator', stub('downloadable'))
    expect((await buildChain(withKey)).map(p => p.id)).toEqual(['openai-compat', 'google-web'])
    vi.unstubAllGlobals()
  })

  it('the schema rejects out-of-range preload settings', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: -1, threshold: 0 } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: 1000, threshold: 1.5 } })).rejects.toThrow()
  })
})
