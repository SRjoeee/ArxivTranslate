// The popup's data layer: every message the popup sends, the polling loops and the actions, so
// the view stays a pure function of `PopupInput` (docs/UI.md §4). Nothing here is rendered;
// PopupView.tsx reads `input` through derivePopupView() and calls `actions`.
//
// A settings change while the page is on restarts it in place (axt:translate-page { restart })
// once the background's chain reflects the save; a choice that cannot run only saves, and the view
// shows the page as behind the settings.
import { useCallback, useEffect, useRef, useState } from 'react'
import { browser } from 'wxt/browser'
import { type Config, DEFAULT_CONFIG, MODE_VALUES } from '@/config/schema'
import { getConfig, setConfig, watchConfig } from '@/config/storage'
import type { Mode } from '@/core/renderer'
import { COMMAND_ID } from '@/entrypoints/background/context-menu'
import type { ProviderStatus } from '@/providers/transport'
import { isBuiltInService, isLlmChosen } from '@/config/services'
import { type PageStatus, sendMessage, sendToActiveTab } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { type PackState, downloadPack, packState } from '@/shared/pack'
import { MANAGE_SERVICES, MANAGE_STYLES, type MenuKind, type PopupInput, pollsBackground, runnable } from './view-model'
import { chainRevision } from '@/config/revision'
import { S } from '@/ui/strings'

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
  /** A service id, a built-in id, or MANAGE_SERVICES */
  chooseService(id: string): void
  chooseLanguage(code: Config['targetLanguage']): void
  choosePrompt(id: string): void
  /** An appearance style id; the page's own config watcher applies it, so no restart */
  chooseStyle(id: string): void
  setHighlight(on: boolean): void
  setImages(on: boolean): void
  downloadPack(): void
  /** `section` 省略时开到设置页自己的默认分节；带上时直接开到那一节 */
  openOptions(section?: OptionsSection): void
  /** What the permission step found after a grant (ui/HelperPermission.tsx) */
  helperStatus(status: HelperStatus): void
}

/** 设置页的分节名，与 options/App.tsx 的 SECTIONS 一致 */
export type OptionsSection = 'services' | 'reading' | 'prompts' | 'data'

/**
 * 打开设置页。**不带分节时用 `openOptionsPage`**：它会把已经开着的那个标签页拉到前面，而不是再开一个。
 * 带分节时只能自己建标签页——`openOptionsPage` 递不进 hash，而设置页正是靠 hash 认分节的（App.tsx）。
 * 让读者点「管理译文样式」却落在「翻译服务」那一节，比多开一个标签页更糟
 */
function openOptions(section?: OptionsSection): void {
  if (!section) return void browser.runtime.openOptionsPage()
  void browser.tabs.create({ url: browser.runtime.getURL(`/options.html#${section}`) })
}

export function usePopupData(): { input: PopupInput; error: string | null; actions: PopupActions } {
  const [page, setPage] = useState<PageStatus | null>(null)
  /**
   * Two provider statuses, published by two kinds of ask and never confused (the local review of S1): the saved
   * settings' chain — asked at mount, after a save, after a configuration change (fresh) — and the running
   * session's own chain, polled while the page is on. A poll that answers late must not overwrite what the saved
   * settings say once the page has stopped, so a stopped page reads the saved one
   */
  const [savedProvider, setSavedProvider] = useState<ProviderStatus | null>(null)
  const [sessionProvider, setSessionProvider] = useState<ProviderStatus | null>(null)
  /**
   * The configuration this popup shows, with the digest of its chain settings — **one** state, set once the digest
   * is known: a configuration shown beside the previous one's digest would call a page current that is behind it,
   * and the button would restore where the toggle refuses (the local review of INVENTORY S2, third pass)
   */
  const [local, setLocal] = useState<{ config: Config; revision: string } | null>(null)
  const config = local?.config ?? null
  const savedRevision = local?.revision ?? null
  const settle = useCallback(async (next: Config) => {
    wantedPack.current = next.targetLanguage
    setLocal({ config: next, revision: await chainRevision(next) })
  }, [])
  /** The offline service's language pack (§8.4); `downloadable` needs a click to create() (user gesture) */
  const [pack, setPack] = useState<PackState | null>(null)
  const [helper, setHelper] = useState<HelperStatus | null>(null)
  const [platform, setPlatform] = useState<'mac' | 'other' | null>(null)
  const [menu, setMenu] = useState<MenuKind | null>(null)
  /** The translate shortcut as bound right now; Chrome formats it for the platform (⌥T / Alt+T) */
  const [shortcut, setShortcut] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** Every config write queues behind the previous one; see `patchConfig` */
  const writes = useRef<Promise<Config>>(Promise.resolve(DEFAULT_CONFIG))

  const refresh = useCallback(() => {
    sendToActiveTab({ type: 'axt:page-status' }).then(setPage).catch(() => setPage(null))
  }, [])
  /**
   * Service availability. Re-queried after a pack download and after every config change, or the
   * translate button stays in the state it had when the popup mounted
   */
  /** Only the latest ask of each kind may publish: answers come back in any order, and a stale one would undo a newer */
  const savedAsk = useRef(0)
  const sessionAsk = useRef(0)
  /** The session the page reports right now; a session answer for another one publishes nothing */
  const sessionRef = useRef<string | null>(null)
  const loadProvider = useCallback((scope?: string | null, fresh = false): Promise<void> => {
    // While a page is translating, ask **its** chain: it stays on the one it started with, so the
    // global chain would describe someone else's hand-overs (Codex on #157). `fresh` is the barrier
    // for a refresh driven by a configuration change: the answer describes a chain built from what
    // is stored now, not the previous chain still in force (the local review of S1)
    if (scope) {
      const ask = ++sessionAsk.current
      return sendMessage({ type: 'axt:provider-status', scope })
        .then(status => { if (ask === sessionAsk.current && sessionRef.current === scope) setSessionProvider(status) })
        .catch(() => { if (ask === sessionAsk.current && sessionRef.current === scope) setSessionProvider(null) })
    }
    const ask = ++savedAsk.current
    return sendMessage({ type: 'axt:provider-status', ...(fresh ? { fresh: true } : {}) })
      .then(status => { if (ask === savedAsk.current) setSavedProvider(status) })
      .catch(() => { if (ask === savedAsk.current) setSavedProvider(null) })
  }, [])
  /**
   * The target the pack state is for — the committed configuration's, set where the configuration lands (`settle`),
   * never by a lookup: a lookup that comes back for another target publishes nothing, and a download that ends after
   * the target moved on re-checks the target of the moment rather than reclaiming its own (the local review of S1)
   */
  const wantedPack = useRef<string | null>(null)
  const checkPack = useCallback(async (target: string): Promise<PackState> => {
    const state = await packState(target)
    if (wantedPack.current === target) setPack(state)
    return state
  }, [])

  useEffect(() => {
    console.debug(`[axt] popup mounted ${Math.round(performance.now() - scriptStart)} ms after script start`)
    loadProvider()
    // The first read is queued on the write chain with everything that follows it: a slow first digest must not
    // land after a watcher reload settled newer settings (the local review of S1)
    const init = async () => {
      const c = await getConfig()
      await settle(c)
      void checkPack(c.targetLanguage)
      return c
    }
    writes.current = writes.current.then(init, init)
    writes.current.catch(() => setLocal(null))
    refresh()
    browser.commands.getAll()
      .then(all => setShortcut(all.find(c => c.name === COMMAND_ID)?.shortcut || null))
      .catch(() => setShortcut(null))
    sendMessage({ type: 'axt:helper-status', recheck: true }).then(setHelper).catch(() => setHelper({ state: 'not-installed' }))
    browser.runtime.getPlatformInfo().then(info => setPlatform(info.os === 'mac' ? 'mac' : 'other')).catch(() => setPlatform('other'))
    // A change saved elsewhere — the settings page, another tab's popup — shows here without reopening (INVENTORY S1).
    // Re-read on the serialized write chain rather than taken from the event, which carries no order (#182)
    const unwatch = watchConfig(() => {
      const reload = async () => {
        const stored = await getConfig()
        await settle(stored)
        void checkPack(stored.targetLanguage)
        void loadProvider(undefined, true)
        return stored
      }
      writes.current = writes.current.then(reload, reload)
    })
    return unwatch
  }, [refresh, checkPack, loadProvider, settle])

  // The background broadcasts the helper's state when it changes on its own — the guided install's wait found it,
  // or the fresh worker after a runtime grant reported (ADR-0002). Without this the card would stay up until the
  // reader closed and reopened the popup (§15.4)
  useEffect(() => {
    const onState = (message: unknown) => {
      const m = message as { type?: string; status?: HelperStatus } | null
      if (m?.type === 'axt:helper-state' && m.status) setHelper(m.status)
    }
    browser.runtime.onMessage.addListener(onState)
    return () => browser.runtime.onMessage.removeListener(onState)
  }, [])

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

  // The session the answers are for; when it ends, its answer goes with it
  useEffect(() => {
    sessionRef.current = page?.session ?? null
    if (!page?.session) setSessionProvider(null)
  }, [page?.session])

  // Poll progress every 500 ms while translation is on: scrolling keeps triggering, there is no
  // "finished" (§10). The replaced-service state lives in background and is queried alongside —
  // measured at millisecond round-trips (RESEARCH §6.7)
  const on = page?.progress.state === 'on'
  const session = page?.session ?? null
  // Paused while a grant takes effect: the background has to be left alone to idle out (view-model.ts says why)
  const askBackground = pollsBackground(helper)
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => {
      refresh()
      if (askBackground) loadProvider(session)
    }, 500)
    return () => clearInterval(id)
  }, [on, session, askBackground, refresh, loadProvider])

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
   * whole snapshot back would revert those (Codex on #39).
   *
   * **Serialized**: two controls changed before the first write lands would otherwise both read the
   * same snapshot and the later write would drop the earlier change (Codex on #157)
   */
  const patchConfig = (patch: (latest: Config) => Config): Promise<Config> => {
    // `then(run, run)`: a write that throws must not poison the chain — every later change would
    // be skipped and the page would silently stop saving
    const run = async () => {
      const next = patch(await getConfig())
      await setConfig(next)
      await settle(next)
      loadProvider()
      return next
    }
    writes.current = writes.current.then(run, run)
    return writes.current
  }

  /** After a settings change: restart the page on the new settings if it is on and they can run */
  const restartIfOn = async (next: Config, packState: PackState | null) => {
    const status = await sendToActiveTab({ type: 'axt:page-status' }).catch(() => null)
    if (status?.progress.state !== 'on') return
    if (!runnable(next, packState)) return // the view shows the page as behind the settings
    // The chain the restart will run on: one built from what was just saved (background/provider-status.ts)
    await loadProvider(undefined, true)
    await sendToActiveTab({ type: 'axt:translate-page', restart: true, ...(status.epoch !== undefined ? { epoch: status.epoch } : {}) })
  }

  const actions: PopupActions = {
    translate: () => void guard(async () => {
      // The epoch at the click, as for the other two: a translate delivered late must not translate a page the reader
      // translated and restored meanwhile (the local review of S2, fourteenth pass)
      const { epoch } = await sendToActiveTab({ type: 'axt:page-status' })
      const r = await sendToActiveTab({ type: 'axt:translate-page', ...(epoch !== undefined ? { epoch } : {}) })
      if (!r.started) throw new Error(r.reason ?? '')
    }),
    // The epoch a click acts on is read at the click, not from the last poll: an automatic hand-over restart between
    // polls would make the poll's stale and the command refused (the local review of S2, seventh pass)
    retranslate: () => void guard(async () => {
      const { epoch } = await sendToActiveTab({ type: 'axt:page-status' })
      const r = await sendToActiveTab({ type: 'axt:translate-page', restart: true, ...(epoch !== undefined ? { epoch } : {}) })
      if (!r.started) throw new Error(r.reason ?? '')
    }),
    restore: () => void guard(async () => {
      const { epoch } = await sendToActiveTab({ type: 'axt:page-status' })
      const r = await sendToActiveTab({ type: 'axt:restore-page', ...(epoch !== undefined ? { epoch } : {}) })
      if (r.refused) throw new Error(S.page.sessionOver)
    }),
    chooseMode: mode => void guard(async () => { await sendToActiveTab({ type: 'axt:set-mode', mode }) }),
    retryFailed: () => void guard(async () => { await sendToActiveTab({ type: 'axt:retry-failed' }) }),
    openMenu: kind => setMenu(kind),
    closeMenu: () => setMenu(null),
    chooseService: id => void guard(async () => {
      setMenu(null)
      // The last row of the menu is not a service: it opens the page where services are managed
      if (id === MANAGE_SERVICES) return void openOptions()
      const next = await patchConfig(latest => (
        // The menu may have been built before another tab deleted this service; storing an id that
        // names nothing would leave the reader looking at a choice nothing honours (Codex on #157)
        isBuiltInService(id) || latest.services.some(s => s.id === id) ? { ...latest, provider: id } : latest
      ))
      if (next.provider !== id) return
      const packState = id === 'chrome-builtin' ? await checkPack(next.targetLanguage) : pack
      await restartIfOn(next, packState)
    }),
    chooseLanguage: code => void guard(async () => {
      setMenu(null)
      const next = await patchConfig(latest => ({ ...latest, targetLanguage: code }))
      const packState = await checkPack(code)
      await restartIfOn(next, packState)
    }),
    choosePrompt: id => void guard(async () => {
      setMenu(null)
      const next = await patchConfig(latest => ({ ...latest, prompts: { ...latest.prompts, promptId: id } }))
      // Any of the reader's services is an LLM, and each is chosen through its own id — comparing
      // against 'openai-compat' was never true after v12, so the page kept the old prompt (Codex on #157)
      if (isLlmChosen(next)) await restartIfOn(next, pack)
    }),
    // The page's config watcher redraws the translations in the new style; no session restarts
    chooseStyle: id => void guard(async () => {
      setMenu(null)
      // 最后一行不是样式，是去管理它们的地方（S-P-83）。样式住在「阅读」那一节，所以带上分节
      if (id === MANAGE_STYLES) return void openOptions('reading')
      // Same as the service menu: this list may have been built before another tab deleted the
      // profile, and a dangling id leaves every profile unmarked while the page reads the first
      // one (Codex on #161)
      await patchConfig(latest => (
        latest.appearance.styles.some(p => p.id === id) ? { ...latest, appearance: { ...latest.appearance, activeStyle: id } } : latest
      ))
    }),
    // Both switches are applied live by the page's own config watcher; nothing to send
    setHighlight: on => void guard(async () => {
      await patchConfig(latest => ({ ...latest, reading: { ...latest.reading, sentenceHighlight: on } }))
    }),
    setImages: on => void guard(async () => {
      // A reader who had unticked every mode migrates with an empty list; switching image
      // translation back on then shows as enabled while no mode can run it (Codex on #157)
      await patchConfig(latest => ({ ...latest, image: { enabled: on, modes: on && latest.image.modes.length === 0 ? [...MODE_VALUES] : latest.image.modes } }))
    }),
    // From the click itself (shared/pack.ts says why); the menu shows a spinner meanwhile
    downloadPack: () => void guard(async () => {
      if (!config) return
      const target = config.targetLanguage
      setPack('downloading')
      try {
        await downloadPack(target)
      } finally {
        // The target of the moment, not the one downloaded: it may have moved on meanwhile
        await checkPack(wantedPack.current ?? target)
      }
      // The service chain lives in background (§8.0): have it rebuild one so the now-usable offline
      // service is back on it. The promise shown next to this button is about **this** tab, so only
      // its session moves onto the new chain (Codex on #157)
      await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin', ...(page?.session ? { scope: page.session } : {}) }).catch(() => undefined)
      void loadProvider(undefined, true)
    }),
    openOptions: section => void openOptions(section),
    helperStatus: setHelper,
  }

  // A page that is on shows its session's chain (its hand-overs); anything else the saved settings' chain
  const provider = page?.progress.state === 'on' && sessionProvider ? sessionProvider : savedProvider
  return { input: { page, provider, config, pack, helper, platform, menu, shortcut, extensionId: browser.runtime.id, savedRevision }, error, actions }
}
