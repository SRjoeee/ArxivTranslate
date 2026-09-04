import { translationCache } from '@/cache'
import { getConfig } from '@/config/storage'
import { getProvider } from '@/providers'
import { isAxtMessage } from '@/shared/messages'
import { handlePing } from '@/shared/ping'
import { createStatusHandler, createTranslateHandler } from './translate-handler'

// background：消息路由 + 翻译队列 + 缓存。WXT ≥0.20 不带 polyfill，异步响应必须用 sendResponse + return true。
export default defineBackground(() => {
  // 排查 content 侧 provider-status 往返 50–90 s：ping 回传这两个墙钟，content 侧就能分辨投递慢还是 SW 冷启动
  const bootedAt = Date.now()
  console.debug(`[axt] background booted at ${new Date(bootedAt).toISOString()}`)
  const providerFromConfig = async () => getProvider(await getConfig())
  const modelFromConfig = async () => (await getConfig()).openaiCompat.model
  const translate = createTranslateHandler({ getProvider: providerFromConfig, getModel: modelFromConfig, cache: translationCache })
  const status = createStatusHandler({ getProvider: providerFromConfig, getModel: modelFromConfig })

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:ping':
        sendResponse(handlePing(browser.runtime.getManifest().version, Date.now(), bootedAt))
        return true
      case 'axt:translate':
        translate({ request: message.request, providerId: message.providerId, cache: message.cache }).then(sendResponse)
        return true
      case 'axt:provider-status': {
        const t0 = performance.now()
        const receivedAt = new Date().toISOString()
        status().then(result => {
          console.debug(`[axt] provider-status received at ${receivedAt}, answered in ${Math.round(performance.now() - t0)} ms, sw age ${Math.round((Date.now() - bootedAt) / 1000)} s`)
          sendResponse(result)
        })
        return true
      }
      case 'axt:cache-clear':
        translationCache.clear(message.paper).then(removed => sendResponse({ removed }))
        return true
      case 'axt:cache-stats':
        translationCache.stats().then(sendResponse)
        return true
    }
  })
})
