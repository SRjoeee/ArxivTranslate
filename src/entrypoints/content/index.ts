import { getConfig } from '@/config/storage'
import { extract, type Block } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { paperIdFromUrl, runTranslation, type Progress } from '@/core/pipeline'
import { restore, type Mode } from '@/core/renderer'
import { createViewportTracker, withViewportAnchor, type ViewportTracker } from '@/core/scheduler'
import { isAxtMessage, sendMessage } from '@/shared/messages'
import { enableDebug } from './debug'

// 注入 arxiv.org/html/*。页面加载只 extract（不写 DOM），Block[] 留在内存里；
// popup 发 axt:translate-page 才开始翻译（DESIGN §4.1）。URL 带 #axt-debug 描边、#axt-translate 自动开始，便于调试与自动化验证。
export default defineContentScript({
  matches: ['https://arxiv.org/html/*'],
  runAt: 'document_idle',
  main() {
    const t0 = performance.now()
    const blocks: Block[] = extract(document)
    console.debug(`[axt] extracted ${blocks.length} blocks in ${Math.round(performance.now() - t0)} ms`)

    const paper = paperIdFromUrl(location.href)
    let mode: Mode = 'stack'
    let controller: AbortController | null = null
    let tracker: ViewportTracker | null = null
    const idle = (): Progress => ({ state: 'idle', total: blocks.length, done: 0, failed: 0, cached: 0 })
    let progress: Progress = idle()

    async function start(requested?: Mode): Promise<{ started: boolean; reason?: string }> {
      if (progress.state === 'running') return { started: false, reason: '翻译进行中' }
      if (!paper) return { started: false, reason: '不是 arXiv HTML 页面' }
      if (blocks.length === 0) return { started: false, reason: '页面里没有可翻译的块' }
      // 实测过页面加载后 20–90 s 才开始翻译，分段计时：读配置 / ping 往返 / provider-status 往返。
      // ping 回传 background 的墙钟：投递延迟 = 收到时刻 - 发出时刻，SW 年龄 = 收到时刻 - SW 启动时刻。
      const tStart = performance.now()
      const config = await getConfig()
      const tConfig = performance.now()
      const pingSentAt = Date.now()
      const pong = await sendMessage({ type: 'axt:ping' })
      const tPing = performance.now()
      const statusSentAt = Date.now()
      const status = await sendMessage({ type: 'axt:provider-status' })
      const statusGotAt = Date.now()
      console.debug(
        `[axt] start: config ${Math.round(tConfig - tStart)} ms, ping ${Math.round(tPing - tConfig)} ms`
        + ` (投递 ${pong.at - pingSentAt} ms, SW 年龄 ${Math.round((pong.at - pong.bootedAt) / 1000)} s)`
        + `, provider-status ${Math.round(performance.now() - tPing)} ms`
        + ` (投递 ${status.receivedAt - statusSentAt} ms, 处理 ${status.answeredAt - status.receivedAt} ms, 回程 ${statusGotAt - status.answeredAt} ms)`
        + `, since page start ${Math.round(tStart)} ms`,
      )
      if (!status.available) return { started: false, reason: '未配置 API key，请先到设置页填写' }

      mode = requested ?? config.mode
      controller = new AbortController()
      progress = { ...idle(), state: 'running' }
      tracker?.disconnect()
      tracker = createViewportTracker(blocks)
      const activeTracker = tracker
      const t1 = performance.now()
      void runTranslation({
        doc: document,
        blocks,
        target: config.targetLanguage,
        mode,
        paper,
        capabilities: { maxBatchChars: status.maxBatchChars, maxBatchItems: status.maxBatchItems, preservesMarkup: status.preservesMarkup },
        transport: request => sendMessage({ type: 'axt:translate', ...request }),
        onProgress: p => { progress = p },
        signal: controller.signal,
        // 视口优先 + 插入译文时的滚动锚定（DESIGN §10）
        isPriority: block => activeTracker.isNear(block),
        anchor: withViewportAnchor,
      })
        .finally(() => activeTracker.disconnect())
        .then(p => {
          progress = p
          console.debug(`[axt] translation ${p.state}: ${p.done}/${p.total} done, ${p.failed} failed, ${p.cached} cached, ${Math.round(performance.now() - t1)} ms${p.fatal ? `, fatal: ${p.fatal}` : ''}`)
        })
        .catch(e => {
          progress = { ...progress, state: 'done', fatal: e instanceof Error ? e.message : String(e) }
          console.error('[axt] translation crashed', e)
        })
      return { started: true }
    }

    function restorePage(): { removedNodes: number } {
      controller?.abort()
      tracker?.disconnect()
      tracker = null
      const result = restore(document)
      progress = idle()
      return { removedNodes: result.removedNodes }
    }

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isAxtMessage(message)) return
      switch (message.type) {
        case 'axt:stats':
          sendResponse(statsOf(blocks))
          return true
        case 'axt:translate-page':
          start(message.mode).then(sendResponse)
          return true
        case 'axt:restore-page':
          sendResponse(restorePage())
          return true
        case 'axt:page-status':
          sendResponse({ paper, mode, progress })
          return true
      }
    })

    if (location.hash === '#axt-debug') enableDebug(blocks)
    if (location.hash === '#axt-translate') void start()
  },
})
