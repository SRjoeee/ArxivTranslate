// The page's translation session (ADR-0004): everything the content entry used to hold, behind one
// object whose dependencies are injected so the whole lifecycle runs under vitest against a
// happy-dom document and fake backends. The content entry only maps browser messages onto it.
//
// One session = one run (observer and requests) + one id as the cancellation scope (DESIGN §10).
// The id belongs to this object: `start()` mints one and every callback of that run closes over
// `alive()`; after `restore()` or a restart, results that arrive late are dropped there.
import { type RenderPath, wireFormatOf } from '@/cache/key'
import { type Look, lookOf } from '@/config/appearance'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import type { Block } from '@/core/extractor'
import type { PaperContext } from '@/core/extractor/context'
import { collectImageTargets, startImageTranslation, type ImageBytes, type ImageRun, type ImageTarget } from '@/core/image'
import { startTranslation, type Progress, type TranslationRun } from '@/core/pipeline'
import { escapeText, unescapeText } from '@/core/protector/text'
import {
  applyStyle, clearImageEverywhere, clearMarginNotes, clearPairMargins, createModeController, createPrep,
  installAnchorFallback, type Mode, type ModeController, relabelFailed, restore, type SentenceHighlight, setImageModes,
  startSentenceHighlight,
} from '@/core/renderer'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { newSessionId } from '@/core/scheduler/session'
import { translateTitle, type TitleTranslator } from '@/core/scheduler/title'
import type { TranslationTransport } from '@/providers/transport'
import { isPermanentErrorKind, type TranslateContext } from '@/providers/types'
import type { PageStatus } from '@/shared/messages'
import type { HelperStatus, ImageProgress, OcrCall, OcrMessageResponse } from '@/shared/ocr'
import { S } from '@/ui/strings'
import { createIdleTrace } from './idle-trace'
import { chainRevision } from '@/config/revision'

export interface SessionDeps {
  doc: Document
  blocks: Block[]
  /** The arXiv id; null when this is not a paper page */
  paper: string | null
  /** Title and abstract, extracted once before any translation is on the page */
  context: PaperContext
  /** The background's translation chain, behind the message transport */
  backend: TranslationTransport
  /** OCR of one bitmap (`axt:ocr`) */
  ocr: (call: OcrCall) => Promise<OcrMessageResponse>
  /** Is the recognition helper reachable (`axt:helper-status`) */
  helperStatus: () => Promise<HelperStatus>
  /** Bytes of one bitmap; the image pipeline's own `fetch` through the HTTP cache when absent (tests inject) */
  fetchImage?: (url: string) => Promise<ImageBytes>
  config: { get(): Promise<Config>; set(config: Config): Promise<void> }
  /** Switch the words this script puts on the page to the interface's language (UI.md §6) */
  applyLocale: (uiLanguage: string) => void
  /** Debug lines; the e2e suites read some of them (`session idle`, `translation stopped`) */
  trace?: (line: string) => void
}

export interface StartResult {
  started: boolean
  reason?: string
}

export interface PageSession {
  /** The first configuration read has finished (whether or not it succeeded); `status()` waits for it */
  ready: Promise<void>
  /**
   * `restart` replaces a running session in place. `from` is the session an **automatic** restart was
   * decided in: the reads inside are awaited, and the reader may restore the page during them —
   * a stale continuation must not translate the page again (Codex on #157)
   */
  start(requested?: Mode, restart?: boolean, from?: string): Promise<StartResult>
  /** Back to the original page: stop everything, remove every injected node and attribute */
  /** `from`: the session the restore was decided on; once it has ended the restore is not the reader's and does nothing */
  restore(from?: string): { removedNodes: number }
  /** Switch side / stack / only without a new session; the preference is persisted */
  setMode(mode: Mode): Promise<{ mode: Mode; effective: Mode }>
  /** Hand blocks to the running text pipeline (retry, tests); nothing outside a session */
  translate(blocks: Block[]): Promise<void>
  /** Hand images to the running image pipeline — all of this session's targets by default (retry, tests) */
  translateImages(targets?: ImageTarget[]): Promise<void>
  /** Retry every failed block and image; returns how many were handed back */
  retryFailed(): number
  /** The helper became available after this session started: release the parked bitmaps */
  resumeRaster(): boolean
  /** A configuration change while the page is open (the `watchConfig` subscriber) */
  onConfig(config: Config): void
  status(): Promise<PageStatus>
}

export function createPageSession(deps: SessionDeps): PageSession {
  const { doc, blocks, paper, backend } = deps
  const trace = deps.trace ?? (() => undefined)
  const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

  // 模式：偏好存配置，实际生效的由 ModeController 按视口决定（§7.2）。
  // 翻译开始前不建控制器，免得往没翻译过的页面写 data-axt-mode；popup 这时看到的是配置里的偏好。
  let modes: ModeController | null = null
  /** 页内锚点兜底的卸载函数（issue #44）：会话开始时装、恢复原文时拆 */
  let uninstallAnchors: (() => void) | null = null
  /** 悬停对照高亮（§7.7）：跟着一次翻译会话起停，配置关掉时根本不装监听 */
  let highlight: SentenceHighlight | null = null
  /**
   * 读者存的模式。**问状态要等它读回来**：popup 一拿到非空的状态就不再重试，所以在这之前
   * 任何猜测都可能把模式条钉在错的那一档上——升级上来的读者存着「上下」，而默认值是「左右」
   *（Codex 在 #161 两轮分别指出这个默认值与「先猜」本身）。默认值只是读失败时的兜底
   */
  let savedMode: Mode = DEFAULT_CONFIG.mode
  let configRead: () => void = () => undefined
  const ready = new Promise<void>(resolve => { configRead = resolve })
  /** 由 startImages 装上：识别助手后来装好时，把这一页停着的位图放出来 */
  let resumeRaster: () => boolean = () => false
  /** 译文外观（§7.5）：读者选中的那一份样式与高亮配置，写成 <html> 上的属性与变量 */
  let look: Look = lookOf(DEFAULT_CONFIG)
  /**
   * 外观有三个写入点：启动时的这次读、start() 里的那次读、以及 onConfig。
   * 前两个都是「发起时的快照」，watcher 拿到的才是最新值，所以 watcher 一旦写过，
   * 任何配置读都不许再把 style 盖回旧快照——否则设置页刚存的外观会被一次晚到的 await 结果吞掉，
   * 而 storage 事件已经消费过、不会再来一次（Codex 在 #106 两轮分别指出这两个读点）。
   * 两个读点共用这一个闸，不各自判断
   */
  let styleFromWatcher = false
  const adoptStyle = (next: Look) => {
    if (!styleFromWatcher) look = next
  }
  /**
   * The same gate for the interface's language: this read is a snapshot from when it was issued,
   * and a language chosen while it was in flight would be undone by its continuation — the paper
   * would keep the previous language until some other configuration event came along
   * (Codex on #161, the same shape as the appearance read above)
   */
  const adoptLocale = (uiLanguage: string) => {
    if (!styleFromWatcher) deps.applyLocale(uiLanguage)
  }
  void deps.config.get()
    .then(config => { savedMode = config.mode; adoptLocale(config.uiLanguage); adoptStyle(lookOf(config)) })
    // 读失败也要放行：popup 等不到回答会一直显示「正在读取」，而默认值至少是个能用的答案
    .catch(e => trace(`读配置失败，先按默认值答：${e instanceof Error ? e.message : String(e)}`))
    .finally(() => configRead())

  let run: TranslationRun | null = null
  let title: TitleTranslator | null = null
  /** 图片翻译（§15）：helper 可用且设置里至少勾了一种模式时才有 */
  let images: ImageRun | null = null
  /** The image targets of the running session; `translateImages()` hands them all over by default */
  let imageTargets: ImageTarget[] = []
  let imageProgress: ImageProgress | null = null
  /** What the session runs on (PageStatus.running); null outside a session */
  let running: NonNullable<PageStatus['running']> | null = null
  /** The session's start-time inputs, for the parts a settings change can restart on their own (images) */
  let current: { session: string; config: Config; context: TranslateContext; renderPath: RenderPath } | null = null
  /**
   * Whether this session has already been restarted by a permanent hand-over. **One per session,
   * and reset by every `start()`**: kept across sessions it would suppress the restart a later
   * service needs when that one hands over to the same engine (Codex on #157), and unbounded
   * within a session it could chase a chain down step by step
   */
  let restarted = false
  /** The current session's id; null outside a session. Every callback of a run closes over its own copy */
  let active: string | null = null
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
    imageTargets = []
    imageProgress = null
    const session = active
    active = null
    // 撤请求是尽力而为：排队的批次不再发出、在飞的 fetch 被 abort，撤不掉的由各回调的 alive() 挡住
    if (session) void backend.cancel(session)
  }

  async function start(requested?: Mode, restart = false, from?: string): Promise<StartResult> {
    if (progress.state === 'on' && !restart) return { started: false, reason: S.page.alreadyOn }
    if (from !== undefined && active !== from) return { started: false, reason: S.page.sessionOver }
    if (!paper) return { started: false, reason: S.page.notPaper }
    if (blocks.length === 0) return { started: false, reason: S.page.nothingToTranslate }
    const tStart = now()
    const config = await deps.config.get()
    // The identity of the settings this session runs on — its own configuration's, not the chain's: a change saved
    // between this read and the status answer rebuilds the chain from the new settings while this session keeps the
    // old target (the local review of INVENTORY S2). Computed here, with the reads: after the state below is
    // committed nothing may await — a restore landing in such a gap would be undone by the continuation
    const revision = await chainRevision(config)
    // 术语表随每批发出（§8.2）。**空表不带这个字段**：带上会让所有既有缓存键变一遍，一次性全失效
    const context: TranslateContext = config.glossary.length > 0 ? { ...deps.context, glossary: config.glossary } : deps.context
    // 引擎链在 background；这里只取规划批次与选择渲染路径要用的能力（§2 第 3 条）
    let status: Awaited<ReturnType<typeof backend.status>>
    try {
      status = await backend.status()
    } catch (e) {
      return { started: false, reason: `${S.page.backendSilent}：${e instanceof Error ? e.message : String(e)}` }
    }
    // 首选不可用而链上还有兜底时照常开始：请求会直接落到免费引擎上（§8.5）
    if (!status.available && !status.fallback) return { started: false, reason: S.page.noService }
    // The reader may have restored the page while the two reads above were in flight
    if (from !== undefined && active !== from) return { started: false, reason: S.page.sessionOver }
    trace(`start: ready in ${Math.round(now() - tStart)} ms, since page start ${Math.round(tStart)} ms`)

    modes?.stop()
    modes = createModeController(doc, requested ?? config.mode, { onChange: enterSide })
    adoptStyle(lookOf(config))
    endRun() // 上一轮停下但没恢复原文的会话（致命错误后重试）
    // 页内锚点兜底（issue #44）：only 模式下目标块被隐藏，交叉引用点了不动窝
    uninstallAnchors?.()
    uninstallAnchors = installAnchorFallback(doc)
    // 只在这条路径上装：没开翻译时没有译文，也就没有对照可言
    if (config.reading.sentenceHighlight) highlight = startSentenceHighlight(doc) ?? null
    const session = newSessionId()
    active = session
    const alive = () => active === session
    progress = { ...idle(), state: 'on' }
    restarted = false
    const startEngine = status.engine.id
    running = { provider: config.provider, target: config.targetLanguage, engine: startEngine, revision }
    current = { session, config, context, renderPath: status.renderPath }
    prep.reset() // 新会话：镜像允许再跑一次、量宽缓存清空、栏宽重读
    enterSide(modes.effective())
    // Each busy → idle transition is one line the e2e suites read (idle-trace.ts)
    const traceIdle = createIdleTrace<Progress>({ now, trace }, p => p.inFlight > 0, (p, ms) =>
      `session idle: ${p.done}/${p.requested} requested of ${p.total}, ${p.failed} failed, ${p.cached} cached, ${ms} ms${p.fatal ? `, fatal: ${p.fatal}` : ''}`)
    run = startTranslation({
      doc,
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
      onRendered: rendered => {
        if (!alive()) return
        prep.touch(rendered)
      },
      onProvider: id => {
        if (!alive()) return
        if (running) running.engine = id
        if (id === startEngine || restarted) return
        // A permanent hand-over (missing or rejected key) would leave the paragraphs already on
        // screen from one service and the rest from another. Start over on the service that is
        // actually available, so the whole page reads from one hand (UI.md, decided 2026-09-10).
        // Temporary hand-overs (rate limits, timeouts) keep going: they come back on their own
        void backend.status(session).then(s => {
          if (!alive()) return
          // Ask **this session's own chain** about **this session's own engine**: the page keeps
          // the chain it started on while another tab changes the settings, and the most recent
          // hand-over may belong to some intermediate free engine that failed transiently
          // (Codex on #157)
          const kind = s.demotions.find(d => d.id === startEngine)?.kind
          if (kind === undefined || !isPermanentErrorKind(kind)) return
          restarted = true
          trace(`hand-over to ${id} is permanent (${kind}); restarting the page on it`)
          void start(undefined, true, session)
        }).catch(() => undefined)
      },
      onProgress: p => {
        // The session has ended (restore / restart): an old run's callbacks are ignored
        if (!alive()) return
        progress = p
        traceIdle(p)
      },
    })
    run.ready.catch(e => console.error('[axt] translation crashed', e))
    // 标签页标题也翻（§10）：走同一个服务、同一份缓存；标题是纯文本，按占位符协议转义再解码
    title = translateTitle(doc, {
      isCurrent: alive,
      translate: async text => {
        const res = await backend.translate({
          request: { segments: [{ id: 'document.title', text: escapeText(text, wireFormatOf(status.renderPath)) }], source: 'en', target: config.targetLanguage, context },
          cache: { paper, renderPath: status.renderPath },
          scope: session,
        })
        return res.ok ? unescapeText(res.result.segments[0]?.text ?? '', wireFormatOf(status.renderPath)) || null : null
      },
    })
    startImages(session, alive, config, context, status.renderPath)
    return { started: true }
  }

  /**
   * 图片翻译（§15）：先问 background 本机 helper 在不在，不在就整条路径不跑，页面翻译不受影响。
   * 位图与文字块一样按视口懒加载；当前模式不在用户勾选的集合里时进入视口的图先停着，切回来再翻
   */
  function startImages(session: string, alive: () => boolean, config: Config, context: TranslateContext, renderPath: RenderPath): void {
    // 上一轮（致命错误后没恢复原文就重开）留下的叠加层与模式闸先摘掉：helper 没了、图片翻译关了、
    // 目标语言换了，旧的都不该再显示；新一轮处理到那张图时会替换它（Codex 在 #89 指出）
    setImageModes(doc, [])
    if (!config.image.enabled || config.image.modes.length === 0) return
    if (!paper) return
    const targets = collectImageTargets(doc)
    if (targets.length === 0) return
    imageTargets = targets
    setImageModes(doc, config.image.modes)

    /**
     * helper 只决定**位图**（§15.5）。所以这一轮**立刻开跑**，不等它的探测：
     * SVG 图的文字是从 contentDocument 里读出来的，等一个与它无关的握手没有道理，
     * 而那个握手在 helper 装了却挂住时要 30 秒才超时，探测本身失败还会把整段跳过
     *（Codex 在 #134 指出）。位图目标先停在 parked 里，探测回来再放。
     */
    let helperReady = false
    const traceIdle = createIdleTrace<ImageProgress>({ now, trace }, p => p.requested - p.done - p.failed > 0, (p, ms) => `images idle: ${p.done}/${p.requested} of ${p.total}, ${p.failed} failed, ${ms} ms`)
    images = startImageTranslation({
      renderPath,
      doc,
      targets,
      paper,
      target: config.targetLanguage,
      scope: session,
      preload: config.preload,
      context,
      ocr: call => deps.ocr(call),
      translate: request => backend.translate(request),
      ...(deps.fetchImage ? { fetchBytes: deps.fetchImage } : {}),
      // 模式闸对两种图一样；位图额外要等 helper（§15.5）
      isEnabled: t => config.image.enabled && config.image.modes.includes(modes?.effective() ?? config.mode) && (t.kind !== 'raster' || helperReady),
      isCurrent: alive,
      onProgress: p => {
        if (!alive()) return
        imageProgress = p
        traceIdle(p)
      },
      // 叠加层插好了：side 模式下所在插图要拆两份（§7.2），交给整理层
      onRendered: rendered => {
        if (!alive()) return
        prep.touch(rendered)
      },
    })
    trace(`images: ${targets.filter(t => t.kind === 'svg').length} SVG + ${targets.filter(t => t.kind === 'picture').length} inline pictures + ${targets.filter(t => t.kind === 'raster').length} bitmaps, modes ${config.image.modes.join('/')}`)

    /**
     * 位图要等 helper。**探测失败或没装也要收尾**：上一轮成功画过的位图叠加层还挂在页面上，
     * 而这一轮它们的目标停在 parked 里、永远不会走到 `clearImage`——旧译文（甚至旧的目标语言）
     * 就那么留着（Codex 在 #134 指出）
     */
    const settleRaster = (available: boolean) => {
      if (!alive()) return
      helperReady = available
      if (available) images?.resume()
      else for (const t of targets) if (t.kind === 'raster') clearImageEverywhere(t)
    }
    // 装好识别助手之后要能把这一页放出来（Codex 在 #161 指出）：会话开始时探测扑空的话，
    // 位图一直停在 parked 里，而这一页自己没有任何再问一次的由头
    resumeRaster = () => {
      if (helperReady || !alive()) return false
      settleRaster(true)
      return true
    }
    deps.helperStatus()
      .then(helper => settleRaster(helper.state === 'ready'))
      .catch(e => { trace(`helper-status 失败：${e instanceof Error ? e.message : String(e)}`); settleRaster(false) })
  }

  let fitObserver: ResizeObserver | null = null

  /**
   * 译文到达后的整理（DESIGN §7.2 / §10，issue #46）：脚注归位、拆图、镜像、缩表、对齐边距。
   * 由 pipeline 每批交出的脏块驱动，每趟只碰它们所在的容器；镜像整个会话只跑一次；
   * 栏宽在每趟开头、写任何东西之前读。全部在 renderer/prep.ts，这里只接线
   */
  const prep = createPrep(doc, {
    isSide: () => modes?.effective() === 'side',
    trace,
  })

  /** 进入 side 时的准备：右栏补一份公式与图表（§7.2），并把表格缩到能装进一栏 */
  function enterSide(effective: Mode): void {
    // 模式闸可能刚打开：停着的图放出去（§15）
    images?.resume()
    if (effective !== 'side') {
      fitObserver?.disconnect()
      fitObserver = null
      prep.cancel()
      // 对齐用的内联边距只服务于左右分栏，其他模式下要还给站点样式；
      // 边注的下排同理——别的模式下浮动按自己的高度互相避让，用不着我们推
      clearPairMargins(doc)
      clearMarginNotes(doc)
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
      const target = doc.querySelector(DOCUMENT_ROOT)
      if (target) fitObserver.observe(target)
    }
  }

  async function setMode(mode: Mode): Promise<{ mode: Mode; effective: Mode }> {
    // 没在翻译时也允许切换：控制器会把属性写到 <html> 上，样式立刻生效
    if (!modes) modes = createModeController(doc, mode, { onChange: enterSide })
    const effective = modes.choose(mode)
    enterSide(effective)
    savedMode = mode
    const config = await deps.config.get()
    if (config.mode !== mode) await deps.config.set({ ...config, mode })
    return { mode, effective }
  }

  function restorePage(from?: string): { removedNodes: number } {
    if (from !== undefined && active !== from) return { removedNodes: 0 }
    endRun()
    modes?.stop()
    modes = null
    fitObserver?.disconnect()
    fitObserver = null
    prep.reset()
    uninstallAnchors?.()
    uninstallAnchors = null
    const result = restore(doc)
    progress = idle()
    running = null
    current = null
    restarted = false
    trace(`translation stopped: ${result.removedNodes} nodes removed`)
    return { removedNodes: result.removedNodes }
  }

  // 设置页改完外观立刻生效（#47）：只重算注入表与 <html> 上的属性，一个译文节点都不碰，
  // 也不重新请求翻译（§8.5 的 chainConfigChanged 本来就忽略 style）。
  // 订阅而不是消息：设置页自己就是活动标签页，发不到内容页；订阅还能同时更新所有打开的论文
  function onConfig(config: Config): void {
    // 先立闸再比值：watcher 一响就说明它拿到的是最新的存储内容，哪怕这次不需要重画。
    // 否则「页面带着旧外观启动 + 用户点恢复默认」会走进等值快路径，闸没立起来，
    // 随后 getConfig() 那份旧快照又把非默认外观装回去（Codex 在 #106 指出）
    styleFromWatcher = true
    // The hover highlight is a front-page toggle (UI.md S-P-80), so it takes effect on this page
    // at once: installed or torn down mid-session, no translation node touched. Outside a session
    // there is nothing to pair, and start() reads the setting itself
    if (run) {
      if (config.reading.sentenceHighlight && !highlight) highlight = startSentenceHighlight(doc) ?? null
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
      imageTargets = []
      imageProgress = null
      setImageModes(doc, [])
      const session = current.session
      if (config.image.enabled) startImages(session, () => active === session, config, current.context, current.renderPath)
    }
    // 语言变了：已经画出来的失败控件把词抄进了自己的 shadow root，要重新写一遍（Codex 在 #161 指出）
    deps.applyLocale(config.uiLanguage)
    relabelFailed(doc)
    const next = lookOf(config)
    if (JSON.stringify(next) === JSON.stringify(look)) return
    look = next
    applyStyle(doc, look)
  }

  return {
    ready,
    start,
    restore: restorePage,
    setMode,
    translate: picked => run?.translate(picked) ?? Promise.resolve(),
    translateImages: picked => images?.translate(picked ?? imageTargets) ?? Promise.resolve(),
    retryFailed() {
      const failed = run?.failed() ?? []
      void run?.translate(failed)
      const failedImages = images?.failed() ?? []
      void images?.translate(failedImages)
      return failed.length + failedImages.length
    },
    resumeRaster: () => resumeRaster(),
    onConfig,
    // 等首次读配置：答一次就定了这一轮 popup 的模式条（见 savedMode 的注释）
    status: () => ready.then(() => ({
      paper,
      mode: modes?.effective() ?? savedMode,
      preference: modes?.preference() ?? savedMode,
      progress,
      session: active,
      ...(imageProgress ? { images: imageProgress } : {}),
      ...(running ? { running } : {}),
    })),
  }
}
