import { getConfig, setConfig } from '@/config/storage'
import { getProvider } from '@/providers'
import { createTranslateService } from '@/providers/translate-service'
import { extract, paperContext, type Block } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { paperIdFromUrl, runTranslation, type Progress } from '@/core/pipeline'
import {
  alignPairMargins, clearPairMargins, createMirrors, createModeController, fitTables, localizeNotes, restore,
  splitFigures,
  type Mode, type ModeController,
} from '@/core/renderer'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { createCoalescer, createViewportTracker, type ViewportTracker } from '@/core/scheduler'
import { isAxtMessage } from '@/shared/messages'
import { createMessageCachePort } from './cache-port'
import { enableDebug } from './debug'

// 注入 arxiv.org/html/*。页面加载只 extract（不写 DOM），Block[] 留在内存里；
// popup 发 axt:translate-page 才开始翻译（DESIGN §4.1）。URL 带 #axt-debug 描边、#axt-translate 自动开始，便于调试与自动化验证。
export default defineContentScript({
  matches: ['https://arxiv.org/html/*'],
  runAt: 'document_idle',
  main() {
    const t0 = performance.now()
    const blocks: Block[] = extract(document)
    // 标题 + 摘要在这里抽一次：此时 DOM 里还没有译文，翻译过再抽会把上一轮的译文也算进摘要
    const context = paperContext(document)
    console.debug(`[axt] extracted ${blocks.length} blocks in ${Math.round(performance.now() - t0)} ms`)

    const paper = paperIdFromUrl(location.href)
    // 模式：偏好存配置，实际生效的由 ModeController 按视口决定（§7.2）。
    // 翻译开始前不建控制器，免得往没翻译过的页面写 data-axt-mode；popup 这时看到的是配置里的偏好。
    let modes: ModeController | null = null
    let savedMode: Mode = 'stack'
    void getConfig().then(config => { savedMode = config.mode })
    let controller: AbortController | null = null
    let tracker: ViewportTracker | null = null
    const idle = (): Progress => ({ state: 'idle', total: blocks.length, done: 0, failed: 0, cached: 0 })
    let progress: Progress = idle()

    async function start(requested?: Mode): Promise<{ started: boolean; reason?: string }> {
      if (progress.state === 'running') return { started: false, reason: '翻译进行中' }
      if (!paper) return { started: false, reason: '不是 arXiv HTML 页面' }
      if (blocks.length === 0) return { started: false, reason: '页面里没有可翻译的块' }
      // provider 直接在 content 侧构造与调用（DESIGN §8.0）：MV3 的 service worker 会在等待中被挂起，
      // 冷启动时一条无 I/O 的消息也要等几十秒。现在只有缓存读写走消息，翻译本身不经过 background。
      const tStart = performance.now()
      const config = await getConfig()
      const provider = getProvider(config)
      if (!(await provider.isAvailable())) return { started: false, reason: '未配置 API key，请先到设置页填写' }
      console.debug(`[axt] start: ready in ${Math.round(performance.now() - tStart)} ms, since page start ${Math.round(tStart)} ms`)

      modes?.stop()
      modes = createModeController(document, requested ?? config.mode, { onChange: enterSide })
      controller = new AbortController()
      // 被恢复或被新一轮取代的运行，其回调一律忽略：旧运行最后一次上报会把 idle 覆盖成 cancelled，
      // popup 于是允许再开一轮并发翻译（Codex 在 #9 指出）
      const run = controller
      progress = { ...idle(), state: 'running' }
      tracker?.disconnect()
      tracker = createViewportTracker(blocks)
      const activeTracker = tracker
      enterSide(modes.effective())
      const translate = createTranslateService({
        getProvider: async () => provider,
        // 模型名只对 LLM 有意义；免费引擎不带，免得换模型时白白让它的缓存失效
        getModel: async () => (config.provider === 'openai-compat' ? config.openaiCompat.model : undefined),
        cache: createMessageCachePort(),
      })
      const t1 = performance.now()
      void runTranslation({
        doc: document,
        blocks,
        target: config.targetLanguage,
        mode: modes.effective(),
        paper,
        // 标题 + 摘要每批都带（DESIGN §8.2）
        context,
        capabilities: { maxBatchChars: provider.maxBatchChars, maxBatchItems: provider.maxBatchItems, preservesMarkup: provider.preservesMarkup },
        transport: request => translate(request),
        onProgress: p => {
          if (controller !== run) return
          progress = p
          prep.schedule()
        },
        signal: run.signal,
        // 视口优先（DESIGN §10）；视口不跳交给浏览器原生 scroll anchoring，这里不再做布局读取
        isPriority: block => activeTracker.isNear(block),
      })
        .finally(() => activeTracker.disconnect())
        .then(p => {
          if (controller !== run) return
          progress = p
          console.debug(`[axt] translation ${p.state}: ${p.done}/${p.total} done, ${p.failed} failed, ${p.cached} cached, ${Math.round(performance.now() - t1)} ms${p.fatal ? `, fatal: ${p.fatal}` : ''}`)
        })
        .catch(e => {
          if (controller !== run) return
          progress = { ...progress, state: 'done', fatal: e instanceof Error ? e.message : String(e) }
          console.error('[axt] translation crashed', e)
        })
      return { started: true }
    }

    let fitObserver: ResizeObserver | null = null

    /**
     * 译文到达后的整理：脚注译文搬进副本（三种模式都要），side 模式再补镜像、拆图、缩表、对齐边距。
     * 译文是逐块到达的，随进度合并执行；纯去抖会被连续的进度回调饿死，直到整篇翻完才跑
     * （实测 413 个镜像在最后一刻同时出现），所以用带最长等待的合并器。
     */
    const prep = createCoalescer(() => {
      localizeNotes(document)
      if (modes?.effective() !== 'side') return
      // 先整块拆插图，再补镜像：拆过的插图不再参与镜像（两套方案会重复一份）
      const split = splitFigures(document)
      const made = createMirrors(document)
      const fit = fitTables(document)
      // 边距对齐要在镜像之后：镜像也是译文节点，同样会被站点的相邻兄弟规则影响
      const aligned = alignPairMargins(document)
      if (split || made || fit.fitted || fit.scrolled || aligned) {
        console.debug(
          `[axt] side prep: +${split} figures split, +${made} mirrors, `
          + `${fit.fitted} tables scaled, ${fit.scrolled} scrollable, ${aligned} margins aligned`,
        )
      }
    }, { delay: 150, maxWait: 1000 })

    /** 进入 side 时的准备：右栏补一份公式与图表（§7.2），并把表格缩到能装进一栏 */
    function enterSide(effective: Mode): void {
      if (effective !== 'side') {
        fitObserver?.disconnect()
        fitObserver = null
        prep.cancel()
        // 对齐用的内联边距只服务于左右分栏，其他模式下要还给站点样式
        clearPairMargins(document)
        return
      }
      prep.schedule()
      // 栏宽随窗口变化，缩放比例要跟着重算。只在宽度真的变了才重算——
      // 缩放表格本身也会让观察目标报告一次尺寸变化，不设这道闸就会自激振荡
      if (!fitObserver && typeof ResizeObserver === 'function') {
        let lastWidth = 0
        fitObserver = new ResizeObserver(entries => {
          const width = Math.round(entries[0]?.contentRect.width ?? 0)
          if (width === lastWidth) return
          lastWidth = width
          prep.schedule()
        })
        const target = document.querySelector(DOCUMENT_ROOT)
        if (target) fitObserver.observe(target)
      }
    }

    async function setPageMode(mode: Mode): Promise<{ mode: Mode; effective: Mode }> {
      // 没在翻译时也允许切换：控制器会把属性写到 <html> 上，样式立刻生效
      if (!modes) modes = createModeController(document, mode, { onChange: enterSide })
      const effective = modes.choose(mode)
      enterSide(effective)
      savedMode = mode
      const config = await getConfig()
      if (config.mode !== mode) await setConfig({ ...config, mode })
      return { mode, effective }
    }

    function restorePage(): { removedNodes: number } {
      controller?.abort()
      controller = null
      tracker?.disconnect()
      tracker = null
      modes?.stop()
      modes = null
      fitObserver?.disconnect()
      fitObserver = null
      prep.cancel()
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
        case 'axt:set-mode':
          setPageMode(message.mode).then(r => sendResponse({ mode: r.effective, preference: r.mode }))
          return true
        case 'axt:page-status':
          sendResponse({ paper, mode: modes?.effective() ?? savedMode, preference: modes?.preference() ?? savedMode, progress })
          return true
      }
    })

    if (location.hash === '#axt-debug') enableDebug(blocks)
    if (location.hash === '#axt-translate') void start()
  },
})
