import type { Config } from '@/config/schema'
import { cachePortOf, translationCache } from '@/cache'
import { getConfig, watchConfig } from '@/config/storage'
import { chainConfigChanged, createLocalTransport, type TranslationTransport } from '@/providers/transport'
import { toErrorInfo } from '@/providers/translate-service'
import { isAxtMessage } from '@/shared/messages'
import { createSessionRouter } from './sessions'
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
   * 这是有意的取舍——宁可短暂多一套队列，也不能让一轮译文中途换引擎或换语言（Codex 在 #59 指出）
   */
  const router = createSessionRouter(transportOf)

  // 两个生命周期钩子都只给 tabId / status，不需要 "tabs" 权限
  const dropTab = (tabId: number, why: string) => {
    void router.dropTab(tabId).then(n => {
      if (n > 0) console.debug(`[axt] 标签页 ${tabId} ${why}，撤掉 ${n} 个排队 / 在飞的请求`)
    })
  }
  browser.tabs.onRemoved.addListener(tabId => dropTab(tabId, '关闭'))
  /**
   * 导航离开也要撤（Codex 在 #59 指出）：`onRemoved` 只管关闭，标签页跳到别的网址时不触发。
   * 而「同一标签页出现新 scope 就撤掉旧的」那条只在**新页面也是 arXiv 论文**时才会发生——
   * 跳到任何别的站点，旧队列就一直跑到批次耗尽预算为止
   */
  browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
    if (changeInfo.status === 'loading') dropTab(tabId, '导航离开')
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
        transportOf()
          .then(t => t.status())
          .then(sendResponse)
          .catch((e: unknown) => console.error('[axt] provider-status 失败', e))
        return true
      case 'axt:engine-ready':
        // 语言包下载完之前建的链里没有这个引擎（buildChain 会把 isAvailable 为假的剔掉），
        // 或者它已被永久降级。重建一条新链，让它重新参与（§8.5，Codex 在 #50 指出）。
        // **进行中的会话也要迁过去**（Codex 在 #59 指出）：popup 明说「接下来的段落会用离线引擎」，
        // 不迁的话那一页会一直用着旧的兜底链，承诺落空。这是用户显式动作，与被动的配置变更不同——
        // 后者故意不迁（见 sessions.ts）
        activate()
          .then(async a => {
            router.rebindAll(a.transport)
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
