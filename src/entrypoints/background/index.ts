import { isAxtMessage } from '@/shared/messages'
import { handlePing } from '@/shared/ping'

// background：消息路由。WXT ≥0.20 不带 polyfill，异步响应必须用 sendResponse + return true。
export default defineBackground(() => {
  browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!isAxtMessage(message)) return
    switch (message.type) {
      case 'axt:ping':
        sendResponse(handlePing(browser.runtime.getManifest().version))
        return true
    }
  })
})
