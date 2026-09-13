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
import { type PackState, createPackLookup, downloadPack } from '@/shared/pack'
import { MANAGE_SERVICES, MANAGE_STYLES, type MenuKind, type PopupInput, actionErrorText, pollsBackground, runnable, startRefusalText } from './view-model'
import { chainRevision } from '@/config/revision'
import { localeInUse, S } from '@/ui/strings'
import { pickLocale } from '@/locales'
import { browserLanguages } from '@/ui/apply-locale'
import { createProviderAsks } from './provider-asks'

const scriptStart = performance.now()

/** The stored interface language resolves to another pack than the one in use (chosen once, before the first paint) */
const staleLocale = (c: Config) => pickLocale(c.uiLanguage, browserLanguages()) !== localeInUse()

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
  /** With `section` omitted, opens the settings page on its own default section; with it, straight to that section */
  openOptions(section?: OptionsSection): void
  /** What the permission step found after a grant (ui/HelperPermission.tsx) */
  helperStatus(status: HelperStatus): void
}

/** The settings page's section names, matching SECTIONS in options/App.tsx */
export type OptionsSection = 'services' | 'reading' | 'prompts' | 'data'

/**
 * Open the settings page. **Without a section, `openOptionsPage`**: it brings the tab already open to the front rather than opening another.
 * With a section only a tab of our own will do — `openOptionsPage` passes no hash, and the settings page tells sections apart by the hash (App.tsx).
 * A reader who clicks “Manage styles…” and lands on “Services” is worse off than one with an extra tab
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
  /** The offline service's language pack (§8.4); `downloadable` needs a click to create() (user gesture) */
  const [pack, setPack] = useState<PackState | null>(null)
  /** The lookups' bookkeeping (shared/pack.ts): the committed target, the newest lookup, the downloads in flight */
  const [packs] = useState(() => createPackLookup({ publish: setPack }))
  const settle = useCallback(async (next: Config) => {
    // The committed configuration owns the wanted target: another target forgets the previous one's pack state at
    // once (Codex on #185); the lookup that follows fills the new one
    packs.want(next.targetLanguage)
    setLocal({ config: next, revision: await chainRevision(next) })
  }, [packs])
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
  /** The session the page reports right now */
  const sessionRef = useRef<string | null>(null)
  /**
   * Service availability. Re-queried after a pack download and after every config change, or the translate button
   * stays in the state it had when the popup mounted. The two asks' bookkeeping is provider-asks.ts: only the newest
   * saved ask publishes; one session ask in flight at a time, given up on after a while so a stalled one cannot hold
   * the polling
   */
  const [asks] = useState(() => createProviderAsks({
    send: sendMessage,
    publishSaved: setSavedProvider,
    // An answer for a session the page no longer reports publishes nothing
    publishSession: (scope, status) => { if (sessionRef.current === scope) setSessionProvider(status) },
  }))
  const loadProvider = useCallback((scope?: string | null): Promise<void> => {
    // While a page is translating, ask **its** chain: it stays on the one it started with, so the
    // global chain would describe someone else's hand-overs (Codex on #157). Without a scope, the saved
    // settings' chain as built from what is stored now (provider-asks.ts says why every such ask carries the barrier)
    return scope ? asks.session(scope) : asks.saved()
  }, [asks])

  useEffect(() => {
    console.debug(`[axt] popup mounted ${Math.round(performance.now() - scriptStart)} ms after script start`)
    // The first read is queued on the write chain with everything that follows it: a slow first digest must not
    // land after a watcher reload settled newer settings (the local review of S1)
    const init = async () => {
      const c = await getConfig()
      // A change landing between the locale's read (main.tsx) and this one would otherwise show its settings in the
      // labels of the previous language (Codex on #185)
      if (staleLocale(c)) { location.reload(); return c }
      await settle(c)
      void packs.check(c.targetLanguage)
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
      const follow = async () => {
        const stored = await getConfig()
        // The interface language was applied once at mount (applyLocale); a stored choice that resolves to another
        // pack takes a reload, as the settings page's own change does. Compared with the locale actually in use, not
        // with a value this hook recorded: a change landing between the locale's read and this hook's first read
        // would otherwise pass unnoticed (Codex on #185)
        if (staleLocale(stored)) { location.reload(); return stored }
        await settle(stored)
        void packs.check(stored.targetLanguage)
        void loadProvider()
        return stored
      }
      writes.current = writes.current.then(follow, follow)
    })
    return unwatch
  }, [refresh, packs, loadProvider, settle])

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
  // A new session — the page restarted from A to B, or stopped — starts with no chain status of its own: A's hand-overs
  // are not B's (Codex on #185); the next poll fills it
  useEffect(() => {
    sessionRef.current = page?.session ?? null
    setSessionProvider(null)
  }, [page?.session])

  // Poll progress every 500 ms while translation is on: scrolling keeps triggering, there is no
  // "finished" (§10). The replaced-service state lives in background and is queried alongside —
  // measured at millisecond round-trips (RESEARCH §6.7)
  const on = page?.progress.state === 'on'
  const session = page?.session ?? null
  // The saved settings' chain is asked whenever the page is not running — at mount, and again when it stops. A page
  // that is on shows its session's chain and the polling below stops with it: had the first ask failed, nothing would
  // ask again, and the button would stay disabled after “Show original” (the local review of S1, fourth pass)
  useEffect(() => {
    if (!on) void loadProvider()
  }, [on, loadProvider])
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
      setError(actionErrorText(e))
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
    await loadProvider()
    await sendToActiveTab({ type: 'axt:translate-page', restart: true, ...(status.epoch !== undefined ? { epoch: status.epoch } : {}) })
  }

  const actions: PopupActions = {
    translate: () => void guard(async () => {
      // The epoch at the click, as for the other two: a translate delivered late must not translate a page the reader
      // translated and restored meanwhile (the local review of S2, fourteenth pass)
      const { epoch } = await sendToActiveTab({ type: 'axt:page-status' })
      const r = await sendToActiveTab({ type: 'axt:translate-page', ...(epoch !== undefined ? { epoch } : {}) })
      if (!r.started) throw new Error(startRefusalText(r))
    }),
    // The epoch a click acts on is read at the click, not from the last poll: an automatic hand-over restart between
    // polls would make the poll's stale and the command refused (the local review of S2, seventh pass)
    retranslate: () => void guard(async () => {
      const { epoch } = await sendToActiveTab({ type: 'axt:page-status' })
      const r = await sendToActiveTab({ type: 'axt:translate-page', restart: true, ...(epoch !== undefined ? { epoch } : {}) })
      if (!r.started) throw new Error(startRefusalText(r))
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
      const packState = id === 'chrome-builtin' ? await packs.check(next.targetLanguage) : pack
      await restartIfOn(next, packState)
    }),
    chooseLanguage: code => void guard(async () => {
      setMenu(null)
      const next = await patchConfig(latest => ({ ...latest, targetLanguage: code }))
      const packState = await packs.check(code)
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
      // The last row is not a style but the place to manage them (S-P-83). Styles live in the “Reading” section, so the section goes along
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
      await packs.download(config.targetLanguage, downloadPack)
      // The service chain lives in background (§8.0): have it rebuild one so the now-usable offline
      // service is back on it. The promise shown next to this button is about **this** tab, so only
      // its session moves onto the new chain (Codex on #157)
      await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin', ...(page?.session ? { scope: page.session } : {}) }).catch(() => undefined)
      void loadProvider()
    }),
    openOptions: section => void openOptions(section),
    helperStatus: setHelper,
  }

  // The view gets both: the session's chain only while the page is on — unknown until it answers, never the saved
  // chain in its place (Codex on #185) — and the saved settings' chain for what a start would run on
  return { input: { page, saved: savedProvider, session: on ? sessionProvider : null, config, pack, helper, platform, menu, shortcut, extensionId: browser.runtime.id, savedRevision }, error, actions }
}
