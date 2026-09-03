import { extract, type Block } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { isAxtMessage } from '@/shared/messages'
import { enableDebug } from './debug'

// 注入 arxiv.org/html/*。页面加载只 extract（不写 DOM），Block[] 留在内存里供 popup 统计；
// URL 带 #axt-debug 时才标记块并描边（DESIGN §4.1）。翻译流程从 Phase 2 起接入。
export default defineContentScript({
  matches: ['https://arxiv.org/html/*'],
  runAt: 'document_idle',
  main() {
    const t0 = performance.now()
    const blocks: Block[] = extract(document)
    console.debug(`[axt] extracted ${blocks.length} blocks in ${Math.round(performance.now() - t0)} ms`)

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (isAxtMessage(message) && message.type === 'axt:stats') {
        sendResponse(statsOf(blocks))
        return true
      }
    })

    if (location.hash === '#axt-debug') enableDebug(blocks)
  },
})
