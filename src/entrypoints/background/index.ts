import { getConfig } from '@/config/storage'
import { getProvider } from '@/providers'
import { isAxtMessage } from '@/shared/messages'
import { handlePing } from '@/shared/ping'
import { createStatusHandler, createTranslateHandler } from './translate-handler'

// background：消息路由 + 翻译队列。WXT ≥0.20 不带 polyfill，异步响应必须用 sendResponse + return true。
export default defineBackground(() => {
  const providerFromConfig = async () => getProvider(await getConfig())
  const translate = createTranslateHandler({ getProvider: providerFromConfig })
  const status = createStatusHandler({ getProvider: providerFromConfig, getModel: async () => (await getConfig()).openaiCompat.model })

  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:ping':
        sendResponse(handlePing(browser.runtime.getManifest().version))
        return true
      case 'axt:translate':
        translate({ request: message.request, providerId: message.providerId }).then(sendResponse)
        return true
      case 'axt:provider-status':
        status().then(sendResponse)
        return true
    }
  })
})
