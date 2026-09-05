import type { Config } from '@/config/schema'
import { cachePortOf, translationCache } from '@/cache'
import { getConfig, watchConfig } from '@/config/storage'
import { chainConfigChanged, createLocalTransport, type TranslationTransport } from '@/providers/transport'
import { toErrorInfo } from '@/providers/translate-service'
import { isAxtMessage } from '@/shared/messages'
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

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:ping':
        sendResponse(handlePing(browser.runtime.getManifest().version))
        return true
      case 'axt:translate':
        // 建链失败（provider 构造抛错）也要如实回话：不回的话调用方等到的是"message channel closed"
        transportOf()
          .then(t => t.translate(message))
          .catch((e: unknown) => ({ ok: false as const, error: toErrorInfo(e) }))
          .then(sendResponse)
        return true
      case 'axt:cancel-scope':
        transportOf()
          .then(t => t.cancel(message.scope))
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
        // 或者它已被永久降级。重建一条新链，让它重新参与（§8.5，Codex 在 #50 指出）
        activate()
          .then(a => a.transport.status())
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
