// The popup's data layer: every message the popup sends, the two polling loops and the actions,
// lifted out of the old App so the view stays a pure function of `PopupInput` (docs/UI.md §4).
// Nothing here is rendered; PopupView.tsx reads `input` through derivePopupView() and calls
// `actions`. The dev-time `axt:ping` and `axt:stats` messages are gone with the old App.
import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { toBcp47 } from '@/config/languages'
import type { Config } from '@/config/schema'
import { configFallbackReason, getConfig, setConfig } from '@/config/storage'
import type { Mode } from '@/core/renderer'
import { BUILTIN_SOURCE_LANGUAGE } from '@/providers/chrome-builtin'
import { COMMAND_ID } from '@/entrypoints/background/context-menu'
import type { ProviderStatus } from '@/providers/transport'
import { type PageStatus, sendMessage, sendToActiveTab } from '@/shared/messages'
import type { PackState, PopupInput } from './view-model'

const scriptStart = performance.now()

type TranslatorGlobal = {
  availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string>
  create(o: { sourceLanguage: string; targetLanguage: string }): Promise<unknown>
}
const translatorApi = () => (globalThis as { Translator?: TranslatorGlobal }).Translator

export interface PopupActions {
  translate(): void
  restore(): void
  chooseMode(mode: Mode): void
  retryFailed(): void
  chooseProvider(id: Config['provider']): void
  chooseLanguage(code: Config['targetLanguage']): void
  choosePrompt(id: string): void
  /** S-P-80: the hover highlight toggle; saved at once, the page picks it up through its config watcher */
  setHighlight(on: boolean): void
  downloadPack(): void
  toggleList(): void
  openOptions(): void
}

export function usePopupData(): { input: PopupInput; error: string | null; actions: PopupActions } {
  const [page, setPage] = useState<PageStatus | null>(null)
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [config, setLocalConfig] = useState<Config | null>(null)
  const [configFallback, setConfigFallback] = useState<string | null>(null)
  /** The offline service's language pack (§8.4); `downloadable` needs a click to create() (user gesture) */
  const [pack, setPack] = useState<PackState | null>(null)
  const [listOpen, setListOpen] = useState(false)
  /** The translate shortcut as bound right now; Chrome formats it for the platform (⌥T / Alt+T) */
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

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
  /** Pack state (§8.4): the popup is an extension page, so Translator is available here too — no detour via the content script */
  const checkPack = useCallback(async (target: string) => {
    const api = translatorApi()
    if (!api) return setPack('unsupported')
    try {
      const state = await api.availability({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(target) })
      setPack(state as PackState)
    } catch {
      setPack('unavailable')
    }
  }, [])

  useEffect(() => {
    console.debug(`[axt] popup mounted ${Math.round(performance.now() - scriptStart)} ms after script start`)
    loadProvider()
    getConfig().then(c => {
      setLocalConfig(c)
      // When the config fell back to defaults, the user's key, service and mode are all silently
      // ignored — that has to be said out loud
      setConfigFallback(configFallbackReason())
      void checkPack(c.targetLanguage)
    }).catch(() => setLocalConfig(null))
    refresh()
    browser.commands.getAll()
      .then(all => setShortcut(all.find(c => c.name === COMMAND_ID)?.shortcut || null))
      .catch(() => setShortcut(null))
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
  const patchConfig = async (patch: (latest: Config) => Config) => {
    const next = patch(await getConfig())
    await setConfig(next)
    setLocalConfig(next)
    loadProvider()
  }

  const actions: PopupActions = {
    translate: () => void guard(async () => {
      const r = await sendToActiveTab({ type: 'axt:translate-page' })
      if (!r.started) throw new Error(r.reason ?? '')
    }),
    restore: () => void guard(async () => { await sendToActiveTab({ type: 'axt:restore-page' }) }),
    chooseMode: mode => void guard(async () => { await sendToActiveTab({ type: 'axt:set-mode', mode }) }),
    retryFailed: () => void guard(async () => { await sendToActiveTab({ type: 'axt:retry-failed' }) }),
    chooseProvider: id => void guard(async () => {
      await patchConfig(latest => ({ ...latest, provider: id }))
      setListOpen(false)
      if (id === 'chrome-builtin') await checkPack((await getConfig()).targetLanguage)
    }),
    chooseLanguage: code => void guard(async () => {
      await patchConfig(latest => ({ ...latest, targetLanguage: code }))
      await checkPack(code)
    }),
    choosePrompt: id => void guard(async () => {
      await patchConfig(latest => ({ ...latest, prompts: { ...latest.prompts, promptId: id } }))
    }),
    setHighlight: on => void guard(async () => {
      await patchConfig(latest => ({ ...latest, reading: { ...latest.reading, sentenceHighlight: on } }))
    }),
    /**
     * Download the language pack. **Must be triggered by the click itself**: with availability at
     * `downloadable`, create() without a user gesture throws NotAllowedError (RESEARCH §6.1). During
     * a first download availability() keeps answering `downloadable` and the monitor emits no
     * progress (measured: 67 s), so the UI only shows an indeterminate state
     */
    downloadPack: () => void guard(async () => {
      const api = translatorApi()
      if (!api || !config) return
      setPack('downloading')
      try {
        await api.create({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(config.targetLanguage) })
      } finally {
        await checkPack(config.targetLanguage)
      }
      // Re-query availability, or the translate button stays as it was before the download until
      // the popup is closed and reopened. The service chain lives in background (§8.0): have it
      // rebuild one so the now-usable offline service is back on the chain
      loadProvider()
      await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin' }).catch(() => undefined)
    }),
    toggleList: () => setListOpen(v => !v),
    openOptions: () => void browser.runtime.openOptionsPage(),
  }

  return { input: { page, provider, config, configFallback, pack, listOpen, shortcut }, error, actions }
}
