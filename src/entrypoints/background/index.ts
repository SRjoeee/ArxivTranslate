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
import { installContextMenu, installToggleCommand } from './context-menu'
import { handlePing } from '@/shared/ping'

// background：消息路由 + 引擎链 + 队列 + 缓存（DESIGN §8.0）。WXT ≥0.20 不带 polyfill，
// 异步响应必须用 sendResponse + return true。
export default defineBackground(() => {
  const cache = cachePortOf(translationCache)

  /**
   * 全浏览器共用一条链、一套队列（§8.2 的跨标签页额度策略）。懒建：worker 每次被唤醒都要重建，
   * 只是为了清个缓存就先探一遍引擎可用性不值得
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
   * 只有会换掉引擎链的配置字段才重建。content 每切一次显示模式就写一次配置，而那时页面往往正在翻——
   * 无差别重建会把令牌桶与降级记录一起清掉（chainConfigChanged 的注释里有归类表）
   */
  watchConfig(next => {
    if (!active) return
    active = active.then(
      a => (chainConfigChanged(a.config, next) ? load(next) : { config: next, transport: a.transport }),
      () => load(next),
    )
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
  })
  const ocr = createOcrService({ helper, cache })
  const router = createSessionRouter(transportOf, {
    onDrop: (scope, options) => ocr.cancel(scope, options),
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
  // 右键菜单（issue #146）：第二个入口，动作与 popup 走同一条消息
  installContextMenu({
    create: options => browser.contextMenus.create(options as Parameters<typeof browser.contextMenus.create>[0]),
    removeAll: () => browser.contextMenus.removeAll(),
    onClicked: handler => browser.contextMenus.onClicked.addListener(handler),
    send: (tabId, message) => browser.tabs.sendMessage(tabId, message),
  })
  // The keyboard shortcut (UI.md S-P-50): same toggle, third entry
  installToggleCommand({
    onCommand: handler => browser.commands.onCommand.addListener(handler),
    activeTab: async () => (await browser.tabs.query({ active: true, currentWindow: true }))[0],
    send: (tabId, message) => browser.tabs.sendMessage(tabId, message),
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
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    // **loading 与 complete 都要按一次**。跨文档导航提交得慢时，旧文档在 loading 之后还活着，
    // 到点探针问到的是它、答的是同一个会话，撤销就被放掉了——而它随后就没了，再没人问第二次
    //（Codex 在 #143 指出）。complete 时新文档已经就位：同文档换 hash 的话探针照样答「还在」，
    // 真跳走的话答的就是新会话或者根本答不上
    if (changeInfo.status === 'loading' || changeInfo.status === 'complete') router.mayHaveLeft(tabId)
  })

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
        // A page asking about its own session gets its own chain; everyone else gets the current one
        Promise.resolve((message.scope && router.transportFor(message.scope)) || transportOf())
          .then(t => t.status())
          .then(sendResponse)
          .catch((e: unknown) => console.error('[axt] provider-status 失败', e))
        return true
      case 'axt:engine-ready':
        // 语言包下载完之前建的链里没有这个引擎（buildChain 会把 isAvailable 为假的剔掉），
        // 或者它已被永久降级。重建一条新链，让它重新参与（§8.5，Codex 在 #50 指出）。
        // **迁哪些会话由发起方决定**（Codex 在 #59 / #157 指出）：popup 的语言包下载只对它打开的那个
        // 标签页说过「接下来的段落会用离线翻译」，就只迁那一个；删掉的服务必须处处停用，才迁全部；
        // 其余只重建链，正在翻的页面保留它开始时的那条。被动的配置变更一律不迁（见 sessions.ts）
        activate()
          .then(async a => {
            // Cancelling first is what makes a deleted service stop: re-pointing alone leaves its
            // queued and in-flight work running on the transport being replaced (Codex on #157)
            if (message.rebindAll) await router.dropAndRebindAll(a.transport)
            else if (message.scope) router.rebind(message.scope, a.transport)
            return a.transport.status()
          })
          .then(status => sendResponse({ reset: status.chain.includes(message.id) }))
          .catch(() => sendResponse({ reset: false }))
        return true
      // IndexedDB 不可用时也要回话，否则调用方等到的是"message channel closed"（Codex 在 #7 指出）
      case 'axt:cache-clear':
        // 失败要如实回报：吞掉异常回 { removed: 0 } 的话，IndexedDB 用不了时用户会以为已经清干净（Codex 在 #52 指出）
        translationCache.clear(message.paper)
          .then(removed => sendResponse({ ok: true, removed }))
          .catch((e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }))
        return true
      case 'axt:helper-status':
        ocr.status().then(sendResponse)
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
