import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import type { AxtMessage } from '@/shared/messages'
import { mountHook } from '../ui/render-hook'

// The settings page's data layer (INVENTORY S1), mounted in a real React root: a change saved elsewhere shows, and
// the reload an interface language takes waits for the page's drafts

const store = vi.hoisted(() => ({
  config: null as Config | null,
  watchers: [] as ((config: Config) => void)[],
  /** When set, every write waits for it: the test decides when a save lands */
  gate: null as Promise<void> | null,
  /** Writes and reloads in the order they happened */
  log: [] as string[],
}))

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { id: 'test-extension', getURL: (path: string) => path, getPlatformInfo: async () => ({ os: 'mac' }), onMessage: { addListener: vi.fn(), removeListener: vi.fn() } },
    i18n: { getUILanguage: () => 'en' },
  },
}))
vi.mock('@/config/storage', () => ({
  getConfig: async () => { if (!store.config) throw new Error('no config'); return store.config },
  setConfig: async (config: Config) => { if (store.gate) await store.gate; store.config = config; store.log.push(`set:${config.targetLanguage}`) },
  watchConfig: (callback: (config: Config) => void) => { store.watchers.push(callback); return () => { store.watchers = store.watchers.filter(w => w !== callback) } },
  configFallbackReason: () => null,
}))
vi.mock('@/shared/messages', async importOriginal => ({
  ...(await importOriginal<typeof import('@/shared/messages')>()),
  sendMessage: (message: AxtMessage) => {
    if (message.type === 'axt:cache-stats') return Promise.resolve({ ok: true, entries: 0, bytes: 0 })
    if (message.type === 'axt:helper-status') return Promise.resolve({ state: 'not-installed' })
    return Promise.resolve(undefined)
  },
}))

import { useOptionsData } from '@/entrypoints/options/data'
import { applyLocaleFrom } from '@/ui/apply-locale'
import { drafts } from '@/ui/drafts'

const saveElsewhere = (config: Config) => {
  store.config = config
  for (const watcher of store.watchers) watcher(config)
}

describe('useOptionsData', () => {
  let reload: ReturnType<typeof vi.fn>
  beforeEach(() => {
    store.config = { ...DEFAULT_CONFIG, uiLanguage: 'en' }
    store.watchers = []
    store.gate = null
    store.log = []
    applyLocaleFrom('en')
    reload = vi.fn(() => { store.log.push('reload') })
    vi.spyOn(location, 'reload').mockImplementation(reload as () => void)
  })

  it('a change saved elsewhere shows without a reload', async () => {
    const hook = await mountHook(useOptionsData)
    await hook.until(() => hook.current().config !== null || reload.mock.calls.length > 0)
    expect(hook.current().config?.targetLanguage).toBe(DEFAULT_CONFIG.targetLanguage)
    await hook.run(() => saveElsewhere({ ...DEFAULT_CONFIG, uiLanguage: 'en', targetLanguage: 'jpn' }))
    expect(hook.current().config?.targetLanguage).toBe('jpn')
    expect(reload).not.toHaveBeenCalled()
    await hook.unmount()
  })

  it('an interface language saved elsewhere reloads the page at once when nothing is being edited', async () => {
    const hook = await mountHook(useOptionsData)
    await hook.until(() => hook.current().config !== null || reload.mock.calls.length > 0)
    await hook.run(() => saveElsewhere({ ...DEFAULT_CONFIG, uiLanguage: 'zh-CN' }))
    expect(reload).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })

  it('under a draft the reload waits for the draft to close, and the other settings follow meanwhile', async () => {
    // The fourth local pass of S1: a service being edited in another tab's drawer is local until 连接; the reload the
    // watcher asked for would have discarded it
    const hook = await mountHook(useOptionsData)
    await hook.until(() => hook.current().config !== null || reload.mock.calls.length > 0)
    const release = drafts.hold()
    await hook.run(() => saveElsewhere({ ...DEFAULT_CONFIG, uiLanguage: 'zh-CN', targetLanguage: 'jpn' }))
    expect(reload).not.toHaveBeenCalled()
    expect(hook.current().config?.targetLanguage).toBe('jpn')
    // A second change while it waits asks for no second reload
    await hook.run(() => saveElsewhere({ ...DEFAULT_CONFIG, uiLanguage: 'zh-CN', targetLanguage: 'kor' }))
    release()
    await hook.flush()
    expect(reload).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })

  it('the reload waits for a save queued as the draft closes: the prompt editor and the glossary save and close in one breath', async () => {
    // The fifth local pass of S1: `save()` queues its patch on the write chain and closes the editor; the hold ends,
    // and a reload issued at once would cut the write off before its read of the store came back
    const hook = await mountHook(useOptionsData)
    await hook.until(() => hook.current().config !== null || reload.mock.calls.length > 0)
    const release = drafts.hold()
    await hook.run(() => saveElsewhere({ ...DEFAULT_CONFIG, uiLanguage: 'zh-CN' }))
    expect(reload).not.toHaveBeenCalled()
    let land!: () => void
    store.gate = new Promise<void>(resolve => { land = resolve })
    const saved = hook.current().patch(latest => ({ ...latest, targetLanguage: 'kor' }))
    release()
    await hook.flush()
    expect(reload).not.toHaveBeenCalled()
    land()
    await saved
    await hook.flush()
    expect(store.config?.targetLanguage).toBe('kor')
    expect(reload).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })

  it('a draft opened while the reload waits for a write holds it again', async () => {
    // The fifth local pass of S1: the wait for the write ended in an unconditional reload, over a prompt opened meanwhile
    const hook = await mountHook(useOptionsData)
    await hook.until(() => hook.current().config !== null || reload.mock.calls.length > 0)
    const releaseFirst = drafts.hold()
    await hook.run(() => saveElsewhere({ ...DEFAULT_CONFIG, uiLanguage: 'zh-CN' }))
    let land!: () => void
    store.gate = new Promise<void>(resolve => { land = resolve })
    const saved = hook.current().patch(latest => ({ ...latest, targetLanguage: 'kor' }))
    releaseFirst()
    await hook.flush()
    const releaseSecond = drafts.hold()
    land()
    await saved
    await hook.flush()
    expect(reload).not.toHaveBeenCalled()
    releaseSecond()
    await hook.flush()
    expect(reload).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })

  it('a save queued while the reload waits for an earlier one lands before the reload', async () => {
    const hook = await mountHook(useOptionsData)
    await hook.until(() => hook.current().config !== null || reload.mock.calls.length > 0)
    const release = drafts.hold()
    await hook.run(() => saveElsewhere({ ...DEFAULT_CONFIG, uiLanguage: 'zh-CN' }))
    let land!: () => void
    store.gate = new Promise<void>(resolve => { land = resolve })
    const first = hook.current().patch(latest => ({ ...latest, targetLanguage: 'kor' }))
    release()
    await hook.flush()
    const second = hook.current().patch(latest => ({ ...latest, targetLanguage: 'fra' }))
    land()
    await Promise.all([first, second])
    await hook.flush()
    expect(store.log).toEqual(['set:kor', 'set:fra', 'reload'])
    await hook.unmount()
  })

  it('a stored interface language that differs from the one in use at the first read reloads the page', async () => {
    // Codex on #185: a change landing between the locale's read and the hook's first read has no watcher yet
    store.config = { ...DEFAULT_CONFIG, uiLanguage: 'zh-CN' }
    const hook = await mountHook(useOptionsData)
    await hook.until(() => hook.current().config !== null || reload.mock.calls.length > 0)
    expect(reload).toHaveBeenCalledTimes(1)
    await hook.unmount()
  })
})
