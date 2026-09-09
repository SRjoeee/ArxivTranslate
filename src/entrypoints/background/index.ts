import type { Config } from '@/config/schema'
import { cachePortOf, translationCache } from '@/cache'
import { getConfig, watchConfig } from '@/config/storage'
import { chainConfigChanged, createLocalTransport, type TranslationTransport } from '@/providers/transport'
import { toErrorInfo } from '@/providers/translate-service'
import { isAxtMessage } from '@/shared/messages'
import { HELPER_HOST } from '@/shared/ocr'
import { createHelperClient } from './helper'
import { createOcrService } from './ocr'
import { createSessionRouter } from './sessions'
import { handlePing } from '@/shared/ping'

// Background: message routing, engine chain, queues and cache (DESIGN §8.0). WXT ≥0.20 has no polyfill;
// asynchronous responses require sendResponse + return true.
export default defineBackground(() => {
  const cache = cachePortOf(translationCache)

  /**
   * One browser-wide chain and queue set (§8.2 cross-tab quota policy). Build lazily because each worker wakeup needs rebuilding;
   * checking engine availability just to clear cache would be unnecessary.
   */
  let active: Promise<{ config: Config; transport: TranslationTransport }> | null = null
  const load = async (config?: Config) => {
    const resolved = config ?? await getConfig()
    return { config: resolved, transport: await createLocalTransport(resolved, { cache }) }
  }
  const activate = (config?: Config) => {
    active = load(config)
    return active
  }
  const transportOf = () => (active ?? activate()).then(a => a.transport)

  /**
   * Rebuild only for config fields that change the engine chain. Content writes config on mode switches, often during translation;
   * indiscriminate rebuilding would reset token buckets and fallback history (see chainConfigChanged's classification).
   */
  watchConfig(next => {
    if (!active) return
    active = active.then(
      a => (chainConfigChanged(a.config, next) ? load(next) : { config: next, transport: a.transport }),
      () => load(next),
    )
  })

  /**
   * Session-chain binding (./sessions.ts): a session keeps its starting chain; closing the tab cancels its requests.
   * A config change during translation can briefly leave old/new chains coexisting, doubling cross-tab concurrency until old sessions end.
   * Deliberate tradeoff: temporary duplicate queues are preferable to switching engines or languages mid-run (Codex #59).
   */
  /**
   * Local image OCR helper (DESIGN §15): connect lazily and periodically call a harmless API while requests are in flight.
   * An open port alone does not keep the worker alive. Session drops also cancel queued OCR through router onDrop.
   */
  const helper = createHelperClient({
    connect: () => browser.runtime.connectNative(HELPER_HOST),
    lastError: () => browser.runtime.lastError?.message,
    keepAlive: () => void browser.runtime.getPlatformInfo(),
  })
  const ocr = createOcrService({ helper, cache })
  const router = createSessionRouter(transportOf, { onDrop: scope => ocr.cancel(scope) })

  // Both lifecycle hooks supply tabId/status without requiring the tabs permission.
  const dropTab = (tabId: number, why: string) => {
    void router.dropTab(tabId).then(n => {
      if (n > 0) console.debug(`[axt] Tab ${tabId} ${why}; cancelled ${n} queued / in-flight requests`)
    })
  }
  browser.tabs.onRemoved.addListener(tabId => dropTab(tabId, 'closed'))
  /**
   * Cancel on navigation too (Codex #59): onRemoved only handles closing, not navigation to another URL.
   * Replacing an old scope with a new one only occurs if the new page is also an arXiv paper;
   * navigation elsewhere would leave the old queue running until its batch budgets expire.
   */
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') dropTab(tabId, 'navigated away')
  })

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:ping':
        sendResponse(handlePing(browser.runtime.getManifest().version))
        return true
      case 'axt:translate':
        // Report chain-construction errors too; otherwise the caller only sees "message channel closed".
        router.forCall(message.scope, sender.tab?.id)
          .then(t => t.translate(message))
          .catch((e: unknown) => ({ ok: false as const, error: toErrorInfo(e) }))
          .then(sendResponse)
        return true
      case 'axt:cancel-scope':
        router.drop([message.scope])
          .catch(() => 0)
          .then(cancelled => sendResponse({ cancelled }))
        return true
      case 'axt:provider-status':
        transportOf()
          .then(t => t.status())
          .then(sendResponse)
          .catch((e: unknown) => console.error('[axt] provider-status failed', e))
        return true
      case 'axt:engine-ready':
        // A chain built before language-pack download excludes that engine via isAvailable(), or has permanently demoted it.
        // Rebuild so it can participate again (§8.5, Codex #50).
        // Move active sessions too (Codex #59): popup promises that subsequent paragraphs will use the offline engine.
        // Without migration the page retains its old fallback chain. This explicit user action differs from passive config changes,
        // which intentionally do not migrate sessions (sessions.ts).
        activate()
          .then(async a => {
            router.rebindAll(a.transport)
            return a.transport.status()
          })
          .then(status => sendResponse({ reset: status.chain.includes(message.id) }))
          .catch(() => sendResponse({ reset: false }))
        return true
      // Reply even when IndexedDB is unavailable; otherwise the caller gets "message channel closed" (Codex #7).
      case 'axt:cache-clear':
        // Report failures honestly: returning removed: 0 on error would imply unavailable IndexedDB had been cleared (Codex #52).
        translationCache.clear(message.paper)
          .then(removed => sendResponse({ ok: true, removed }))
          .catch((e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }))
        return true
      case 'axt:helper-status':
        ocr.status().then(sendResponse)
        return true
      case 'axt:ocr':
        // Bind scope to the sender tab first: this may be its first scoped message, and dropTab otherwise cannot cancel queued OCR.
        // Record the association only; OCR must not await translation-chain construction (two rounds of Codex #87).
        if (message.scope) router.bind(message.scope, sender.tab?.id)
        ocr.ocr(message)
          .catch((e: unknown) => ({ ok: false as const, error: { kind: 'unknown' as const, message: e instanceof Error ? e.message : String(e) } }))
          .then(sendResponse)
        return true
      case 'axt:cache-stats':
        // Same protocol as cache-clear: report failures rather than describe unavailable IndexedDB as an empty cache.
        // Clean expired entries before counting; otherwise unusable entries and their size would remain visible.
        // This is cleanup()'s only runtime caller (Codex #52).
        translationCache.cleanup()
          .then(() => translationCache.stats())
          .then(stats => sendResponse({ ok: true, ...stats }))
          .catch((e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }))
        return true
    }
  })
})
