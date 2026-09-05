import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeBrowser } from 'wxt/testing/fake-browser'
import { DEFAULT_CONFIG } from '@/config/schema'
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
    await setConfig({ ...DEFAULT_CONFIG, openaiCompat: { ...DEFAULT_CONFIG.openaiCompat, apiKey: 'sk-test', model: 'x/y' }, targetLanguage: 'ja' })
    const c = await getConfig()
    expect(c.openaiCompat.apiKey).toBe('sk-test')
    expect(c.openaiCompat.model).toBe('x/y')
    expect(c.targetLanguage).toBe('ja')
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

  it('v1 配置升级到 v2：补上提示词库，API key 与其他字段原样保留', async () => {
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
    expect(c.version).toBe(2)
    expect(c.openaiCompat.apiKey).toBe('sk-keep')
    expect(c.targetLanguage).toBe('ja')
    expect(c.prompts).toEqual({ promptId: 'default', patterns: [] })
  })
})
