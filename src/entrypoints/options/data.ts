// The settings page's data layer: the stored config and the few statuses the page shows. Every
// change is written straight away (there is no save button), always on top of what storage holds
// now — the popup and the page it is translating write the same object (Codex on #39).
import { useCallback, useEffect, useRef, useState } from 'react'
import { browser } from 'wxt/browser'
import { type FallbackReason, configFallbackReason, getConfig, setConfig, watchConfig } from '@/config/storage'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { type PackState, downloadPack, packState } from '@/shared/pack'
import { S } from '@/ui/strings'

export interface CacheStats { entries: number; bytes: number }

export interface OptionsData {
  config: Config | null
  /** Why the stored config fell back to defaults, if it did; worded by the page (ui/strings.ts) */
  fallbackReason: FallbackReason | null
  patch(fn: (latest: Config) => Config): Promise<Config>
  pack: PackState | null
  /** Re-query the pack for a language the reader just chose (the Chrome card would otherwise show the old one) */
  checkPack(target: string): Promise<void>
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
  /** The language the newest pack lookup was for; see `checkPack` */
  const wanted = useRef<string | null>(null)

  /**
   * Only the answer for the language asked for **last** is kept: two selections whose lookups
   * overlap can resolve out of order, and the Chrome card would then show another language's
   * availability (Codex on #157)
   */
  /**
   * The committed configuration owns the wanted target (set where the configuration lands); a lookup publishes only
   * for it, and a download that ends after the target moved on re-checks the target of the moment (S1 review)
   */
  const checkPack = useCallback(async (target: string) => {
    const state = await packState(target)
    if (wanted.current === target) setPack(state)
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
      wanted.current = c.targetLanguage
      setLocal(c)
      setFallbackReason(configFallbackReason())
      void checkPack(c.targetLanguage)
      return c
    }
    writes.current = writes.current.then(init, init)
    // A change saved elsewhere — the popup, another settings tab — shows here without a reload (INVENTORY S1). The
    // store is re-read on the same serialized chain the page's own writes use, not taken from the event: events
    // carry no order, and one for an earlier write can arrive after a later write was already shown (#182)
    const unwatch = watchConfig(() => {
      const reload = async () => {
        const stored = await getConfig()
        wanted.current = stored.targetLanguage
        setLocal(stored)
        void checkPack(stored.targetLanguage)
        return stored
      }
      writes.current = writes.current.then(reload, reload)
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
  }, [loadCache, checkPack])

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
      wanted.current = next.targetLanguage
      setLocal(next)
      // A valid write **is** the repair: leaving the warning up would go on telling the reader that
      // the key and service they just fixed are not in effect (Codex on #157)
      setFallbackReason(null)
      return next
    }
    writes.current = writes.current.then(run, run)
    return writes.current
  }, [])

  /** From the click itself (shared/pack.ts says why); the row shows an indeterminate state meanwhile */
  const fetchPack = useCallback(async () => {
    const target = (await getConfig()).targetLanguage
    setPack('downloading')
    try {
      await downloadPack(target)
      // The chain lives in background (§8.0): have it rebuild one with the now-usable offline
      // service. No session is moved — this page promised nothing about any tab, and a page
      // translating into another language must keep the chain it started on (Codex on #157)
      await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin' }).catch(() => undefined)
    } finally {
      await checkPack(wanted.current ?? target)
    }
  }, [checkPack])

  const clearCache = useCallback(async () => {
    const res = await sendMessage({ type: 'axt:cache-clear', paper: undefined })
    if (!res.ok) { setCacheError(res.message); return }
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 2000)
    await loadCache()
  }, [loadCache])

  return { config, fallbackReason, patch, pack, checkPack, fetchPack, helper, setHelper, platform, cache, cacheError, clearCache, cacheCleared }
}
