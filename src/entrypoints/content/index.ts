import type { Config } from '@/config/schema'
import { getConfig, setConfig } from '@/config/storage'
import { buildChain } from '@/providers'
import type { TranslationProvider } from '@/providers/types'
import { createTranslateService } from '@/providers/translate-service'
import { createFallbackService, type FallbackService } from '@/providers/fallback'
import { extract, paperContext, type Block } from '@/core/extractor'
import { statsOf } from '@/core/extractor/stats'
import { paperIdFromUrl, startTranslation, type Progress, type TranslationRun } from '@/core/pipeline'
import {
  alignPairMargins, clearPairMargins, createMirrors, createModeController, fitTables, localizeNotes, restore,
  splitFigures,
  type Mode, type ModeController,
} from '@/core/renderer'
import { decodeText, escapeText } from '@/core/protector/text'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { beginSession, createCoalescer, endSession, getSessionId, translateTitle, type TitleTranslator } from '@/core/scheduler'
import { isAxtMessage, type PageStatus } from '@/shared/messages'
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
    const paperContextValue = paperContext(document)
    console.debug(`[axt] extracted ${blocks.length} blocks in ${Math.round(performance.now() - t0)} ms`)

    const paper = paperIdFromUrl(location.href)
    // 模式：偏好存配置，实际生效的由 ModeController 按视口决定（§7.2）。
    // 翻译开始前不建控制器，免得往没翻译过的页面写 data-axt-mode；popup 这时看到的是配置里的偏好。
    let modes: ModeController | null = null
    let savedMode: Mode = 'stack'
    /** 译文样式（§7.5）：与模式一样只是 <html> 上的属性；开始翻译时从配置读一次 */
    let style: Config['style'] = { preset: 'none', customCss: '' }
    void getConfig().then(config => { savedMode = config.mode; style = config.style })
    // 一次会话 = 一个翻译服务 + 一个运行（观察器与请求）+ 一个 session id 作取消范围（DESIGN §10）
    let service: FallbackService | null = null
    let activeChain: TranslationProvider[] | null = null
    let run: TranslationRun | null = null
    let title: TitleTranslator | null = null
    const idle = (): Progress => ({ state: 'idle', total: blocks.length, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 })
    let progress: Progress = idle()

    /** 实际在用的引擎与降级原因（§8.5），给 popup 显示 */
    function engineStatus(): { engine: NonNullable<PageStatus['engine']> } | null {
      if (!service || !activeChain) return null
      const status = service.status()
      const active = activeChain.find(engine => engine.id === status.activeId) ?? activeChain[0]!
      return {
        engine: {
          id: active.id,
          displayName: active.displayName,
          ...(status.activeId !== status.configuredId && status.demoted
            ? { demoted: { displayName: status.demoted.displayName, kind: status.demoted.kind, message: status.demoted.message } }
            : {}),
        },
      }
    }

    /** 结束当前会话：断开观察器、删 pending、撤掉排队与在飞的请求；页面上的译文留着 */
    function endRun(): void {
      title?.stop()
      title = null
      run?.stop()
      run = null
      const session = endSession()
      // 先撤请求再丢服务：排队的批次不再发出，在飞的 fetch 被 abort，结果回来也不渲染不写缓存
      if (service && session) service.cancel(session)
      service = null
      activeChain = null
    }

    async function start(requested?: Mode): Promise<{ started: boolean; reason?: string }> {
      if (progress.state === 'on') return { started: false, reason: '翻译已开启，滚动会继续翻' }
      if (!paper) return { started: false, reason: '不是 arXiv HTML 页面' }
      if (blocks.length === 0) return { started: false, reason: '页面里没有可翻译的块' }
      // provider 直接在 content 侧构造与调用（DESIGN §8.0）：MV3 的 service worker 会在等待中被挂起，
      // 冷启动时一条无 I/O 的消息也要等几十秒。现在只有缓存读写走消息，翻译本身不经过 background。
      const tStart = performance.now()
      const config = await getConfig()
      // 术语表随每批发出（§8.2）。**空表不带这个字段**：带上会让所有既有缓存键变一遍，一次性全失效
      const context = config.glossary.length > 0 ? { ...paperContextValue, glossary: config.glossary } : paperContextValue
      // 降级链（§8.5）：首选引擎失败时自动切到免费引擎，别让整页翻译停死
      const chain = await buildChain(config)
      const provider = chain[0]!
      // 首选不可用而链上还有兜底时照常开始：请求会直接落到免费引擎上
      if (!(await provider.isAvailable()) && chain.length === 1) return { started: false, reason: '未配置 API key，请先到设置页填写' }
      console.debug(`[axt] start: ready in ${Math.round(performance.now() - tStart)} ms, since page start ${Math.round(tStart)} ms`)

      modes?.stop()
      modes = createModeController(document, requested ?? config.mode, { onChange: enterSide })
      style = config.style
      endRun() // 上一轮停下但没恢复原文的会话（致命错误后重试）
      const session = beginSession()
      progress = { ...idle(), state: 'on' }
      enterSide(modes.effective())
      // 链上每个引擎一套队列与缓存键，共用同一个缓存端口
      const cachePort = createMessageCachePort()
      const translate = createFallbackService(chain.map(engine => ({
        provider: engine,
        service: createTranslateService({
          getProvider: async () => engine,
          // 模型名只对 LLM 有意义；免费引擎不带，免得换模型时白白让它的缓存失效
          getModel: async () => (engine.id === 'openai-compat' ? config.openaiCompat.model : undefined),
          cache: cachePort,
        }),
      })))
      service = translate
      activeChain = chain
      const t1 = performance.now()
      let wasBusy = false
      run = startTranslation({
        doc: document,
        blocks,
        target: config.targetLanguage,
        mode: modes.effective(),
        style,
        paper,
        // 标题 + 摘要每批都带（DESIGN §8.2）
        context,
        capabilities: { maxBatchChars: provider.maxBatchChars, maxBatchItems: provider.maxBatchItems, preservesMarkup: provider.preservesMarkup },
        transport: request => translate.translate(request),
        scope: session,
        preload: config.preload,
        onProgress: p => {
          // 会话已结束（恢复原文 / 重开）：旧运行的回调一律忽略
          if (getSessionId() !== session) return
          progress = p
          prep.schedule()
          // 翻译是"开着"的状态，没有终点；每次从忙到闲打一条日志，e2e 与手测靠它
          const busy = p.inFlight > 0
          if (wasBusy && !busy) {
            console.debug(`[axt] session idle: ${p.done}/${p.requested} requested of ${p.total}, ${p.failed} failed, ${p.cached} cached, ${Math.round(performance.now() - t1)} ms${p.fatal ? `, fatal: ${p.fatal}` : ''}`)
          }
          wasBusy = busy
        },
      })
      run.ready.catch(e => console.error('[axt] translation crashed', e))
      // 标签页标题也翻（§10）：走同一个服务、同一份缓存；标题是纯文本，按占位符协议转义再解码
      title = translateTitle(document, {
        isCurrent: () => getSessionId() === session,
        translate: async text => {
          const res = await translate.translate({
            request: { segments: [{ id: 'document.title', text: escapeText(text) }], source: 'en', target: config.targetLanguage, context },
            cache: { paper, renderPath: 'markup' },
            scope: session,
          })
          return res.ok ? decodeText(res.result.segments[0]?.text ?? '') || null : null
        },
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
      endRun()
      modes?.stop()
      modes = null
      fitObserver?.disconnect()
      fitObserver = null
      prep.cancel()
      const result = restore(document)
      progress = idle()
      console.debug(`[axt] translation stopped: ${result.removedNodes} nodes removed`)
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
        case 'axt:retry-failed': {
          const failed = run?.failed() ?? []
          void run?.translate(failed)
          sendResponse({ retried: failed.length })
          return true
        }
        case 'axt:page-status':
          sendResponse({ paper, mode: modes?.effective() ?? savedMode, preference: modes?.preference() ?? savedMode, progress, ...(engineStatus() ?? {}) })
          return true
      }
    })

    if (location.hash === '#axt-debug') enableDebug(blocks)
    if (location.hash === '#axt-translate') void start()
  },
})
