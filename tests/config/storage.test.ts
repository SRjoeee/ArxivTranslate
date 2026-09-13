import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { CONFIG_VERSION, DEFAULT_CONFIG, GLOSSARY_LIMITS, normalizeGlossary } from '@/config/schema'
import { configItem, getConfig, setConfig } from '@/config/storage'

/** A reader-added service, the shape v12 stores (spec §2.1) */
const SVC = { id: 'svc-abcd1234', kind: 'openai-compat' as const, name: 'Mine', baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-x', model: 'x/y', thinking: 'disabled' as const }

describe('config storage', () => {
  beforeEach(() => {
    fakeBrowser.reset()
  })

  it('empty storage returns the default configuration', async () => {
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG.services).toEqual([])
    expect(DEFAULT_CONFIG.provider).toBe('microsoft')
  })

  it('reads back what was written', async () => {
    await setConfig({ ...DEFAULT_CONFIG, provider: SVC.id, services: [{ ...SVC, apiKey: 'sk-test' }], targetLanguage: 'jpn' })
    const c = await getConfig()
    expect(c.services[0]?.apiKey).toBe('sk-test')
    expect(c.services[0]?.model).toBe('x/y')
    expect(c.targetLanguage).toBe('jpn')
  })

  it('the fallback is not silent: a version newer than the extension says plainly that an older build is installed (met 2026-09-06)', async () => {
    // After WXT refuses the downgrade migration getValue() returns the v8 object as it is, and the schema's version literal does not match
    await fakeBrowser.storage.local.set({ config: { ...DEFAULT_CONFIG, version: CONFIG_VERSION + 1 }, config$: { v: CONFIG_VERSION + 1 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    // Returned is the cause, not a sentence: the sentence is written in the interface language (UI.md §6)
    expect(fresh.configFallbackReason()).toEqual({ kind: 'tooNew', stored: CONFIG_VERSION + 1, supported: CONFIG_VERSION })
  })

  it('a broken structure names the field, not just “invalid”', async () => {
    await fakeBrowser.storage.local.set({ config: { ...DEFAULT_CONFIG, targetLanguage: 'nope' }, config$: { v: CONFIG_VERSION } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toMatchObject({ kind: 'invalid', where: 'targetLanguage' })
  })

  it('a sound configuration leaves no fallback reason: no alarm over a good configuration', async () => {
    vi.resetModules()
    const fresh = await import('@/config/storage')
    await fresh.setConfig({ ...DEFAULT_CONFIG, services: [{ ...SVC, apiKey: 'sk-ok' }] })
    expect((await fresh.getConfig()).services[0]?.apiKey).toBe('sk-ok')
    expect(fresh.configFallbackReason()).toBeNull()
  })

  it('empty storage reading the defaults is no fallback either (a first install must not alarm)', async () => {
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toBeNull()
  })

  it('bad data in storage falls back to the defaults', async () => {
    await configItem.setValue({ nonsense: true } as never)
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('setConfig refuses an invalid value', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, services: [{ ...SVC, model: '' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, services: [{ ...SVC, baseURL: 'not a url' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, provider: 'svc-nope' })).rejects.toThrow()
  })
})

describe('provider selection', () => {
  it('both providers can be stored and read, getProvider returns the matching implementation', async () => {
    const { getProvider } = await import('@/providers')
    // A reader's service becomes an engine carrying that service's id and name
    const llm = getProvider({ ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] })
    expect(llm.id).toBe(SVC.id)
    expect(llm.kind).toBe('llm')
    // A service the reader deleted while it was chosen: the shipped default, not a crash
    expect(getProvider({ ...DEFAULT_CONFIG, provider: 'svc-gone0000', services: [] }).id).toBe('microsoft')

    const free = getProvider({ ...DEFAULT_CONFIG, provider: 'google-web' })
    expect(free.id).toBe('google-web')
    expect(free.kind).toBe('mt')
    expect(free.wireFormats).toEqual(['tags', 'markers'])
    expect(await free.isAvailable()).toBe(true)

    await setConfig({ ...DEFAULT_CONFIG, provider: 'google-web' })
    expect((await getConfig()).provider).toBe('google-web')
  })

  it('an unknown provider is refused by the schema', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, provider: 'nope' } as never)).rejects.toThrow()
  })

  it('a v1 configuration climbs all the way to the latest: the prompt library and the preload range added, the language code converted to ISO 639-3, the API key and the other fields kept as they were', async () => {
    // WXT runs the migrations at defineItem time, so the v1 data is written first and the module reloaded
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
    expect(c.targetLanguage).toBe('jpn')
    expect(c.prompts).toEqual({ promptId: 'default', patterns: [] })
    expect(c.preload).toEqual({ margin: 1000, threshold: 0 })
  })

  it('a v2 configuration upgrades to the latest: the preload range added (Read Frog\'s default 1000px / 0), zh-TW becomes cmn-Hant, the rest as it was', async () => {
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
    expect(c.services[0]?.thinking).toBe('enabled')
  })

  it('a v3 configuration upgrades to the latest: zh-CN becomes cmn, an unrecognised language code falls back to cmn', async () => {
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
      expect(c.services[0]?.apiKey).toBe('sk-keep')
      expect(c.preload).toEqual({ margin: 300, threshold: 0.5 })
    }
  })

  it('the target language must be an ISO 639-3 code from the language table', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, targetLanguage: 'zh-CN' as never })).rejects.toThrow()
  })

  it('a v4 configuration upgrades to v5: the fallback chain switch added, on by default', async () => {
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
    expect(c.targetLanguage).toBe('jpn')
  })

  it('a v5 configuration upgrades to v6: an empty glossary added, the rest as it was', async () => {
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
  })

  it('a v6 configuration upgrades to v7: the default style added (none, the appearance as before the feature)', async () => {
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
    expect(c.appearance.activeStyle).toBe('follow')
    expect(c.glossary).toEqual([{ term: 'weights', translation: '权重' }])
  })

  it('an over-limit glossary in v6 is tidied by the migration, and the rest of the configuration (API key included) is not dragged down (Codex on #52)', async () => {
    // v6 had no per-entry or total limit, so these values were valid then; copied into v7 as they were, the whole configuration would fail validation and fall back to the defaults
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
    expect(c.glossary).toEqual([{ term: 'weights', translation: '权重' }])
  })

  it('tidying drops only the invalid entries, not one valid entry lost', () => {
    const ok = Array.from({ length: 200 }, (_, i) => ({ term: `t${i}`, translation: `译${i}` }))
    expect(normalizeGlossary(ok)).toHaveLength(200)
    // Beyond the entry cap it truncates rather than voiding the whole table
    expect(normalizeGlossary([...ok, { term: 'extra', translation: '多的' }])).toHaveLength(200)
    expect(normalizeGlossary('不是数组')).toEqual([])
    expect(normalizeGlossary([{ term: 1, translation: '译' }, null, { term: 'a', translation: '甲' }])).toEqual([{ term: 'a', translation: '甲' }])
    // The total cap: every entry valid on its own but too long together, truncated from the entry that goes over
    const long = Array.from({ length: 30 }, (_, i) => ({ term: `${i}`.padEnd(120, 'x'), translation: '译'.repeat(200) }))
    expect(normalizeGlossary(long).length).toBeLessThan(30)
    expect(normalizeGlossary(long).reduce((n, e) => n + e.term.length + e.translation.length, 0)).toBeLessThanOrEqual(GLOSSARY_LIMITS.totalChars)
  })

  it('a v7 configuration upgrades to v8: the image translation\'s mode gate added (all three on by default), the rest with the API key as it was', async () => {
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
    expect(c.image).toEqual({ enabled: true, modes: ['stack', 'side', 'only'] })
    // `quote` is one of the effects v12 dropped: the colour and opacity survive on “Same as the original”
    expect(c.appearance.activeStyle).toBe('follow')
    expect(c.services[0]?.apiKey).toBe('sk-keep')
  })

  it('v11 to v12: the single endpoint becomes a service and is chosen; presets map to profiles', async () => {
    const v11 = (over: object) => ({
      version: 11, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'deepseek/deepseek-v4-flash', thinking: 'disabled' },
      targetLanguage: 'cmn', mode: 'side', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: true }, glossary: [],
      style: { preset: 'none', customCss: '', color: '', opacity: 1, accent: '' }, reading: { sentenceHighlight: true }, image: { enabled: true, modes: ['stack', 'side', 'only'] },
      ...over,
    })
    const load = async (stored: object) => {
      await fakeBrowser.storage.local.set({ config: stored, config$: { v: 11 } })
      vi.resetModules()
      return (await import('@/config/storage')).getConfig()
    }
    const c = await load(v11({}))
    expect(c.version).toBe(CONFIG_VERSION)
    expect(c.services).toHaveLength(1)
    expect(c.services[0]).toMatchObject({ kind: 'openai-compat', name: 'deepseek-v4-flash', apiKey: 'sk-keep', model: 'deepseek/deepseek-v4-flash' })
    expect(c.provider).toBe(c.services[0]!.id)
    expect(c.appearance.activeStyle).toBe('follow')
    expect(c.appearance.activeHighlight).toBe('soft-green')
    // Another provider with the endpoint untouched: no service
    const free = await load(v11({ provider: 'microsoft', openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: '', model: 'deepseek/deepseek-v4-flash', thinking: 'disabled' } }))
    expect(free.services).toEqual([])
    expect(free.provider).toBe('microsoft')
    // Presets
    const dashed = await load(v11({ style: { preset: 'dashed-bold', customCss: '', color: '#112233', opacity: 0.8, accent: '' } }))
    expect(dashed.appearance.styles.find(s => s.id === dashed.appearance.activeStyle)).toMatchObject({ underline: 'dashed', thickness: 2, color: '#112233', opacity: 0.8 })
    const blur = await load(v11({ style: { preset: 'blur', customCss: '', color: '', opacity: 1, accent: '' } }))
    expect(blur.appearance.activeStyle).toBe('blur')
    const custom = await load(v11({ style: { preset: 'custom', customCss: 'font-style: italic', color: '', opacity: 1, accent: '' } }))
    expect(custom.appearance.styles.find(s => s.id === custom.appearance.activeStyle)).toMatchObject({ name: '自定义', css: 'font-style: italic' })
    const marker = await load(v11({ style: { preset: 'marker', customCss: '', color: '', opacity: 1, accent: '#ff8800' } }))
    expect(marker.appearance.activeStyle).toBe('follow')
    expect(marker.appearance.highlights.find(h => h.id === marker.appearance.activeHighlight)).toMatchObject({ color: '#ff8800', opacity: 0.22 })
  })

  it('v11 to v12: a model name longer than the schema allows is clipped, not left to invalidate the config', async () => {
    const long = `vendor/${'m'.repeat(80)}`
    await fakeBrowser.storage.local.set({ config: {
      version: 11, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: long, thinking: 'disabled' },
      targetLanguage: 'cmn', mode: 'side', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: true }, glossary: [],
      style: { preset: 'none', customCss: '', color: '', opacity: 1, accent: '' }, reading: { sentenceHighlight: true }, image: { enabled: true, modes: ['stack'] },
    }, config$: { v: 11 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    const c = await fresh.getConfig()
    // The reader's key and endpoint survive: the config did not fall back to defaults
    expect(fresh.configFallbackReason()).toBeNull()
    expect(c.services[0]?.apiKey).toBe('sk-keep')
    expect(c.services[0]?.model).toBe(long)
    expect(c.services[0]?.name.length).toBeLessThanOrEqual(40)
  })

  it('the image translation modes accept the three only, an empty array is valid (= off)', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, image: { enabled: true, modes: ['split' as never] } })).rejects.toThrow()
    await setConfig({ ...DEFAULT_CONFIG, image: { enabled: true, modes: [] } })
    expect((await getConfig()).image.modes).toEqual([])
  })

  it('v10 to v11: the image switch is derived from the mode list, on when any mode was ticked, off when none', async () => {
    const v10 = (modes: string[]) => ({
      version: 10, provider: 'openai-compat',
      openaiCompat: { baseURL: 'https://openrouter.ai/api/v1', apiKey: 'sk-keep', model: 'x/y', thinking: 'disabled' },
      targetLanguage: 'cmn', mode: 'side', prompts: { promptId: 'default', patterns: [] },
      preload: { margin: 1000, threshold: 0 }, fallback: { enabled: true }, glossary: [],
      style: { preset: 'quote', customCss: '', color: '', opacity: 1, accent: '' }, reading: { sentenceHighlight: true }, image: { modes },
    })
    for (const [modes, enabled] of [[['stack', 'only'], true], [[], false]] as const) {
      await fakeBrowser.storage.local.set({ config: v10([...modes]), config$: { v: 10 } })
      vi.resetModules()
      const fresh = await import('@/config/storage')
      const c = await fresh.getConfig()
      expect(c.version).toBe(CONFIG_VERSION)
      expect(c.image).toEqual({ enabled, modes })
      expect(c.services[0]?.apiKey).toBe('sk-keep')
    }
  })

  it('the style preset accepts only the ids on the list, and the custom CSS has a length cap', async () => {
    const a = DEFAULT_CONFIG.appearance
    await expect(setConfig({ ...DEFAULT_CONFIG, appearance: { ...a, styles: [{ ...a.styles[0]!, underline: 'rainbow' as never }] } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, appearance: { ...a, styles: [{ ...a.styles[0]!, css: 'x'.repeat(2001) }] } })).rejects.toThrow()
  })

  it('a glossary over 200 entries is refused by the schema, an entry missing a field too', async () => {
    const many = Array.from({ length: 201 }, (_, i) => ({ term: `t${i}`, translation: `译${i}` }))
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: many })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: '', translation: '空' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x', translation: '' }] })).rejects.toThrow()
  })

  it('both the entry and the total have caps: a whole document pasted in as one entry must be refused (Codex on #52)', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x'.repeat(121), translation: '译' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [{ term: 'x', translation: '译'.repeat(201) }] })).rejects.toThrow()
    // 100 entries × 60 characters each = 6000, right on the line; one more goes over
    const at = Array.from({ length: 100 }, () => ({ term: 'a'.repeat(30), translation: '译'.repeat(30) }))
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: at })).resolves.toBeUndefined()
    await expect(setConfig({ ...DEFAULT_CONFIG, glossary: [...at, { term: 'a', translation: '译' }] })).rejects.toThrow()
  })

  it('the fallback chain: the configured engine first, the free engines behind it; with the switch off only the configured one remains', async () => {
    const { buildChain } = await import('@/providers')
    const withKey = { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] }
    // An environment without the built-in translation API (happy-dom, an old Chrome): the built-in engine is filtered out by isAvailable
    expect((await buildChain(withKey)).chain.map(p => p.id)).toEqual([SVC.id, 'google-web'])
    expect((await buildChain({ ...withKey, fallback: { enabled: false } })).chain.map(p => p.id)).toEqual([SVC.id])
    // A free engine as the first choice does not appear twice
    expect((await buildChain({ ...withKey, provider: 'google-web' })).chain.map(p => p.id)).toEqual(['google-web'])
    // A first choice without a key stays at the head of the chain: the popup points to the settings page by it rather than swapping the engine quietly
    expect((await buildChain({ ...DEFAULT_CONFIG, provider: SVC.id, services: [{ ...SVC, apiKey: '' }] })).chain.map(p => p.id)).toEqual([SVC.id, 'google-web'])
    // The shipped default is the free service that needs no key (UI.md §2)
    expect((await buildChain(DEFAULT_CONFIG)).chain.map(p => p.id)).toEqual(['microsoft', 'google-web'])
  })

  it('with the language pack ready the built-in engine comes before google-web; not ready, it is skipped', async () => {
    const { buildChain } = await import('@/providers')
    const withKey = { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] }
    const stub = (availability: string) => ({ availability: async () => availability, create: async () => ({ translate: async () => '' }) })

    vi.stubGlobal('Translator', stub('available'))
    expect((await buildChain(withKey)).chain.map(p => p.id)).toEqual([SVC.id, 'chrome-builtin', 'google-web'])
    // The built-in as the first choice does not appear again in the fallback
    expect((await buildChain({ ...withKey, provider: 'chrome-builtin' })).chain.map(p => p.id)).toEqual(['chrome-builtin', 'google-web'])

    vi.stubGlobal('Translator', stub('downloadable'))
    expect((await buildChain(withKey)).chain.map(p => p.id)).toEqual([SVC.id, 'google-web'])
    vi.unstubAllGlobals()
  })

  it('an out-of-range preload range is refused by the schema', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: -1, threshold: 0 } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: 1000, threshold: 1.5 } })).rejects.toThrow()
  })
})
