import { translationCache } from '@/cache'
import { getConfig } from '@/config/storage'
import { getProvider } from '@/providers'
import { isAxtMessage } from '@/shared/messages'
import { handlePing } from '@/shared/ping'
import { createStatusHandler, createTranslateHandler } from './translate-handler'

// background：消息路由 + 翻译队列 + 缓存。WXT ≥0.20 不带 polyfill，异步响应必须用 sendResponse + return true。
export default defineBackground(() => {
  const providerFromConfig = async () => getProvider(await getConfig())
  const modelFromConfig = async () => {
    const config = await getConfig()
    return config.provider === 'openai-compat' ? config.openaiCompat.model : undefined
  }
  const translate = createTranslateHandler({ getProvider: providerFromConfig, getModel: modelFromConfig, cache: translationCache })
  const status = createStatusHandler({ getProvider: providerFromConfig, getModel: modelFromConfig })

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:ping':
        sendResponse(handlePing(browser.runtime.getManifest().version))
        return true
      case 'axt:translate':
        translate({ request: message.request, providerId: message.providerId, cache: message.cache }).then(sendResponse)
        return true
      case 'axt:provider-status':
        status().then(sendResponse)
        return true
      case 'axt:cache-get':
        Promise.all(message.keys.map(key => translationCache.get(key)))
          .then(hits => sendResponse({ hits }))
          .catch(() => sendResponse({ hits: message.keys.map(() => null) }))
        return true
      case 'axt:cache-put':
        (async () => {
          let written = 0
          for (const entry of message.entries) if (await translationCache.set(entry.key, entry.translation, entry.paper)) written++
          return written
        })().then(written => sendResponse({ written })).catch(() => sendResponse({ written: 0 }))
        return true
      // IndexedDB 不可用时也要回话，否则调用方等到的是"message channel closed"（Codex 在 #7 指出）
      case 'axt:cache-clear':
        // 失败要如实回报：吞掉异常回 { removed: 0 } 的话，IndexedDB 用不了时用户会以为已经清干净（Codex 在 #52 指出）
        translationCache.clear(message.paper)
          .then(removed => sendResponse({ ok: true, removed }))
          .catch((e: unknown) => sendResponse({ ok: false, message: e instanceof Error ? e.message : String(e) }))
        return true
      case 'axt:cache-stats':
        translationCache.stats().then(sendResponse).catch(() => sendResponse({ entries: 0, bytes: 0 }))
        return true
    }
  })
})
