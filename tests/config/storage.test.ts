import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { CONFIG_VERSION, DEFAULT_CONFIG } from '@/config/schema'
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
