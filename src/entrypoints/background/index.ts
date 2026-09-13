import { cachePortOf, translationCache } from '@/cache'
import { getConfig, watchConfig } from '@/config/storage'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import { createLocalTransport } from '@/providers/transport'
import { toErrorInfo } from '@/providers/translate-service'
import { isAxtMessage, replyWith } from '@/shared/messages'
import { HELPER_HOST, type HelperStatus } from '@/shared/ocr'
import { createChainHolder } from './chain'
import { engineReady } from './engine-ready'
import { createHelperClient } from './helper'
import { createHelperWaiter } from './helper-await'
import { createHelperRestart } from './helper-restart'
import { createConfigOffers, providerStatus, statusInForce } from './provider-status'
import { createOcrService } from './ocr'
import { createSessionRouter } from './sessions'
import { installContextMenu, refreshContextMenu, installToggleCommand } from './context-menu'
import { applyLocaleFrom, resolveLocale } from '@/ui/apply-locale'
import { setLocale } from '@/ui/strings'
import { savedFromStatus } from '@/shared/page-action'

// The background: message routing + the engine chain + the queues + the cache (DESIGN §8.0). WXT ≥0.20 ships no
// polyfill, so an asynchronous response needs sendResponse + return true.
export default defineBackground(() => {
  const cache = cachePortOf(translationCache)
  /** Scopes ended for certain — one registry (ADR-0005): the session router writes it, the chain's services and OCR read it */
  const cancelled = new CancelledScopeRegistry()

  /** The chain in force, one per worker (./chain.ts): built lazily, rebuilt when the configuration that shapes it changes */
  const chain = createChainHolder({
    load: async config => {
      const resolved = config ?? await getConfig()
      return { config: resolved, transport: await createLocalTransport(resolved, { cache, cancelled }) }
    },
    // The router is created below; a superseded chain is only ever swept after a build, long after that
    owned: transport => router.sessionsOn(transport) > 0,
  })
  const transportOf = () => chain.current()
  /** The interface language this worker uses, to recognise “the reader changed it” (the context menu's title has to be redrawn) */
  let uiLanguage: string | null = null

  // The chain learns of a change by reading the store, in order with the popup's `fresh` asks — never from the
  // event's own value, which carries no order (provider-status.ts says why)
  const offers = createConfigOffers({ load: getConfig, chain })
  watchConfig(next => {
    // A changed interface language redraws the menu: the worker does not restart for it, and unredrawn the title would stay in the old language (Codex on #161)
    if (next.uiLanguage !== uiLanguage) {
      uiLanguage = next.uiLanguage
      applyLocaleFrom(next.uiLanguage)
      refreshContextMenu(menuDeps)
    }
    void offers.offer()
  })

  /**
   * The binding of sessions to chains (see ./sessions.ts): a session holds to the chain it started on, and a closed
   * tab withdraws its requests. The price is two chains briefly side by side when the configuration changes in the
   * middle of a translation, the cross-tab concurrency budget doubled until the old session ends; a deliberate trade — better one extra set of queues for a while than a round of translation changing engine or language halfway (Codex on #59).
   * A settings change while a page is on therefore starts a **new** session that replaces the
   * old one in place (content `start(…, restart)`, DESIGN §8.5); the old session's requests are
   * cancelled by its scope as before
   */
  /**
   * The local OCR helper of image translation (DESIGN §15): connected lazily, with a harmless API called on a timer while
   * a request is in flight, as a keep-alive — an open port does not keep the worker from being reclaimed. Withdrawing a session withdraws its queued recognitions too (the router's onDrop)
   */
  const helper = createHelperClient({
    connect: () => browser.runtime.connectNative(HELPER_HOST),
    lastError: () => browser.runtime.lastError?.message,
    keepAlive: () => void browser.runtime.getPlatformInfo(),
    // Optional permission (ADR-0002): asked before each connection. The binding is missing in a worker started
    // before the grant; `restarting` is what it reports until the alarm below has brought a fresh one
    permitted: () => browser.permissions.contains({ permissions: ['nativeMessaging'] }),
    bound: () => typeof browser.runtime.connectNative === 'function',
  })
  const ocr = createOcrService({ backend: helper, cache, cancelled })
  const router = createSessionRouter({
    current: transportOf,
    cancelled,
    retireOthers: () => chain.retireOthers(),
    cancelScope: scope => chain.cancelScope(scope),
    onDrop: scope => ocr.cancel(scope),
    /**
     * Is that tab still the page it was: ask it.
     *
     * A page still there answers with the same session id; navigated away, its content script is gone and
     * `sendMessage` throws outright. Asked once only when the grace expires, and only when the tab made no request at all in that time
     */
    /**
     * Is this tab still loading. `status` of `tabs.get` is not among the fields that need the `tabs` permission (url /
     * title / favIconUrl are the guarded ones), so this asks for no wider permission
     */
    stillLoading: async tabId => {
      try {
        return (await browser.tabs.get(tabId)).status === 'loading'
      } catch {
        return false
      }
    },
    stillThere: async (tabId, scope) => {
      try {
        const status = await browser.tabs.sendMessage(tabId, { type: 'axt:page-status' })
        return (status as { session?: string | null } | undefined)?.session === scope ? 'same' : 'other'
      } catch {
        // The message did not arrive: the page may be gone, or the new document's content script may not be installed yet. Indistinguishable, so no death sentence
        return 'unknown'
      }
    },
  })

  // Both lifecycle hooks give only tabId / status, needing no "tabs" permission
  const dropTab = (tabId: number, why: string) => {
    void router.dropTab(tabId).then(n => {
      if (n > 0) console.debug(`[axt] tab ${tabId} ${why}: ${n} queued / in-flight requests withdrawn`)
    })
  }
  // The context menu (issue #146): the second entry, the same message as the popup's action.
  // **Registered synchronously**, without waiting for the locale pack (context-menu.ts says why): the menu is built in
  // the fallback language first and rebuilt once the pack is read, so the title follows the interface language (UI.md §6)
  /**
   * Say something to every tab that will listen. No `tabs` permission is needed to enumerate ids,
   * and a tab without our content script simply rejects — there is nothing to filter on and nothing
   * to lose by asking
   */
  const tellTabs = async (message: { type: 'axt:helper-ready' }) => {
    const tabs = await browser.tabs.query({}).catch(() => [])
    for (const tab of tabs) if (tab.id !== undefined) void browser.tabs.sendMessage(tab.id, message).catch(() => undefined)
  }
  /**
   * The helper's state changed on the background's own initiative — the install wait found it, or the fresh worker
   * after a runtime grant reported (ADR-0002). Papers only need to hear "ready" (they park bitmaps until then); the
   * extension pages take the state as is. Extension pages are not content scripts and get nothing from
   * `tabs.sendMessage`, hence the second send; nobody listening is the normal case and it rejects
   */
  const broadcastHelper = (status: HelperStatus) => {
    if (status.state === 'ready') void tellTabs({ type: 'axt:helper-ready' })
    void browser.runtime.sendMessage({ type: 'axt:helper-state', status }).catch(() => undefined)
  }

  /**
   * The guided install's wait (§15.4): once the reader has copied the install command, this probes on a timer and
   * broadcasts a find — the reader need not come back to the extension and click anything. The deadline lives in
   * **session** storage: once the browser is closed this install need not be waited for any more
   */
  const AWAIT_KEY = 'axt-helper-await-until'
  const helperWaiter = createHelperWaiter({
    probe: () => ocr.status({ recheck: true }),
    announce: broadcastHelper,
    now: () => Date.now(),
    schedule: (run, ms) => setTimeout(run, ms) as unknown as number,
    cancel: id => clearTimeout(id),
    load: async () => {
      const stored = await browser.storage.session.get(AWAIT_KEY).catch(() => ({}) as Record<string, unknown>)
      const value = stored[AWAIT_KEY]
      return typeof value === 'number' ? value : undefined
    },
    save: async deadline => {
      if (deadline === undefined) await browser.storage.session.remove(AWAIT_KEY).catch(() => undefined)
      else await browser.storage.session.set({ [AWAIT_KEY]: deadline }).catch(() => undefined)
    },
    warn: (message, error) => console.debug(message, error),
  })
  // The wait is picked up as soon as the worker wakes: the reader may still be in the terminal, and this worker is a
  // fresh one after the previous was reclaimed. **What wakes the worker is often the popup's own query**, so the query
  // has to wait for this read of storage before answering, or it gets the null not yet restored (Codex on #166)
  const helperRestored = helperWaiter.resume()

  /**
   * A grant while this worker runs leaves it without `runtime.connectNative` (helper-restart.ts says why). The alarm
   * fires after the idle limit — into a fresh worker once this one has died — and the listener is registered at top
   * level, as MV3 requires for an event to wake a worker
   */
  const RESTART_ALARM = 'axt-helper-restart'
  const helperRestart = createHelperRestart({
    probe: () => ocr.status({ recheck: true }),
    arm: () => void browser.alarms.create(RESTART_ALARM, { delayInMinutes: 0.75 }),
    announce: broadcastHelper,
    // The one subscription fed by tabs that are not ours (see onTabUpdated below)
    quiesce: () => browser.tabs.onUpdated.removeListener(onTabUpdated),
  })
  browser.alarms.onAlarm.addListener(alarm => {
    if (alarm.name === RESTART_ALARM) void helperRestart.fired()
  })

  /**
   * The saved settings as the toggle decides on them (shared/page-action.ts): their identity, and whether they run —
   * from the chain in force, which is built from them. The popup decides the same from the settings it holds
   */
  const saved = async () => {
    // One snapshot: the chain in force, built from what is stored now (offered in order with every other offer),
    // and still in force once its probes have answered
    await offers.offer()
    return savedFromStatus((await statusInForce(chain)).status)
  }
  const menuDeps = {
    create: (options: { id: string; title: string; contexts: string[]; documentUrlPatterns: string[] }) =>
      browser.contextMenus.create(options as Parameters<typeof browser.contextMenus.create>[0]),
    removeAll: () => browser.contextMenus.removeAll(),
    onClicked: (handler: Parameters<typeof browser.contextMenus.onClicked.addListener>[0]) => browser.contextMenus.onClicked.addListener(handler),
    send: (tabId: number, message: unknown) => browser.tabs.sendMessage(tabId, message as never),
    saved,
  }
  installContextMenu(menuDeps)
  // The reader changed the interface language while this read was out: the watcher has swapped the pack already, and
  // this old snapshot must not put it back. **Judge, then apply**: `applyLocale` itself calls setLocale, and checking
  // the gate after it returns, the pack has been swapped back already (Codex on #161, in two rounds: this place and its position)
  void resolveLocale().then(code => {
    if (uiLanguage !== null) return
    uiLanguage = code
    setLocale(code)
    refreshContextMenu(menuDeps)
  })
  // The keyboard shortcut (UI.md S-P-50): same toggle, third entry
  installToggleCommand({
    onCommand: handler => browser.commands.onCommand.addListener(handler),
    activeTab: async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0],
    send: (tabId, message) => browser.tabs.sendMessage(tabId, message),
    saved,
  })

  browser.tabs.onRemoved.addListener(tabId => dropTab(tabId, 'closed'))
  /**
   * Navigating away withdraws too (Codex on #59): `onRemoved` covers closing only, and a tab moving to another URL
   * does not fire it. And “a new scope on the same tab withdraws the old one” happens only when **the new page is an
   * arXiv paper too** — moved to any other site, the old queue runs on until the batches exhaust their budget.
   *
   * **But loading cannot tell a same-document hash change from a real departure**: measured, clicking a citation in
   * the body that jumps to the references gives a `changeInfo` of just `{status:'loading'}` as well, with no `url` to
   * compare (neither hook carries the `tabs` permission). Withdrawing on the spot sentences a living page to death,
   * and the translations of its second half all come back aborted (reported by the owner on 2026-09-09). So the router
   * holds it for a while: one more request from this tab means the page is still there, and the withdrawal is cancelled
   */
  // Named, because it comes off while a grant takes effect (ADR-0002): a tab whose title ticks — a clock, a chat
  // app's unread count — is an event every few seconds from a tab that is not ours, and each one resets the worker's
  // idle timer, which would keep the stale worker alive for good (Codex, local review pass 2). The fresh worker
  // registers it again at start-up. Until then a tab that closes still drops its sessions (onRemoved); a tab that
  // navigates away is not noticed — the old session's queued batches run until they finish or this worker dies with
  // them, and the fresh worker starts with no sessions and learns them from the pages' next calls
  const onTabUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (tabId, changeInfo) => {
    // **Both loading and complete press once.** When a cross-document navigation commits slowly, the old document is
    // still alive after loading, the probe at the deadline reaches it, it answers with the same session, and the
    // withdrawal is let go — then it is gone and nobody asks a second time (Codex on #143). At complete the new document
    // is in place: a same-document hash change still answers “still here”, a real departure answers with a new session or not at all
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete') router.mayHaveLeft(tabId)
  }
  browser.tabs.onUpdated.addListener(onTabUpdated)

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:translate':
        // A failed chain build (a provider constructor throwing) is answered honestly too: unanswered, the caller waits for “message channel closed”
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
        // A session's own chain, the chain in force, or — after a save — one built from what is stored now
        // A failure (a build that failed, the status deadline) is replied, not only logged: the page that asked
        // must see its request settle
        replyWith(providerStatus({ chain, router, offers }, message, sender.tab?.id), sendResponse)
        return true
      case 'axt:engine-ready':
        // Rebuild and move whom the sender says (./engine-ready.ts): a downloaded language pack moves one tab, a
        // deleted service moves everyone and retires its chain — the movers act on the chain in force
        void engineReady(chain, router, message).then(sendResponse)
        return true
      // With IndexedDB unavailable an answer still goes back, or the caller waits for “message channel closed” (Codex on #7)
      case 'axt:cache-clear':
        // A failure is reported as it is: swallowing the exception into { removed: 0 } would let the reader believe the cache cleared when IndexedDB is unusable (Codex on #52)
        translationCache.clear(message.paper)
          .then(removed => sendResponse({ ok: true, removed }))
          .catch((e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }))
        return true
      case 'axt:helper-status':
        ocr.status(message.recheck ? { recheck: true } : undefined).then(status => {
          // A re-probe that finds it has to reach the papers already open, which parked their
          // bitmaps when the probe at their session start found nothing (Codex on #161)
          if (message.recheck && status.state === 'ready') void tellTabs({ type: 'axt:helper-ready' })
          // Granted a moment ago into this running worker: arrange the fresh one (ADR-0002)
          helperRestart.noticed(status)
          sendResponse(status)
        })
        return true
      case 'axt:helper-await':
        // One message, two uses: with start it is “copied, start waiting”, without it “still waiting?” — the popup is
        // destroyed on losing focus and picks the same wait up again with the latter on reopening (DESIGN §15.4)
        if (message.start) {
          void helperWaiter.start().then(() => sendResponse({ until: helperWaiter.until() }))
          return true
        }
        void helperRestored.then(() => sendResponse({ until: helperWaiter.until() }))
        return true
      case 'axt:ocr':
        // The scope is bound to the sender's tab first: this may be the tab's first message carrying a scope, and unbound,
        // dropTab could not withdraw the queued recognition when the tab closes. The association only, no chain: OCR must not wait for the translation chain to build (Codex on #87, two rounds)
        if (message.scope) router.bind(message.scope, sender.tab?.id)
        ocr.ocr(message)
          .catch((e: unknown) => ({ ok: false as const, error: { kind: 'unknown' as const, message: e instanceof Error ? e.message : String(e) } }))
          .then(sendResponse)
        return true
      case 'axt:cache-stats':
        // The same protocol as cache-clear: a failure is reported as it is, and “IndexedDB unusable” must not show as “the
        // cache is empty”. Expired entries are cleaned before counting — `get()` only treats them as misses and never
        // deletes, and uncleaned the page would keep showing a heap of unusable counts and bytes; this is also cleanup()'s only call site at run time (Codex on #52)
        translationCache.cleanup()
          .then(() => translationCache.stats())
          .then(stats => sendResponse({ ok: true, ...stats }))
          .catch((e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }))
        return true
    }
  })
})
