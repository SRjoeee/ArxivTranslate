import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import type { ProviderStatus } from '@/providers/transport'
import type { AxtMessage, PageStatus } from '@/shared/messages'
import { deferred, mountHook } from '../ui/render-hook'

// The popup's data layer (INVENTORY S1), mounted in a real React root: which ask publishes, and when the page reloads

const store = vi.hoisted(() => ({
  config: null as Config | null,
  watchers: [] as ((config: Config) => void)[],
}))
const wire = vi.hoisted(() => ({
  /** Every `axt:provider-status` ask, in order, with its answer held for the test */
  asks: [] as { message: { scope?: string; fresh?: boolean }; answer: { resolve: (s: unknown) => void; reject: (e: unknown) => void } }[],
  page: null as (() => Promise<unknown>) | null,
}))

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-extension', getURL: (path: string) => path, openOptionsPage: vi.fn(), getPlatformInfo: async () => ({ os: 'mac' }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    commands: { getAll: async () => [] },
    tabs: { create: vi.fn(), query: async () => [] },
    i18n: { getUILanguage: () => 'en' },
  },
}))
vi.mock('@/config/storage', () => ({
  getConfig: async () => { if (!store.config) throw new Error('no config'); return store.config },
  setConfig: async (config: Config) => { store.config = config },
  watchConfig: (callback: (config: Config) => void) => { store.watchers.push(callback); return () => { store.watchers = store.watchers.filter(w => w !== callback) } },
  configFallbackReason: () => null,
}))
vi.mock('@/shared/messages', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/messages')>()),
  sendMessage: (message: AxtMessage) => {
    if (message.type === 'axt:provider-status') {
      const answer = deferred<unknown>()
      wire.asks.push({ message, answer })
      return answer.promise
    }
    if (message.type === 'axt:helper-status') return Promise.resolve({ state: 'not-installed' })
    return Promise.resolve(undefined)
  },
  sendToActiveTab: (message: AxtMessage) => {
    if (message.type === 'axt:page-status') return wire.page ? wire.page() : Promise.reject(new Error('no page'))
    if (message.type === 'axt:restore-page') return Promise.resolve({ removedNodes: 1 })
    return Promise.resolve({ started: true })
  },
}))

import { usePopupData } from '@/entrypoints/popup/data'
import { applyLocaleFrom } from '@/ui/apply-locale'

const status = (id: string): ProviderStatus => ({ providerId: id, chosen: id, available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags', targetLanguage: 'cmn', promptId: 'default', revision: id, chain: [id], demotions: [], engine: { id, displayName: id } })
const page = (state: 'on' | 'stopped', session: string | null): PageStatus => ({ paper: '2401.00001', mode: 'side', preference: 'side', progress: { state, total: 1, requested: 1, done: 1, failed: 0, cached: 0, inFlight: 0 }, session, epoch: 'd#1' })
const savedAsks = () => wire.asks.filter(a => !a.message.scope)

describe('usePopupData', () => {
  let reload: ReturnType<typeof vi.fn>
  beforeEach(() => {
    store.config = { ...DEFAULT_CONFIG, uiLanguage: 'en' }
    store.watchers = []
    wire.asks = []
    wire.page = async () => page('stopped', null)
    applyLocaleFrom('en')
    reload = vi.fn()
    vi.spyOn(location, 'reload').mockImplementation(reload as () => void)
  })

  it('asks the saved settings chain again when the page stops: a first ask that failed must not leave the button disabled', async () => {
    // The fourth local pass of S1: a page on shows its session's chain and the polling stops with the page
    wire.page = async () => page('on', 's1')
    const hook = await mountHook(usePopupData)
    expect(hook.current().input.page?.progress.state).toBe('on')
    expect(savedAsks()).toHaveLength(1)
    await hook.run(() => savedAsks()[0]?.answer.reject(new Error('the chain did not settle')))
    expect(hook.current().input.provider).toBeNull()
    // The reader restores from the popup; the page reports itself stopped
    wire.page = async () => page('stopped', null)
    await hook.run(() => hook.current().actions.restore())
    expect(hook.current().input.page?.progress.state).toBe('stopped')
    expect(savedAsks()).toHaveLength(2)
    await hook.run(() => savedAsks()[1]?.answer.resolve(status('google-web')))
    expect(hook.current().input.provider?.providerId).toBe('google-web')
    await hook.unmount()
  })

  it('a stored interface language that differs from the one in use at the first read reloads the popup', async () => {
    // Codex on #185: a change landing between the locale's read and the hook's first read has no watcher yet
    store.config = { ...DEFAULT_CONFIG, uiLanguage: 'zh-CN' }
    const hook = await mountHook(usePopupData)
    expect(reload).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })

  it('the same interface language at the first read does not reload', async () => {
    const hook = await mountHook(usePopupData)
    expect(reload).not.toHaveBeenCalled()
    expect(hook.current().input.config?.uiLanguage).toBe('en')
    await hook.unmount()
  })

  it('a change saved elsewhere shows without reopening, and the saved chain is asked fresh', async () => {
    const hook = await mountHook(usePopupData)
    expect(hook.current().input.config?.targetLanguage).toBe(DEFAULT_CONFIG.targetLanguage)
    store.config = { ...DEFAULT_CONFIG, uiLanguage: 'en', targetLanguage: 'jpn' }
    await hook.run(() => { for (const watcher of store.watchers) watcher(store.config as Config) })
    expect(hook.current().input.config?.targetLanguage).toBe('jpn')
    expect(savedAsks().at(-1)?.message.fresh).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    await hook.unmount()
  })
})
