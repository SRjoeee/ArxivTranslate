import { translationCache } from '@/cache'
import { getConfig } from '@/config/storage'
import { getProvider } from '@/providers'
import { isAxtMessage } from '@/shared/messages'
import { handlePing } from '@/shared/ping'
import { createStatusHandler, createTranslateHandler } from './translate-handler'

// background：消息路由 + 翻译队列 + 缓存。WXT ≥0.20 不带 polyfill，异步响应必须用 sendResponse + return true。
export default defineBackground(() => {
  const providerFromConfig = async () => getProvider(await getConfig())
  const modelFromConfig = async () => (await getConfig()).openaiCompat.model
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
      case 'axt:provider-status': {
        const t0 = performance.now()
        status().then(result => {
          console.debug(`[axt] provider-status answered in ${Math.round(performance.now() - t0)} ms`)
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
