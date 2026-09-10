import { type RenderPath, wireFormatOf } from '@/cache/key'
import { type Look, lookOf } from '@/config/appearance'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import { getConfig, setConfig, watchConfig } from '@/config/storage'
import { extract, paperContext, type Block } from '@/core/extractor'
import { collectImageTargets, startImageTranslation, type ImageRun } from '@/core/image'
import { statsOf } from '@/core/extractor/stats'
import { paperIdFromUrl, startTranslation, type Progress, type TranslationRun } from '@/core/pipeline'
import {
  applyStyle,
  clearPairMargins, createModeController, createPrep, installAnchorFallback,
  clearImageEverywhere, restore, setImageModes, startSentenceHighlight,
  type Mode, type ModeController, type SentenceHighlight,
} from '@/core/renderer'
import { escapeText, unescapeText } from '@/core/protector/text'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { beginSession, endSession, getSessionId, translateTitle, type TitleTranslator } from '@/core/scheduler'
import { isAxtMessage, type PageStatus, sendMessage } from '@/shared/messages'
import type { ImageProgress } from '@/shared/ocr'
import { createMessageTransport } from '@/shared/transport'
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
    // 引擎链、队列与请求都在 background（DESIGN §8.0）：content 的 fetch 带页面 origin、要走 CORS 预检，
    // 而且 https 页面够不着 http 端点（本地 Ollama），实测见 RESEARCH §6.7。这里只留一条消息代理
    const backend = createMessageTransport()
    let modes: ModeController | null = null
    /** 页内锚点兜底的卸载函数（issue #44）：会话开始时装、恢复原文时拆 */
    let uninstallAnchors: (() => void) | null = null
    /** 悬停对照高亮（§7.7）：跟着一次翻译会话起停，配置关掉时根本不装监听 */
    let highlight: SentenceHighlight | null = null
    let savedMode: Mode = 'stack'
    /** 译文外观（§7.5）：读者选中的那一份样式与高亮配置，写成 <html> 上的属性与变量 */
    let look: Look = lookOf(DEFAULT_CONFIG)
    /**
     * 外观有三个写入点：启动时的这次读、start() 里的那次读、以及下面的 watchConfig。
     * 前两个都是「发起时的快照」，watcher 拿到的才是最新值，所以 watcher 一旦写过，
     * 任何配置读都不许再把 style 盖回旧快照——否则设置页刚存的外观会被一次晚到的 await 结果吞掉，
     * 而 storage 事件已经消费过、不会再来一次（Codex 在 #106 两轮分别指出这两个读点）。
     * 两个读点共用这一个闸，不各自判断
     */
    let styleFromWatcher = false
    const adoptStyle = (next: Look) => {
      if (!styleFromWatcher) look = next
    }
    void getConfig().then(config => { savedMode = config.mode; adoptStyle(lookOf(config)) })
    // 设置页改完外观立刻生效（#47）：只重算注入表与 <html data-axt-style>，一个译文节点都不碰，
    // 也不重新请求翻译（§8.5 的 chainConfigChanged 本来就忽略 style）。
    // 用 watchConfig 而不是消息：设置页自己就是活动标签页，发不到内容页；订阅还能同时更新所有打开的论文
    watchConfig(config => {
      // 先立闸再比值：watcher 一响就说明它拿到的是最新的存储内容，哪怕这次不需要重画。
      // 否则「页面带着旧外观启动 + 用户点恢复默认」会走进等值快路径，闸没立起来，
      // 随后 getConfig() 那份旧快照又把非默认外观装回去（Codex 在 #106 指出）
      styleFromWatcher = true
      // The hover highlight is a front-page toggle (UI.md S-P-80), so it takes effect on this page
      // at once: installed or torn down mid-session, no translation node touched. Outside a session
      // there is nothing to pair, and start() reads the setting itself
      if (run) {
        if (config.reading.sentenceHighlight && !highlight) highlight = startSentenceHighlight(document) ?? null
        else if (!config.reading.sentenceHighlight && highlight) {
          highlight.stop()
          highlight = null
        }
      }
      // Image translation, both the switch (popup) and the per-mode list (settings): on starts the
      // image run for this session, off stops it and hides every overlay through the display gate,
      // and a change to the modes has to reach both the gate and the run that reads it — otherwise
      // unticking the current mode leaves the overlays up and keeps requesting (Codex on #157).
      // The text run is not touched either way
      const imageChanged = run && current
        && (config.image.enabled !== current.config.image.enabled
          || config.image.modes.join(' ') !== current.config.image.modes.join(' '))
      if (imageChanged && current) {
        current = { ...current, config }
        images?.stop()
        images = null
        imageProgress = null
        setImageModes(document, [])
        if (config.image.enabled) startImages(current.session, config, current.context, current.renderPath)
      }
      const next = lookOf(config)
      if (JSON.stringify(next) === JSON.stringify(look)) return
      look = next
      applyStyle(document, look)
    })
    // 一次会话 = 一个运行（观察器与请求）+ 一个 session id 作取消范围（DESIGN §10）
    let run: TranslationRun | null = null
    let title: TitleTranslator | null = null
    /** 图片翻译（§15）：helper 可用且设置里至少勾了一种模式时才有 */
    let images: ImageRun | null = null
    let imageProgress: ImageProgress | null = null
    /** What the session runs on (PageStatus.running); null outside a session */
    let running: NonNullable<PageStatus['running']> | null = null
    /** The session's start-time inputs, for the parts a settings change can restart on their own (images) */
    let current: { session: string; config: Config; context: Parameters<typeof startTranslation>[0]['context']; renderPath: RenderPath } | null = null
    /**
     * Whether this session has already been restarted by a permanent hand-over. **One per session,
     * and reset by every `start()`**: kept across sessions it would suppress the restart a later
     * service needs when that one hands over to the same engine (Codex on #157), and unbounded
     * within a session it could chase a chain down step by step
     */
    let restarted = false
    const idle = (): Progress => ({ state: 'idle', total: blocks.length, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 })
    let progress: Progress = idle()

    /** 结束当前会话：断开观察器、删 pending、撤掉排队与在飞的请求；页面上的译文留着 */
    function endRun(): void {
      highlight?.stop()
      highlight = null
      title?.stop()
      title = null
      run?.stop()
      run = null
      images?.stop()
      images = null
      imageProgress = null
      const session = endSession()
      // 撤请求是尽力而为：排队的批次不再发出、在飞的 fetch 被 abort，撤不掉的由下面的会话 id 比对挡住
      if (session) void backend.cancel(session)
    }

    /**
     * `from` is the session an **automatic** restart was decided in (a permanent hand-over). The
     * reads below are awaited, and the reader may press 显示原文 during them; without this check the
     * stale continuation would translate the page again, undoing an explicit restore and spending
     * more requests (Codex on #157). A restart the reader asked for passes no session and always runs
     */
    async function start(requested?: Mode, restart = false, from?: string): Promise<{ started: boolean; reason?: string }> {
      if (progress.state === 'on' && !restart) return { started: false, reason: '翻译已开启，滚动会继续翻' }
      if (from !== undefined && getSessionId() !== from) return { started: false, reason: '会话已结束' }
      if (!paper) return { started: false, reason: '不是 arXiv HTML 页面' }
      if (blocks.length === 0) return { started: false, reason: '页面里没有可翻译的块' }
      const tStart = performance.now()
      const config = await getConfig()
      // 术语表随每批发出（§8.2）。**空表不带这个字段**：带上会让所有既有缓存键变一遍，一次性全失效
      const context = config.glossary.length > 0 ? { ...paperContextValue, glossary: config.glossary } : paperContextValue
      // 引擎链在 background；这里只取规划批次与选择渲染路径要用的能力（§2 第 3 条）
      let status: Awaited<ReturnType<typeof backend.status>>
      try {
        status = await backend.status()
      } catch (e) {
        return { started: false, reason: `扩展后台未响应：${e instanceof Error ? e.message : String(e)}` }
      }
      // 首选不可用而链上还有兜底时照常开始：请求会直接落到免费引擎上（§8.5）
      if (!status.available && !status.fallback) return { started: false, reason: '未配置 API key，请先到设置页填写' }
      // The reader may have restored the page while the two reads above were in flight
      if (from !== undefined && getSessionId() !== from) return { started: false, reason: '会话已结束' }
      console.debug(`[axt] start: ready in ${Math.round(performance.now() - tStart)} ms, since page start ${Math.round(tStart)} ms`)

      modes?.stop()
      modes = createModeController(document, requested ?? config.mode, { onChange: enterSide })
      adoptStyle(lookOf(config))
      endRun() // 上一轮停下但没恢复原文的会话（致命错误后重试）
      // 页内锚点兜底（issue #44）：only 模式下目标块被隐藏，交叉引用点了不动窝
      uninstallAnchors?.()
      uninstallAnchors = installAnchorFallback(document)
      // 只在这条路径上装：没开翻译时没有译文，也就没有对照可言
      if (config.reading.sentenceHighlight) highlight = startSentenceHighlight(document) ?? null
      const session = beginSession()
      progress = { ...idle(), state: 'on' }
      restarted = false
      const startEngine = status.engine.id
      running = { provider: config.provider, target: config.targetLanguage, engine: startEngine, revision: status.revision }
      current = { session, config, context, renderPath: status.renderPath }
      prep.reset() // 新会话：镜像允许再跑一次、量宽缓存清空、栏宽重读
      enterSide(modes.effective())
      const t1 = performance.now()
      let wasBusy = false
      run = startTranslation({
        doc: document,
        blocks,
        target: config.targetLanguage,
        mode: modes.effective(),
        appearance: look,
        paper,
        // 标题 + 摘要每批都带（DESIGN §8.2）
        context,
        capabilities: { maxBatchChars: status.maxBatchChars, maxBatchItems: status.maxBatchItems, renderPath: status.renderPath },
        transport: request => backend.translate(request),
        scope: session,
        preload: config.preload,
        // 这一批刚动过 DOM 的块交给整理层：只碰它们所在的容器，不再每趟全篇重扫（issue #46）
        onRendered: blocks => {
          if (getSessionId() !== session) return
          prep.touch(blocks)
        },
        onProvider: id => {
          if (getSessionId() !== session) return
          if (running) running.engine = id
          if (id === startEngine || restarted) return
          // A permanent hand-over (missing or rejected key) would leave the paragraphs already on
          // screen from one service and the rest from another. Start over on the service that is
          // actually available, so the whole page reads from one hand (UI.md, decided 2026-09-10).
          // Temporary hand-overs (rate limits, timeouts) keep going: they come back on their own
          void backend.status(session).then(s => {
            if (getSessionId() !== session) return
            // Ask **this session's own chain** about **this session's own engine**: the page keeps
            // the chain it started on while another tab changes the settings, and the most recent
            // hand-over may belong to some intermediate free engine that failed transiently
            // (Codex on #157)
            const kind = s.demotions.find(d => d.id === startEngine)?.kind
            if (kind !== 'no-key' && kind !== 'auth') return
            restarted = true
            console.debug(`[axt] hand-over to ${id} is permanent (${kind}); restarting the page on it`)
            void start(undefined, true, session)
          }).catch(() => undefined)
        },
        onProgress: p => {
          // 会话已结束（恢复原文 / 重开）：旧运行的回调一律忽略
          if (getSessionId() !== session) return
          progress = p
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
          const res = await backend.translate({
            request: { segments: [{ id: 'document.title', text: escapeText(text, wireFormatOf(status.renderPath)) }], source: 'en', target: config.targetLanguage, context },
            cache: { paper, renderPath: status.renderPath },
            scope: session,
          })
          return res.ok ? unescapeText(res.result.segments[0]?.text ?? '', wireFormatOf(status.renderPath)) || null : null
        },
      })
      startImages(session, config, context, status.renderPath)
      return { started: true }
    }

    /**
     * 图片翻译（§15）：先问 background 本机 helper 在不在，不在就整条路径不跑，页面翻译不受影响。
     * 位图与文字块一样按视口懒加载；当前模式不在用户勾选的集合里时进入视口的图先停着，切回来再翻
     */
    function startImages(session: string, config: Config, context: Parameters<typeof startTranslation>[0]['context'], renderPath: RenderPath): void {
      // 上一轮（致命错误后没恢复原文就重开）留下的叠加层与模式闸先摘掉：helper 没了、图片翻译关了、
      // 目标语言换了，旧的都不该再显示；新一轮处理到那张图时会替换它（Codex 在 #89 指出）
      setImageModes(document, [])
      if (!config.image.enabled || config.image.modes.length === 0) return
      if (!paper) return
      const targets = collectImageTargets(document)
      if (targets.length === 0) return
      setImageModes(document, config.image.modes)

      /**
       * helper 只决定**位图**（§15.5）。所以这一轮**立刻开跑**，不等它的探测：
       * SVG 图的文字是从 contentDocument 里读出来的，等一个与它无关的握手没有道理，
       * 而那个握手在 helper 装了却挂住时要 30 秒才超时，探测本身失败还会把整段跳过
       *（Codex 在 #134 指出）。位图目标先停在 parked 里，探测回来再放。
       */
      let helperReady = false
      const t1 = performance.now()
      let wasBusy = false
      images = startImageTranslation({
        renderPath,
        doc: document,
        targets,
        paper,
        target: config.targetLanguage,
        scope: session,
        preload: config.preload,
        context,
        ocr: call => sendMessage({ type: 'axt:ocr', ...call }),
        translate: request => backend.translate(request),
        // 模式闸对两种图一样；位图额外要等 helper（§15.5）
      isEnabled: t => config.image.enabled && config.image.modes.includes(modes?.effective() ?? config.mode) && (t.kind === 'svg' || helperReady),
        isCurrent: () => getSessionId() === session,
        onProgress: p => {
          if (getSessionId() !== session) return
          imageProgress = p
          const busy = p.requested - p.done - p.failed > 0
          if (wasBusy && !busy) console.debug(`[axt] images idle: ${p.done}/${p.requested} of ${p.total}, ${p.failed} failed, ${Math.round(performance.now() - t1)} ms`)
          wasBusy = busy
        },
        // 叠加层插好了：side 模式下所在插图要拆两份（§7.2），交给整理层
        onRendered: rendered => {
          if (getSessionId() !== session) return
          prep.touch(rendered)
        },
      })
            console.debug(`[axt] images: ${targets.filter(t => t.kind === 'svg').length} SVG + ${targets.filter(t => t.kind === 'raster').length} bitmaps, modes ${config.image.modes.join('/')}`)

      /**
       * 位图要等 helper。**探测失败或没装也要收尾**：上一轮成功画过的位图叠加层还挂在页面上，
       * 而这一轮它们的目标停在 parked 里、永远不会走到 `clearImage`——旧译文（甚至旧的目标语言）
       * 就那么留着（Codex 在 #134 指出）
       */
      const settleRaster = (available: boolean) => {
        if (getSessionId() !== session) return
        helperReady = available
        if (available) images?.resume()
        else for (const t of targets) if (t.kind === 'raster') clearImageEverywhere(t)
      }
      sendMessage({ type: 'axt:helper-status' })
        .then(helper => settleRaster(helper.available))
        .catch(e => { console.debug('[axt] helper-status 失败', e); settleRaster(false) })
    }

    let fitObserver: ResizeObserver | null = null

    /**
     * 译文到达后的整理（DESIGN §7.2 / §10，issue #46）：脚注归位、拆图、镜像、缩表、对齐边距。
     * 由 pipeline 每批交出的脏块驱动，每趟只碰它们所在的容器；镜像整个会话只跑一次；
     * 栏宽在每趟开头、写任何东西之前读。全部在 renderer/prep.ts，这里只接线
     */
    const prep = createPrep(document, {
      isSide: () => modes?.effective() === 'side',
      trace: line => console.debug(`[axt] ${line}`),
    })

    /** 进入 side 时的准备：右栏补一份公式与图表（§7.2），并把表格缩到能装进一栏 */
    function enterSide(effective: Mode): void {
      // 模式闸可能刚打开：停着的图放出去（§15）
      images?.resume()
      if (effective !== 'side') {
        fitObserver?.disconnect()
        fitObserver = null
        prep.cancel()
        // 对齐用的内联边距只服务于左右分栏，其他模式下要还给站点样式
        clearPairMargins(document)
        return
      }
      // 进 side：栏宽重读、全量整理一趟（stack / only 回来时对齐边距已被清掉，得从头算）
      prep.refreshColumn()
      prep.touchAll()
      // 栏宽随窗口变化，缩放比例要跟着重算。只在宽度真的变了才重算——
      // 缩放表格本身也会让观察目标报告一次尺寸变化，不设这道闸就会自激振荡
      if (!fitObserver && typeof ResizeObserver === 'function') {
        let lastWidth = 0
        fitObserver = new ResizeObserver(entries => {
          const width = Math.round(entries[0]?.contentRect.width ?? 0)
          if (width === lastWidth) return
          lastWidth = width
          prep.refreshColumn()
          prep.touchAll()
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
      prep.reset()
      uninstallAnchors?.()
      uninstallAnchors = null
      const result = restore(document)
      progress = idle()
      running = null
      current = null
      restarted = false
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
          start(message.mode, message.restart === true).then(sendResponse)
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
          const failedImages = images?.failed() ?? []
          void images?.translate(failedImages)
          sendResponse({ retried: failed.length + failedImages.length })
          return true
        }
        case 'axt:page-status':
          sendResponse({ paper, mode: modes?.effective() ?? savedMode, preference: modes?.preference() ?? savedMode, progress, session: getSessionId(), ...(imageProgress ? { images: imageProgress } : {}), ...(running ? { running } : {}) })
          return true
      }
    })

    if (location.hash === '#axt-debug') enableDebug(blocks)
    if (location.hash === '#axt-translate') void start()
  },
})
