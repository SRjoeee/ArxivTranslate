// The popup's data layer: every message the popup sends, the polling loops and the actions, so
// the view stays a pure function of `PopupInput` (docs/UI.md §4). Nothing here is rendered;
// PopupView.tsx reads `input` through derivePopupView() and calls `actions`.
//
// A settings change while the page is on restarts it in place (axt:translate-page { restart })
// once the background's chain reflects the save; a choice that cannot run only saves, and the view
// shows the page as behind the settings.
import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { Config } from '@/config/schema'
import { getConfig, setConfig } from '@/config/storage'
import type { Mode } from '@/core/renderer'
import { COMMAND_ID } from '@/entrypoints/background/context-menu'
import type { ProviderStatus } from '@/providers/transport'
import { type PageStatus, sendMessage, sendToActiveTab } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { type PackState, downloadPack, packState } from '@/shared/pack'
import { HELPER_GUIDE_URL, helperInstallCommand } from '@/ui/strings'
import { type MenuKind, type PopupInput, runnable } from './view-model'

const scriptStart = performance.now()

export interface PopupActions {
  translate(): void
  /** A new session over the running one, or after a pause: the page follows the saved settings */
  retranslate(): void
  restore(): void
  chooseMode(mode: Mode): void
  retryFailed(): void
  openMenu(kind: MenuKind): void
  closeMenu(): void
  chooseService(id: Config['provider']): void
  chooseLanguage(code: Config['targetLanguage']): void
  choosePrompt(id: string): void
  setHighlight(on: boolean): void
  setImages(on: boolean): void
  downloadPack(): void
  copyInstallCommand(): void
  openGuide(): void
  openOptions(): void
}

export function usePopupData(): { input: PopupInput; error: string | null; copied: boolean; actions: PopupActions } {
  const [page, setPage] = useState<PageStatus | null>(null)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [config, setLocalConfig] = useState<Config | null>(null)
  /** The offline service's language pack (§8.4); `downloadable` needs a click to create() (user gesture) */
  const [pack, setPack] = useState<PackState | null>(null)
  const [helper, setHelper] = useState<HelperStatus | null>(null)
  const [platform, setPlatform] = useState<'mac' | 'other' | null>(null)
  const [menu, setMenu] = useState<MenuKind | null>(null)
  /** The translate shortcut as bound right now; Chrome formats it for the platform (⌥T / Alt+T) */
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = useCallback(() => {
    sendToActiveTab({ type: 'axt:page-status' }).then(setPage).catch(() => setPage(null))
  }, [])
  /**
   * Service availability. Re-queried after a pack download and after every config change, or the
   * translate button stays in the state it had when the popup mounted
   */
  const loadProvider = useCallback(() => {
    sendMessage({ type: 'axt:provider-status' }).then(setProvider).catch(() => setProvider(null))
  }, [])
  const checkPack = useCallback(async (target: string): Promise<PackState> => {
    const state = await packState(target)
    setPack(state)
    return state
  }, [])

  useEffect(() => {
    console.debug(`[axt] popup mounted ${Math.round(performance.now() - scriptStart)} ms after script start`)
    loadProvider()
    getConfig().then(c => {
      setLocalConfig(c)
      void checkPack(c.targetLanguage)
    }).catch(() => setLocalConfig(null))
    refresh()
    browser.commands.getAll()
      .then(all => setShortcut(all.find(c => c.name === COMMAND_ID)?.shortcut || null))
      .catch(() => setShortcut(null))
    sendMessage({ type: 'axt:helper-status' }).then(setHelper).catch(() => setHelper({ available: false }))
    browser.runtime.getPlatformInfo().then(info => setPlatform(info.os === 'mac' ? 'mac' : 'other')).catch(() => setPlatform('other'))
  }, [refresh, checkPack, loadProvider])

  // While the page is still loading the content script is not injected yet (document_idle), so
  // the first ask has no receiver; ask again every 500 ms a few times instead of declaring "not an
  // arXiv page" at once (Codex on #3)
  useEffect(() => {
    if (page !== null) return
    let attempts = 0
    const id = setInterval(() => {
      if (++attempts > 6) return clearInterval(id)
      refresh()
    }, 500)
    return () => clearInterval(id)
  }, [page, refresh])

  // Poll progress every 500 ms while translation is on: scrolling keeps triggering, there is no
  // "finished" (§10). The replaced-service state lives in background and is queried alongside —
  // measured at millisecond round-trips (RESEARCH §6.7)
  const on = page?.progress.state === 'on'
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => {
      refresh()
      loadProvider()
    }, 500)
    return () => clearInterval(id)
  }, [on, refresh, loadProvider])

  const guard = async (run: () => Promise<void>) => {
    setError(null)
    try {
      await run()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  /**
   * Change one field of the config on top of what storage holds **now**. The mounted snapshot is
   * stale as soon as the content script writes the mode or the options page saves: writing the
   * whole snapshot back would revert those (Codex on #39)
   */
  const patchConfig = async (patch: (latest: Config) => Config): Promise<Config> => {
    const next = patch(await getConfig())
    await setConfig(next)
    setLocalConfig(next)
    loadProvider()
    return next
  }

  /**
   * The background rebuilds its chain from a storage event, which races with the messages the
   * popup sends right after saving. Wait until the chain reports the saved values before
   * restarting the page on them (a second at most; then restart anyway)
   */
  const awaitChain = async (settled: (s: ProviderStatus) => boolean) => {
    for (let i = 0; i < 10; i++) {
      const s = await sendMessage({ type: 'axt:provider-status' }).catch(() => null)
      if (s && settled(s)) {
        setProvider(s)
        return
      }
      await new Promise(r => setTimeout(r, 100))
    }
  }

  /** After a settings change: restart the page on the new settings if it is on and they can run */
  const restartIfOn = async (next: Config, packState: PackState | null, settled: (s: ProviderStatus) => boolean) => {
    const status = await sendToActiveTab({ type: 'axt:page-status' }).catch(() => null)
    if (status?.progress.state !== 'on') return
    if (!runnable(next, packState)) return // the view shows the page as behind the settings
    await awaitChain(settled)
    await sendToActiveTab({ type: 'axt:translate-page', restart: true })
  }

  const actions: PopupActions = {
    translate: () => void guard(async () => {
      const r = await sendToActiveTab({ type: 'axt:translate-page' })
      if (!r.started) throw new Error(r.reason ?? '')
    }),
    retranslate: () => void guard(async () => {
      const r = await sendToActiveTab({ type: 'axt:translate-page', restart: true })
      if (!r.started) throw new Error(r.reason ?? '')
    }),
    restore: () => void guard(async () => { await sendToActiveTab({ type: 'axt:restore-page' }) }),
    chooseMode: mode => void guard(async () => { await sendToActiveTab({ type: 'axt:set-mode', mode }) }),
    retryFailed: () => void guard(async () => { await sendToActiveTab({ type: 'axt:retry-failed' }) }),
    openMenu: kind => setMenu(kind),
    closeMenu: () => setMenu(null),
    chooseService: id => void guard(async () => {
      setMenu(null)
      const next = await patchConfig(latest => ({ ...latest, provider: id }))
      const packState = id === 'chrome-builtin' ? await checkPack(next.targetLanguage) : pack
      await restartIfOn(next, packState, s => s.providerId === id)
    }),
    chooseLanguage: code => void guard(async () => {
      setMenu(null)
      const next = await patchConfig(latest => ({ ...latest, targetLanguage: code }))
      const packState = await checkPack(code)
      await restartIfOn(next, packState, s => s.targetLanguage === code)
    }),
    choosePrompt: id => void guard(async () => {
      setMenu(null)
      const next = await patchConfig(latest => ({ ...latest, prompts: { ...latest.prompts, promptId: id } }))
      if (next.provider === 'openai-compat') await restartIfOn(next, pack, s => s.promptId === id)
    }),
    // Both switches are applied live by the page's own config watcher; nothing to send
    setHighlight: on => void guard(async () => {
      await patchConfig(latest => ({ ...latest, reading: { ...latest.reading, sentenceHighlight: on } }))
    }),
    setImages: on => void guard(async () => {
      await patchConfig(latest => ({ ...latest, image: { ...latest.image, enabled: on } }))
    }),
    // From the click itself (shared/pack.ts says why); the menu shows a spinner meanwhile
    downloadPack: () => void guard(async () => {
      if (!config) return
      setPack('downloading')
      try {
        await downloadPack(config.targetLanguage)
      } finally {
        await checkPack(config.targetLanguage)
      }
      // The service chain lives in background (§8.0): have it rebuild one so the now-usable
      // offline service is back on the chain, then re-read availability
      await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin' }).catch(() => undefined)
      loadProvider()
    }),
    copyInstallCommand: () => void guard(async () => {
      await navigator.clipboard.writeText(helperInstallCommand(browser.runtime.id))
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }),
    openGuide: () => void browser.tabs.create({ url: HELPER_GUIDE_URL }),
    openOptions: () => void browser.runtime.openOptionsPage(),
  }

  return { input: { page, provider, config, pack, helper, platform, menu, shortcut, extensionId: browser.runtime.id }, error, copied, actions }
}
