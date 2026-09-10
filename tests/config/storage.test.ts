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

  it('空存储返回默认配置', async () => {
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
    expect(DEFAULT_CONFIG.services).toEqual([])
    expect(DEFAULT_CONFIG.provider).toBe('microsoft')
  })

  it('写入后读回', async () => {
    await setConfig({ ...DEFAULT_CONFIG, provider: SVC.id, services: [{ ...SVC, apiKey: 'sk-test' }], targetLanguage: 'jpn' })
    const c = await getConfig()
    expect(c.services[0]?.apiKey).toBe('sk-test')
    expect(c.services[0]?.model).toBe('x/y')
    expect(c.targetLanguage).toBe('jpn')
  })

  it('回退不是静默的：版本比扩展新时说清楚是装了旧版本（2026-09-06 实测撞到）', async () => {
    // WXT 拒绝降级迁移后 getValue() 原样返回 v8 对象，schema 的 version 字面量不匹配
    await fakeBrowser.storage.local.set({ config: { ...DEFAULT_CONFIG, version: CONFIG_VERSION + 1 }, config$: { v: CONFIG_VERSION + 1 } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toContain(`v${CONFIG_VERSION + 1}`)
    expect(fresh.configFallbackReason()).toContain('更旧的版本')
  })

  it('结构坏掉时指出是哪个字段，不只说「不合法」', async () => {
    await fakeBrowser.storage.local.set({ config: { ...DEFAULT_CONFIG, targetLanguage: 'nope' }, config$: { v: CONFIG_VERSION } })
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toContain('targetLanguage')
  })

  it('配置正常时不留回退原因：不能对着好配置报警', async () => {
    vi.resetModules()
    const fresh = await import('@/config/storage')
    await fresh.setConfig({ ...DEFAULT_CONFIG, services: [{ ...SVC, apiKey: 'sk-ok' }] })
    expect((await fresh.getConfig()).services[0]?.apiKey).toBe('sk-ok')
    expect(fresh.configFallbackReason()).toBeNull()
  })

  it('空存储读到默认值，同样不算回退（首次安装不该报警）', async () => {
    vi.resetModules()
    const fresh = await import('@/config/storage')
    expect(await fresh.getConfig()).toEqual(DEFAULT_CONFIG)
    expect(fresh.configFallbackReason()).toBeNull()
  })

  it('存储里是坏数据时回退默认', async () => {
    await configItem.setValue({ nonsense: true } as never)
    expect(await getConfig()).toEqual(DEFAULT_CONFIG)
  })

  it('setConfig 拒绝非法值', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, services: [{ ...SVC, model: '' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, services: [{ ...SVC, baseURL: 'not a url' }] })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, provider: 'svc-nope' })).rejects.toThrow()
  })
})

describe('provider 选择', () => {
  it('两个 provider 都能存取，getProvider 返回对应实现', async () => {
    const { getProvider } = await import('@/providers')
    // A reader's service becomes an engine carrying that service's id and name
    const llm = getProvider({ ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] })
    expect(llm.id).toBe(SVC.id)
    expect(llm.displayName).toBe(SVC.name)
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
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
    expect(c.services[0]?.thinking).toBe('enabled')
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
      expect(c.services[0]?.apiKey).toBe('sk-keep')
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
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
    expect(c.appearance.activeStyle).toBe('follow')
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
    expect(c.services[0]?.apiKey).toBe('sk-keep')
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

  it('v7 配置升级到 v8：补上图片翻译的模式闸（默认三种都开），其余含 API key 原样', async () => {
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
    // `quote` is one of the effects v12 dropped: the colour and opacity survive on 与原文相同
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

  it('图片翻译的模式只认三种，空数组合法（= 关闭）', async () => {
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

  it('样式预设只认清单里的 id，自定义 CSS 有长度上限', async () => {
    const a = DEFAULT_CONFIG.appearance
    await expect(setConfig({ ...DEFAULT_CONFIG, appearance: { ...a, styles: [{ ...a.styles[0]!, underline: 'rainbow' as never }] } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, appearance: { ...a, styles: [{ ...a.styles[0]!, css: 'x'.repeat(2001) }] } })).rejects.toThrow()
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
    const withKey = { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] }
    // 没有内置翻译 API 的环境（happy-dom、旧 Chrome）：内置引擎被 isAvailable 过滤掉
    expect((await buildChain(withKey)).chain.map(p => p.id)).toEqual([SVC.id, 'google-web'])
    expect((await buildChain({ ...withKey, fallback: { enabled: false } })).chain.map(p => p.id)).toEqual([SVC.id])
    // 免费引擎自己当首选时不重复出现
    expect((await buildChain({ ...withKey, provider: 'google-web' })).chain.map(p => p.id)).toEqual(['google-web'])
    // 首选没配 key 也留在链首：popup 要据此提示去设置页，而不是悄悄换引擎
    expect((await buildChain({ ...DEFAULT_CONFIG, provider: SVC.id, services: [{ ...SVC, apiKey: '' }] })).chain.map(p => p.id)).toEqual([SVC.id, 'google-web'])
    // The shipped default is the free service that needs no key (UI.md §2)
    expect((await buildChain(DEFAULT_CONFIG)).chain.map(p => p.id)).toEqual(['microsoft', 'google-web'])
  })

  it('语言包就绪时内置引擎排在 google-web 之前；未就绪时被跳过', async () => {
    const { buildChain } = await import('@/providers')
    const withKey = { ...DEFAULT_CONFIG, provider: SVC.id, services: [SVC] }
    const stub = (availability: string) => ({ availability: async () => availability, create: async () => ({ translate: async () => '' }) })

    vi.stubGlobal('Translator', stub('available'))
    expect((await buildChain(withKey)).chain.map(p => p.id)).toEqual([SVC.id, 'chrome-builtin', 'google-web'])
    // 内置当首选时不在兜底里重复出现
    expect((await buildChain({ ...withKey, provider: 'chrome-builtin' })).chain.map(p => p.id)).toEqual(['chrome-builtin', 'google-web'])

    vi.stubGlobal('Translator', stub('downloadable'))
    expect((await buildChain(withKey)).chain.map(p => p.id)).toEqual([SVC.id, 'google-web'])
    vi.unstubAllGlobals()
  })

  it('预翻译范围越界被 schema 拒绝', async () => {
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: -1, threshold: 0 } })).rejects.toThrow()
    await expect(setConfig({ ...DEFAULT_CONFIG, preload: { margin: 1000, threshold: 1.5 } })).rejects.toThrow()
  })
})
