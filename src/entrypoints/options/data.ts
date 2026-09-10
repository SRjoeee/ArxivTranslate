// The settings page's data layer: the stored config and the few statuses the page shows. Every
// change is written straight away (there is no save button), always on top of what storage holds
// now — the popup and the page it is translating write the same object (Codex on #39).
import { useCallback, useEffect, useState } from 'react'
import { configFallbackReason, getConfig, setConfig } from '@/config/storage'
import type { Config } from '@/config/schema'
import { sendMessage } from '@/shared/messages'
import type { HelperStatus } from '@/shared/ocr'
import { type PackState, downloadPack, packState } from '@/shared/pack'

export interface CacheStats { entries: number; bytes: number }

export interface OptionsData {
  config: Config | null
  /** Why the stored config fell back to defaults, if it did */
  fallbackReason: string | null
  patch(fn: (latest: Config) => Config): Promise<Config>
  pack: PackState | null
  fetchPack(): Promise<void>
  helper: HelperStatus | null
  cache: CacheStats | null
  cacheError: string
  clearCache(): Promise<void>
  cacheCleared: boolean
}

export function useOptionsData(): OptionsData {
  const [config, setLocal] = useState<Config | null>(null)
  const [fallbackReason, setFallbackReason] = useState<string | null>(null)
  const [pack, setPack] = useState<PackState | null>(null)
  const [helper, setHelper] = useState<HelperStatus | null>(null)
  const [cache, setCache] = useState<CacheStats | null>(null)
  const [cacheError, setCacheError] = useState('')
  const [cacheCleared, setCacheCleared] = useState(false)

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
    getConfig().then(c => {
      setLocal(c)
      setFallbackReason(configFallbackReason())
      void packState(c.targetLanguage).then(setPack)
    })
    sendMessage({ type: 'axt:helper-status' }).then(setHelper).catch(() => setHelper({ available: false, reason: '扩展后台未响应' }))
    void loadCache()
    // 翻译发生在别的标签页：切回设置页时重新读一次，否则显示的永远是打开那一刻的数字
    const onVisible = () => { if (!document.hidden) void loadCache() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [loadCache])

  const patch = useCallback(async (fn: (latest: Config) => Config) => {
    const next = fn(await getConfig())
    await setConfig(next)
    setLocal(next)
    return next
  }, [])

  /** From the click itself (shared/pack.ts says why); the row shows an indeterminate state meanwhile */
  const fetchPack = useCallback(async () => {
    const target = (await getConfig()).targetLanguage
    setPack('downloading')
    try {
      await downloadPack(target)
      // The chain lives in background (§8.0): have it rebuild one with the now-usable offline service
      await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin' }).catch(() => undefined)
    } finally {
      setPack(await packState(target))
    }
  }, [])

  const clearCache = useCallback(async () => {
    const res = await sendMessage({ type: 'axt:cache-clear', paper: undefined })
    if (!res.ok) { setCacheError(res.message); return }
    setCacheCleared(true)
    setTimeout(() => setCacheCleared(false), 2000)
    await loadCache()
  }, [loadCache])

  return { config, fallbackReason, patch, pack, fetchPack, helper, cache, cacheError, clearCache, cacheCleared }
}
