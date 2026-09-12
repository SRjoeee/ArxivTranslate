import { getConfig, setConfig, watchConfig } from '@/config/storage'
import { AUTO_TRANSLATE_HASH } from '@/core/abstract/link'
import { extract, paperContext } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { paperIdFromUrl } from '@/core/pipeline'
import { createPageSession } from '@/core/session'
import { isAxtMessage, sendMessage } from '@/shared/messages'
import { createMessageTransport } from '@/shared/transport'
import { applyLocaleFrom } from '@/ui/apply-locale'
import { enableDebug } from './debug'

// 注入 arxiv.org/html/*。页面加载只 extract（不写 DOM），Block[] 留在内存里；
// popup 发 axt:translate-page 才开始翻译（DESIGN §4.1）。URL 带 #axt-debug 描边、#axt-translate 自动开始，便于调试与自动化验证。
//
// This file is an adapter (ADR-0004): the session's state and decisions live in core/session; here
// the browser's messages, the configuration subscription and the URL hash are mapped onto it.
export default defineContentScript({
  matches: ['https://arxiv.org/html/*'],
  runAt: 'document_idle',
  main() {
    const t0 = performance.now()
    const blocks = extract(document)
    // 标题 + 摘要在这里抽一次：此时 DOM 里还没有译文，翻译过再抽会把上一轮的译文也算进摘要
    const context = paperContext(document)
    console.debug(`[axt] extracted ${blocks.length} blocks in ${Math.round(performance.now() - t0)} ms`)

    // 引擎链、队列与请求都在 background（DESIGN §8.0）：content 的 fetch 带页面 origin、要走 CORS 预检，
    // 而且 https 页面够不着 http 端点（本地 Ollama），实测见 RESEARCH §6.7。这里只留一条消息代理
    const session = createPageSession({
      doc: document,
      blocks,
      paper: paperIdFromUrl(location.href),
      context,
      backend: createMessageTransport(),
      ocr: call => sendMessage({ type: 'axt:ocr', ...call }),
      helperStatus: () => sendMessage({ type: 'axt:helper-status' }),
      config: { get: getConfig, set: setConfig },
      applyLocale: applyLocaleFrom,
      trace: line => console.debug(`[axt] ${line}`),
    })
    // 用 watchConfig 而不是消息：设置页自己就是活动标签页，发不到内容页；订阅还能同时更新所有打开的论文
    watchConfig(config => session.onConfig(config))

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isAxtMessage(message)) return
      switch (message.type) {
        case 'axt:stats':
          sendResponse(statsOf(blocks))
          return true
        case 'axt:translate-page':
          session.start(message.mode, message.restart === true).then(sendResponse)
          return true
        case 'axt:restore-page':
          sendResponse(session.restore())
          return true
        case 'axt:set-mode':
          session.setMode(message.mode).then(r => sendResponse({ mode: r.effective, preference: r.mode }))
          return true
        case 'axt:retry-failed':
          sendResponse({ retried: session.retryFailed() })
          return true
        case 'axt:helper-ready':
          sendResponse({ resumed: session.resumeRaster() })
          return true
        case 'axt:page-status':
          void session.status().then(sendResponse)
          return true
      }
    })

    if (location.hash === '#axt-debug') enableDebug(blocks)
    if (location.hash === AUTO_TRANSLATE_HASH) void session.start()
  },
})
