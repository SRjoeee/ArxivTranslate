import { getConfig, setConfig } from '@/config/storage'
import { getProvider } from '@/providers'
import { createTranslateService } from '@/providers/translate-service'
import { extract, type Block } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { paperIdFromUrl, runTranslation, type Progress } from '@/core/pipeline'
import {
  alignPairMargins, clearPairMargins, createMirrors, createModeController, fitTables, restore, splitFigures,
  type Mode, type ModeController,
} from '@/core/renderer'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { createViewportTracker, withViewportAnchor, type ViewportTracker } from '@/core/scheduler'
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
        capabilities: { maxBatchChars: provider.maxBatchChars, maxBatchItems: provider.maxBatchItems, preservesMarkup: provider.preservesMarkup },
        transport: request => translate(request),
        onProgress: p => { progress = p; scheduleSidePrep() },
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

    let fitObserver: ResizeObserver | null = null
    let fitTimer = 0

    /**
     * side 模式的两件准备都依赖"译文已经在 DOM 里"：镜像要看哪些内容没有配对，
     * 表格缩放要看哪些表格有了译文。译文是逐块到达的，所以随进度去抖重算，
     * 而不是进入模式时跑一次（跑早了会把整篇内容当成没有配对的内容复制一遍）。
     */
    function scheduleSidePrep(): void {
      if (modes?.effective() !== 'side') return
      clearTimeout(fitTimer)
      fitTimer = window.setTimeout(() => {
        if (modes?.effective() !== 'side') return
        // 先整块拆插图，再补镜像：拆过的插图不再参与镜像（两套方案会重复一份）
        const split = splitFigures(document)
        const made = createMirrors(document)
        const fit = fitTables(document)
        // 边距对齐要在镜像之后：镜像也是译文节点，同样会被站点的相邻兄弟规则影响
        const aligned = alignPairMargins(document)
        if (split || made || fit.fitted || fit.scrolled || aligned) {
          console.debug(
            `[axt] side prep: +${split} figures split, +${made} mirrors, ${fit.fitted} tables scaled, `
            + `${fit.scrolled} scrollable, ${aligned} margins aligned`,
          )
        }
      }, 150)
    }

    /** 进入 side 时的准备：右栏补一份公式与图表（§7.2），并把表格缩到能装进一栏 */
    function enterSide(effective: Mode): void {
      if (effective !== 'side') {
        fitObserver?.disconnect()
        fitObserver = null
        clearTimeout(fitTimer)
        // 对齐用的内联边距只服务于左右分栏，其他模式下要还给站点样式
        clearPairMargins(document)
        return
      }
      scheduleSidePrep()
      // 栏宽随窗口变化，缩放比例要跟着重算。只在宽度真的变了才重算——
      // 缩放表格本身也会让观察目标报告一次尺寸变化，不设这道闸就会自激振荡
      if (!fitObserver && typeof ResizeObserver === 'function') {
        let lastWidth = 0
        fitObserver = new ResizeObserver(entries => {
          const width = Math.round(entries[0]?.contentRect.width ?? 0)
          if (width === lastWidth) return
          lastWidth = width
          scheduleSidePrep()
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
      tracker?.disconnect()
      tracker = null
      modes?.stop()
      modes = null
      fitObserver?.disconnect()
      fitObserver = null
      clearTimeout(fitTimer)
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
