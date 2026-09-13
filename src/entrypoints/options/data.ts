// The settings page's data layer: the stored config and the few statuses the page shows. Every
// change is written straight away (there is no save button), always on top of what storage holds
// now — the popup and the page it is translating write the same object (Codex on #39).
import { useCallback, useEffect, useRef, useState } from 'react'
import { browser } from 'wxt/browser'
import { type FallbackReason, configFallbackReason, getConfig, setConfig, watchConfig } from '@/config/storage'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { type PackState, createPackLookup, downloadPack } from '@/shared/pack'
import { localeInUse, S } from '@/ui/strings'
import { pickLocale } from '@/locales'
import { browserLanguages } from '@/ui/apply-locale'
import { drafts } from '@/ui/drafts'

export interface CacheStats { entries: number; bytes: number }

/** The stored interface language resolves to another pack than the one in use (chosen once, before the first paint) */
const staleLocale = (c: Config) => pickLocale(c.uiLanguage, browserLanguages()) !== localeInUse()

export interface OptionsData {
  config: Config | null
  /** Why the stored config fell back to defaults, if it did; worded by the page (ui/strings.ts) */
  fallbackReason: FallbackReason | null
  patch(fn: (latest: Config) => Config): Promise<Config>
  pack: PackState | null
  /** Re-query the pack for a language the reader just chose (the Chrome card would otherwise show the old one) */
  checkPack(target: string): Promise<PackState>
  fetchPack(): Promise<void>
  helper: HelperStatus | null
  /** What the permission step found after a grant (ui/HelperPermission.tsx) */
  setHelper(status: HelperStatus): void
  /** Which platform this is; the installer only runs on macOS */
  platform: 'mac' | 'other' | null
  cache: CacheStats | null
  cacheError: string
  clearCache(): Promise<void>
  cacheCleared: boolean
}

export function useOptionsData(): OptionsData {
  const [config, setLocal] = useState<Config | null>(null)
  const [fallbackReason, setFallbackReason] = useState<FallbackReason | null>(null)
  const [pack, setPack] = useState<PackState | null>(null)
  const [helper, setHelper] = useState<HelperStatus | null>(null)
  const [platform, setPlatform] = useState<'mac' | 'other' | null>(null)
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [cacheError, setCacheError] = useState('')
  const [cacheCleared, setCacheCleared] = useState(false)
  /** Every config write queues behind the previous one; see `patch` */
  const writes = useRef<Promise<Config>>(Promise.resolve(DEFAULT_CONFIG))
  /**
   * The lookups' bookkeeping (shared/pack.ts): the committed configuration owns the wanted target — set where the
   * configuration lands, and another target forgets the previous one's state at once, so the card never shows, and
   * the popup never acts on, the old language's availability (Codex on #185) — only the newest lookup for it
   * publishes, and none while its download is in flight
   */
  const [packs] = useState(() => createPackLookup({ publish: setPack }))
  /**
   * Apply the stored interface language the way this page's own change does — a reload — but not under a draft: a
   * service being edited, a profile, a prompt is local until its own save, and the reload would discard it (the
   * local review of S1, fourth pass). It waits for the last draft to close, then for the page's own writes: a draft's
   * save is queued on the chain in the same breath as its editor closes, and a reload issued at once would cut it off
   * before its read of the store came back (fifth pass). A second change meanwhile adds nothing
   */
  const reloadDue = useRef(false)
  const reload = useCallback(() => {
    if (reloadDue.current) return
    reloadDue.current = true
    const go = () => location.reload()
    drafts.whenNone(() => void writes.current.then(go, go))
  }, [])

  const loadCache = useCallback(async () => {
    try {
      const res = await sendMessage({ type: 'axt:cache-stats' })
      // 读不到就说读不到：把失败显示成「0 条」会让用户以为缓存是空的（Codex 在 #52 指出）
      if (res.ok) { setCache({ entries: res.entries, bytes: res.bytes }); setCacheError('') }
      else { setCache(null); setCacheError(res.message) }
    } catch (e) {
      setCache(null)
      setCacheError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // Queued on the write chain with the watcher reloads that follow: a slow first read must not land after one of
    // them showed newer settings (the local review of S1)
    const init = async () => {
      const c = await getConfig()
      // A change landing between the locale's read (main.tsx) and this one would otherwise show its settings in the
      // labels of the previous language (Codex on #185)
      if (staleLocale(c)) reload()
      packs.want(c.targetLanguage)
      setLocal(c)
      setFallbackReason(configFallbackReason())
      void packs.check(c.targetLanguage)
      return c
    }
    writes.current = writes.current.then(init, init)
    // A change saved elsewhere — the popup, another settings tab — shows here without a reload (INVENTORY S1). The
    // store is re-read on the same serialized chain the page's own writes use, not taken from the event: events
    // carry no order, and one for an earlier write can arrive after a later write was already shown (#182)
    const unwatch = watchConfig(() => {
      const follow = async () => {
        const stored = await getConfig()
        // The interface language is chosen once before the page renders (main.tsx): a stored choice that resolves to
        // another pack takes the same way this page's own change does — a reload, deferred under a draft. Compared
        // with the locale in use, not with a recorded value (Codex on #185). The settings below follow meanwhile
        if (staleLocale(stored)) reload()
        packs.want(stored.targetLanguage)
        setLocal(stored)
        // A valid write elsewhere is the repair of a configuration this page had to fall back from (Codex on #185)
        setFallbackReason(configFallbackReason())
        void packs.check(stored.targetLanguage)
        return stored
      }
      writes.current = writes.current.then(follow, follow)
    })
    // `recheck` on every open of a page: the reader may have installed the helper since the worker
    // last looked, and it remembers a missing host for its whole life. Chrome fails a connect to an
    // absent host without spawning anything, so asking again costs nothing
    sendMessage({ type: 'axt:helper-status', recheck: true }).then(setHelper).catch(() => setHelper({ state: 'not-installed', reason: S.page.backendSilent }))
    browser.runtime.getPlatformInfo().then(info => setPlatform(info.os === 'mac' ? 'mac' : 'other')).catch(() => setPlatform('other'))
    // The background broadcasts the helper's state when it changes on its own — the install wait found it, or the
    // fresh worker after a runtime grant reported (ADR-0002); the section follows without a reload
    const onHelperState = (message: unknown) => {
      const m = message as { type?: string; status?: HelperStatus } | null
      if (m?.type === 'axt:helper-state' && m.status) setHelper(m.status)
    }
    browser.runtime.onMessage.addListener(onHelperState)
    void loadCache()
    // 翻译发生在别的标签页：切回设置页时重新读一次，否则显示的永远是打开那一刻的数字
    const onVisible = () => { if (!document.hidden) void loadCache() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      unwatch()
      browser.runtime.onMessage.removeListener(onHelperState)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [loadCache, packs, reload])

  /**
   * **Serialized**: each call reads storage, applies one change and writes it back, so two controls
   * changed before the first write lands would otherwise both read the same snapshot and the later
   * write would drop the earlier change — dragging a slider produces exactly that overlap
   * (Codex on #157)
   */
  const patch = useCallback((fn: (latest: Config) => Config): Promise<Config> => {
    // `then(run, run)`: a write that throws must not poison the chain — every later change would
    // be skipped and the page would silently stop saving
    const run = async () => {
      const next = fn(await getConfig())
      await setConfig(next)
      packs.want(next.targetLanguage)
      setLocal(next)
      // A valid write **is** the repair: leaving the warning up would go on telling the reader that
      // the key and service they just fixed are not in effect (Codex on #157)
      setFallbackReason(null)
      return next
    }
    writes.current = writes.current.then(run, run)
    return writes.current
  }, [packs])

  /** From the click itself (shared/pack.ts says why); the row shows an indeterminate state meanwhile */
  const fetchPack = useCallback(async () => {
    const target = (await getConfig()).targetLanguage
    await packs.download(target, async downloaded => {
      await downloadPack(downloaded)
      // The chain lives in background (§8.0): have it rebuild one with the now-usable offline
      // service. No session is moved — this page promised nothing about any tab, and a page
      // translating into another language must keep the chain it started on (Codex on #157)
      await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin' }).catch(() => undefined)
    })
  }, [packs])

  const clearCache = useCallback(async () => {
    const res = await sendMessage({ type: 'axt:cache-clear', paper: undefined })
    if (!res.ok) { setCacheError(res.message); return }
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 2000)
    await loadCache()
  }, [loadCache])

  return { config, fallbackReason, patch, pack, checkPack: packs.check, fetchPack, helper, setHelper, platform, cache, cacheError, clearCache, cacheCleared }
}
