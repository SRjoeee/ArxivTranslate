import { cachePortOf, translationCache } from '@/cache'
import { getConfig, watchConfig } from '@/config/storage'
import { CancelledScopeRegistry } from '@/providers/request/cancellation'
import { createLocalTransport } from '@/providers/transport'
import { toErrorInfo } from '@/providers/translate-service'
import { isAxtMessage } from '@/shared/messages'
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
import { handlePing } from '@/shared/ping'
import { applyLocaleFrom, resolveLocale } from '@/ui/apply-locale'
import { setLocale } from '@/ui/strings'
import { savedFromStatus } from '@/shared/page-action'

// background：消息路由 + 引擎链 + 队列 + 缓存（DESIGN §8.0）。WXT ≥0.20 不带 polyfill，
// 异步响应必须用 sendResponse + return true。
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
  /** 这个 worker 当前用的界面语言，用来认出「读者改了它」（右键菜单的标题要跟着重画） */
  let uiLanguage: string | null = null

  // The chain learns of a change by reading the store, in order with the popup's `fresh` asks — never from the
  // event's own value, which carries no order (provider-status.ts says why)
  const offers = createConfigOffers({ load: getConfig, chain })
  watchConfig(next => {
    // 界面语言变了要重画菜单：worker 不会为此重启，不重画的话标题一直停在旧语言（Codex 在 #161 指出）
    if (next.uiLanguage !== uiLanguage) {
      uiLanguage = next.uiLanguage
      applyLocaleFrom(next.uiLanguage)
      refreshContextMenu(menuDeps)
    }
    void offers.offer()
  })

  /**
   * 会话与链的绑定（见 ./sessions.ts）：一次会话认准它开始时的那条链，标签页关掉就撤掉它的请求。
   * 代价是配置恰好在翻译中途变更时新旧两条链短暂并存、跨标签页的并发预算翻倍，直到旧会话结束；
   * 这是有意的取舍——宁可短暂多一套队列，也不能让一轮译文中途换引擎或换语言（Codex 在 #59 指出）。
   * A settings change while a page is on therefore starts a **new** session that replaces the
   * old one in place (content `start(…, restart)`, DESIGN §8.5); the old session's requests are
   * cancelled by its scope as before
   */
  /**
   * 图片翻译的本机 OCR helper（DESIGN §15）：懒连接，有请求在飞时定时调一个无害 API 保活——
   * 端口开着不能阻止 worker 被回收。撤会话时排队的识别一起撤（router 的 onDrop）
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
     * 那个标签页还是不是刚才那个页面：问它自己。
     *
     * 页面还在就答得出同一个会话 id；真跳走了 content script 已经没了，`sendMessage` 直接抛。
     * 只在宽限到点时问一次，而且只在这个标签页那段时间一个请求都没有的情况下才走到这里
     */
    /**
     * 这个标签页还在加载吗。`tabs.get` 的 `status` 不在需要 `tabs` 权限的那几个字段里
     * （被挡的是 url / title / favIconUrl），所以这条不扩权限
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
        // 消息没送到：可能真没了，也可能新文档的 content script 还没装上。分不清就不判死
        return 'unknown'
      }
    },
  })

  // 两个生命周期钩子都只给 tabId / status，不需要 "tabs" 权限
  const dropTab = (tabId: number, why: string) => {
    void router.dropTab(tabId).then(n => {
      if (n > 0) console.debug(`[axt] 标签页 ${tabId} ${why}，撤掉 ${n} 个排队 / 在飞的请求`)
    })
  }
  // 右键菜单（issue #146）：第二个入口，动作与 popup 走同一条消息。
  // **同步注册**，读语言包不等（context-menu.ts 说明为什么）：菜单先用兜底语言建出来，
  // 语言包读到之后再重建一次，标题就跟着界面语言走了（UI.md §6）
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
   * 安装引导的等待（§15.4）：读者复制走安装命令之后，由这里定时探，探到了就广播——
   * 读者不必回到扩展点任何东西。截止时间存在 **session** storage：浏览器关掉之后
   * 这次安装就不必再等了
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
  // worker 醒来就把等待接上：读者可能还在终端里，而这个 worker 是上一个被回收后新起的。
  // **唤醒 worker 的往往正是 popup 那条查询**，所以查询必须等这一步读完 storage 才能回答，
  // 否则它拿到的是还没恢复的 null（Codex 在 #166 指出）
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
    return savedFromStatus(await statusInForce(chain))
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
  // 读者在这次读还没回来的时候改了界面语言：watcher 已经换过语言包，这个旧快照不许再盖回去。
  // **先判断再应用**：`applyLocale` 自己就会 setLocale，等它回来再看闸，包已经被换回旧的了
  //（Codex 在 #161 两轮分别指出这处与它的位置）
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

  browser.tabs.onRemoved.addListener(tabId => dropTab(tabId, '关闭'))
  /**
   * 导航离开也要撤（Codex 在 #59 指出）：`onRemoved` 只管关闭，标签页跳到别的网址时不触发。
   * 而「同一标签页出现新 scope 就撤掉旧的」那条只在**新页面也是 arXiv 论文**时才会发生——
   * 跳到任何别的站点，旧队列就一直跑到批次耗尽预算为止。
   *
   * **但 loading 分不出同文档换 hash 与真的跳走**：实测点正文里的引用跳到参考文献时，`changeInfo`
   * 同样只有 `{status:'loading'}`，没有 `url` 可比（这两个钩子都不带 `tabs` 权限）。当场撤等于把
   * 一个还活着的页面判死，它后半篇的译文会全部 aborted（用户 2026-09-09 报的）。所以交给 router
   * 按住一会儿：这个标签页再来一次请求就说明页面还在，撤销取消
   */
  // Named, because it comes off while a grant takes effect (ADR-0002): a tab whose title ticks — a clock, a chat
  // app's unread count — is an event every few seconds from a tab that is not ours, and each one resets the worker's
  // idle timer, which would keep the stale worker alive for good (Codex, local review pass 2). The fresh worker
  // registers it again at start-up. Until then a tab that closes still drops its sessions (onRemoved); a tab that
  // navigates away is not noticed — the old session's queued batches run until they finish or this worker dies with
  // them, and the fresh worker starts with no sessions and learns them from the pages' next calls
  const onTabUpdated: Parameters<typeof browser.tabs.onUpdated.addListener>[0] = (tabId, changeInfo) => {
    // **loading 与 complete 都要按一次**。跨文档导航提交得慢时，旧文档在 loading 之后还活着，
    // 到点探针问到的是它、答的是同一个会话，撤销就被放掉了——而它随后就没了，再没人问第二次
    //（Codex 在 #143 指出）。complete 时新文档已经就位：同文档换 hash 的话探针照样答「还在」，
    // 真跳走的话答的就是新会话或者根本答不上
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete') router.mayHaveLeft(tabId)
  }
  browser.tabs.onUpdated.addListener(onTabUpdated)

  browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:ping':
        sendResponse(handlePing(browser.runtime.getManifest().version))
        return true
      case 'axt:translate':
        // 建链失败（provider 构造抛错）也要如实回话：不回的话调用方等到的是"message channel closed"
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
        providerStatus({ chain, router, offers }, message)
          .then(sendResponse)
          .catch((e: unknown) => console.error('[axt] provider-status 失败', e))
        return true
      case 'axt:engine-ready':
        // Rebuild and move whom the sender says (./engine-ready.ts): a downloaded language pack moves one tab, a
        // deleted service moves everyone and retires its chain — the movers act on the chain in force
        void engineReady(chain, router, message).then(sendResponse)
        return true
      // IndexedDB 不可用时也要回话，否则调用方等到的是"message channel closed"（Codex 在 #7 指出）
      case 'axt:cache-clear':
        // 失败要如实回报：吞掉异常回 { removed: 0 } 的话，IndexedDB 用不了时用户会以为已经清干净（Codex 在 #52 指出）
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
        // 一条消息两种用法：带 start 是「复制走了，开始等」，不带是「还在等吗」——
        // popup 一失焦就销毁，重开时靠后一种把同一次等待接上（DESIGN §15.4）
        if (message.start) {
          void helperWaiter.start().then(() => sendResponse({ until: helperWaiter.until() }))
          return true
        }
        void helperRestored.then(() => sendResponse({ until: helperWaiter.until() }))
        return true
      case 'axt:ocr':
        // 先把 scope 绑到 sender 的标签页：它可能是这个标签页第一条带 scope 的消息，不绑的话关标签页时 dropTab 撤不到
        // 排队的识别。只记关联、不建链：OCR 不能等翻译链构造（Codex 在 #87 两轮指出）
        if (message.scope) router.bind(message.scope, sender.tab?.id)
        ocr.ocr(message)
          .catch((e: unknown) => ({ ok: false as const, error: { kind: 'unknown' as const, message: e instanceof Error ? e.message : String(e) } }))
          .then(sendResponse)
        return true
      case 'axt:cache-stats':
        // 与 cache-clear 同一套协议：失败要如实回报，不能把「IndexedDB 用不了」显示成「缓存是空的」。
        // 统计前先清过期条目——`get()` 只是把它们当未命中，从不删除，不清的话页面上会一直显示
        // 一堆已经用不了的条数与体积；这也是 cleanup() 在运行时唯一的调用点（Codex 在 #52 指出）
        translationCache.cleanup()
          .then(() => translationCache.stats())
          .then(stats => sendResponse({ ok: true, ...stats }))
          .catch((e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }))
        return true
    }
  })
})
