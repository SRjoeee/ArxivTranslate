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
  /** `from`: the session a restart was decided on; `epoch`: the page's action epoch a command was decided on — either, stale, refuses the start */
  start(requested?: Mode, restart?: boolean, from?: string, epoch?: string): Promise<StartResult>
  /** Back to the original page: stop everything, remove every injected node and attribute */
  /** `from`: the session the restore was decided on; once it has ended the restore is not the reader's and does nothing */
  /** `epoch`: the page's action epoch the restore was decided on; an earlier one, or another document's, is refused */
  restore(epoch?: string): { removedNodes: number; refused?: true }
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

  // The mode: the preference lives in the configuration, and the one in effect is the ModeController's call by
  // viewport (§7.2). No controller before a translation starts, so no data-axt-mode is written onto an untranslated
  // page; until then the popup sees the configured preference.
  let modes: ModeController | null = null
  /** The teardown of the in-page anchor fallback (issue #44): attached when a session starts, removed on restore */
  let uninstallAnchors: (() => void) | null = null
  /** The hover highlight (§7.7): starts and stops with a translation session; with the setting off no listener is attached at all */
  let highlight: SentenceHighlight | null = null
  /**
   * The mode the reader saved. **A status request waits for it to come back**: the popup stops retrying the moment
   * it gets a non-empty status, so any guess before then may pin the mode bar on the wrong stop — a reader who
   * upgraded has “stack” stored while the default is “side” (Codex on #161, in two rounds: the default, then the
   * guessing itself). The default is only the fallback for a failed read
   */
  let savedMode: Mode = DEFAULT_CONFIG.mode
  let configRead: () => void = () => undefined
  const ready = new Promise<void>(resolve => { configRead = resolve })
  /** Set by startImages: once the recognition helper is installed later, the parked bitmaps of this page are released */
  let resumeRaster: () => boolean = () => false
  /** The translation's appearance (§7.5): the style and highlight profiles the reader chose, written as attributes and variables on <html> */
  let look: Look = lookOf(DEFAULT_CONFIG)
  /**
   * The appearance has three writers: the read at start-up, the read in start(), and onConfig. The first two are
   * “snapshots at the time of the request”, and only the watcher holds the newest value, so once the watcher has
   * written, no configuration read may put the style back to an older snapshot — the appearance the settings page
   * just saved would otherwise be swallowed by one late await result, and the storage event has been consumed and
   * does not come again (Codex on #106, in two rounds, one per reader). The two readers share this one gate rather
   * than judging on their own
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
    // A failed read lets it through too: the popup would show “reading” for ever without an answer, and the defaults are at least a usable one
    .catch(e => trace(`configuration read failed, answering with the defaults for now: ${e instanceof Error ? e.message : String(e)}`))
    .finally(() => configRead())

  let run: TranslationRun | null = null
  let title: TitleTranslator | null = null
  /** Image translation (§15): only with the helper available and at least one mode ticked in the settings */
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
  /**
   * The page's action epoch (PageStatus.epoch): every start that commits and every restore moves the counter, and
   * the document's own id keeps a command decided on another document — the same tab before a reload — from
   * matching by count alone (the local review of INVENTORY S2, thirteenth pass)
   */
  const documentId = newSessionId()
  let actions = 0
  const epochNow = () => `${documentId}#${actions}`
  const idle = (): Progress => ({ state: 'idle', total: blocks.length, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 })
  let progress: Progress = idle()

  /** End the current session: disconnect the observers, remove the pending nodes, withdraw the queued and in-flight requests; the translations on the page stay */
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
    // Withdrawing requests is best effort: queued batches are not sent, an in-flight fetch is aborted, and what cannot be withdrawn is stopped by each callback's alive()
    if (session) void backend.cancel(session)
  }

  /**
   * Overlapping starts are one start. A second click or key press while the first is still asking its status must
   * not mint a second session: both would be bound provisionally, the first's first request would drop the second
   * as the tab's stale scope, and the second would then take the page over with a dead scope — every request of
   * it aborted (the local review of INVENTORY S2, tenth pass). The later caller gets the earlier start's outcome
   */
  let starting: { key: string; promise: Promise<StartResult> } | null = null
  function start(requested?: Mode, restart = false, from?: string, epoch?: string): Promise<StartResult> {
    // The same request twice is one start; a different one — another epoch, a restart over a plain start — waits for
    // the one in flight and is then judged on its own terms against the page as it is by then: a restart made
    // obsolete by a restore must not swallow the translate the reader asked for after it (thirteenth pass)
    const key = `${requested ?? ''}|${restart}|${from ?? ''}|${epoch ?? ''}`
    if (starting?.key === key) return starting.promise
    const run = () => begin(requested, restart, from, epoch)
    const promise: Promise<StartResult> = (starting ? starting.promise.then(run, run) : run()).finally(() => { if (starting?.promise === promise) starting = null })
    starting = { key, promise }
    return promise
  }

  /**
   * `from`: the session a restart was decided on (the automatic restart after a permanent hand-over names its own).
   * `epoch`: the page's action epoch a command from the popup or the toggle was decided on. Either, when given and
   * stale, refuses the start: the page moved on since the decision
   */
  async function begin(requested?: Mode, restart = false, from?: string, epoch?: string): Promise<StartResult> {
    if (progress.state === 'on' && !restart) return { started: false, reason: S.page.alreadyOn }
    if (from !== undefined && active !== from) return { started: false, reason: S.page.sessionOver }
    if (epoch !== undefined && epoch !== epochNow()) return { started: false, reason: S.page.sessionOver }
    if (!paper) return { started: false, reason: S.page.notPaper }
    if (blocks.length === 0) return { started: false, reason: S.page.nothingToTranslate }
    const tStart = now()
    const config = await deps.config.get()
    // The glossary goes out with every batch (§8.2). **An empty glossary omits the field**: with it every existing cache key would change at once, invalidating everything
    const context: TranslateContext = config.glossary.length > 0 ? { ...deps.context, glossary: config.glossary } : deps.context
    // The engine chain lives in the background; only the capabilities batch planning and render-path choice need are taken here (§2 item 3)
    // The session id is minted before the status is asked: the status request carries it, and the background binds
    // the session to the chain it answers about — a chain built from the configuration as stored now (`fresh`). The
    // target and the revision the session runs on come from that chain, not from the configuration read above: a
    // save between the two would otherwise leave the session pinned to a chain other than the settings it records
    // (the local review of INVENTORY S2, seventh pass). Nothing awaits after the state below is committed
    const session = newSessionId()
    let status: Awaited<ReturnType<typeof backend.status>>
    try {
      status = await backend.status(session, { fresh: true })
    } catch (e) {
      return { started: false, reason: `${S.page.backendSilent}：${e instanceof Error ? e.message : String(e)}` }
    }
    // The status request bound this session to a chain provisionally (provider-status.ts). A start refused from here
    // on never makes the request that would settle that binding, and the abandoned scope would keep its chain and
    // engines alive until the tab's next session took over (Codex on #184): a refusal releases it
    const release = (reason: string): StartResult => {
      void backend.cancel(session)
      return { started: false, reason }
    }
    // The first choice unavailable while the chain still has a fallback: start as usual, the requests land straight on the free engine (§8.5)
    if (!status.available && !status.fallback) return release(S.page.noService)
    // The reader may have restored the page while the two reads above were in flight
    if (from !== undefined && active !== from) return release(S.page.sessionOver)
    if (epoch !== undefined && epoch !== epochNow()) return release(S.page.sessionOver)
    trace(`start: ready in ${Math.round(now() - tStart)} ms, since page start ${Math.round(tStart)} ms`)

    modes?.stop()
    modes = createModeController(doc, requested ?? config.mode, { onChange: enterSide })
    adoptStyle(lookOf(config))
    endRun() // the previous session, stopped but not restored (a retry after a fatal error)
    // The in-page anchor fallback (issue #44): in only mode the target block is hidden, and a clicked cross-reference goes nowhere
    uninstallAnchors?.()
    uninstallAnchors = installAnchorFallback(doc)
    // Attached on this path only: with no translation on there is no translation, and nothing to compare
    if (config.reading.sentenceHighlight) highlight = startSentenceHighlight(doc) ?? null
    active = session
    actions++
    const alive = () => active === session
    progress = { ...idle(), state: 'on' }
    restarted = false
    const startEngine = status.engine.id
    const target = status.targetLanguage
    running = { provider: status.chosen, target, engine: startEngine, revision: status.revision }
    current = { session, config, context, renderPath: status.renderPath }
    prep.reset() // a new session: the mirrors may run once more, the width cache is cleared, the column width is re-read
    enterSide(modes.effective())
    // Each busy → idle transition is one line the e2e suites read (idle-trace.ts)
    const traceIdle = createIdleTrace<Progress>({ now, trace }, p => p.inFlight > 0, (p, ms) =>
      `session idle: ${p.done}/${p.requested} requested of ${p.total}, ${p.failed} failed, ${p.cached} cached, ${ms} ms${p.fatal ? `, fatal: ${p.fatal}` : ''}`)
    run = startTranslation({
      doc,
      blocks,
      target,
      mode: modes.effective(),
      appearance: look,
      paper,
      // The title + the abstract go with every batch (DESIGN §8.2)
      context,
      capabilities: { maxBatchChars: status.maxBatchChars, maxBatchItems: status.maxBatchItems, renderPath: status.renderPath },
      transport: request => backend.translate(request),
      scope: session,
      preload: config.preload,
      // The blocks this batch just touched go to the tidy layer: only their containers are touched, no whole-paper re-scan per pass (issue #46)
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
    // The tab title is translated too (§10): the same service, the same cache; the title is plain text, escaped and decoded by the placeholder protocol
    title = translateTitle(doc, {
      isCurrent: alive,
      translate: async text => {
        const res = await backend.translate({
          request: { segments: [{ id: 'document.title', text: escapeText(text, wireFormatOf(status.renderPath)) }], source: 'en', target, context },
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
   * Image translation (§15): the background is asked first whether the local helper is there; without it the whole
   * path does not run, and the page's translation is unaffected. Bitmaps are lazily loaded by viewport like text
   * blocks; with the current mode outside the reader's ticked set, an image entering the viewport parks and is
   * translated on switching back
   */
  function startImages(session: string, alive: () => boolean, config: Config, context: TranslateContext, renderPath: RenderPath): void {
    // The overlays and the mode gate of the previous round (restarted after a fatal error without a restore) are taken
    // off first: with the helper gone, image translation off or the target language changed, the old ones must not
    // show; the new round replaces them when it reaches the image (Codex on #89)
    setImageModes(doc, [])
    if (!config.image.enabled || config.image.modes.length === 0) return
    if (!paper) return
    const targets = collectImageTargets(doc)
    if (targets.length === 0) return
    imageTargets = targets
    setImageModes(doc, config.image.modes)

    /**
     * The helper decides **bitmaps** only (§15.5). So this round **starts at once**, without waiting for its probe:
     * an SVG figure's text is read out of its contentDocument, and waiting for a handshake unrelated to it makes no
     * sense — a handshake that takes 30 seconds to time out when the helper is installed but hung, and whose own
     * failure would skip the whole stretch (Codex on #134). Bitmap targets park first and are released when the
     * probe comes back.
     */
    let helperReady = false
    const traceIdle = createIdleTrace<ImageProgress>({ now, trace }, p => p.requested - p.done - p.failed > 0, (p, ms) => `images idle: ${p.done}/${p.requested} of ${p.total}, ${p.failed} failed, ${ms} ms`)
    images = startImageTranslation({
      renderPath,
      doc,
      targets,
      paper,
      // The target the session runs on — the chain's, recorded at start (see `running`); the configuration's only before a session exists
      target: running?.target ?? config.targetLanguage,
      scope: session,
      preload: config.preload,
      context,
      ocr: call => deps.ocr(call),
      translate: request => backend.translate(request),
      ...(deps.fetchImage ? { fetchBytes: deps.fetchImage } : {}),
      // The mode gate is the same for both kinds of image; a bitmap additionally waits for the helper (§15.5)
      isEnabled: t => config.image.enabled && config.image.modes.includes(modes?.effective() ?? config.mode) && (t.kind !== 'raster' || helperReady),
      isCurrent: alive,
      onProgress: p => {
        if (!alive()) return
        imageProgress = p
        traceIdle(p)
      },
      // The overlay is in: in side mode the figure it sits in is split in two (§7.2), the tidy layer's job
      onRendered: rendered => {
        if (!alive()) return
        prep.touch(rendered)
      },
    })
    trace(`images: ${targets.filter(t => t.kind === 'svg').length} SVG + ${targets.filter(t => t.kind === 'picture').length} inline pictures + ${targets.filter(t => t.kind === 'raster').length} bitmaps, modes ${config.image.modes.join('/')}`)

    /**
     * Bitmaps wait for the helper. **A failed or absent probe has to settle too**: the bitmap overlays the previous
     * round drew are still on the page, and this round their targets park and would never reach `clearImage` — the
     * old translations (even in the old target language) would just stay (Codex on #134)
     */
    const settleRaster = (available: boolean) => {
      if (!alive()) return
      helperReady = available
      if (available) images?.resume()
      else for (const t of targets) if (t.kind === 'raster') clearImageEverywhere(t)
    }
    // Once the recognition helper is installed, this page has to be released (Codex on #161): with the probe missing
    // at session start the bitmaps park for good, and the page itself has no occasion to ask again
    resumeRaster = () => {
      if (helperReady || !alive()) return false
      settleRaster(true)
      return true
    }
    deps.helperStatus()
      .then(helper => settleRaster(helper.state === 'ready'))
      .catch(e => { trace(`helper-status failed: ${e instanceof Error ? e.message : String(e)}`); settleRaster(false) })
  }

  let fitObserver: ResizeObserver | null = null

  /**
   * The tidy after a translation arrives (DESIGN §7.2 / §10, issue #46): footnote placement, split figures, mirrors,
   * table fitting, margin alignment. Driven by the dirty blocks the pipeline hands over per batch, each pass touching
   * only their containers; the mirrors run once per session; the column width is read at the start of a pass,
   * before anything is written. All of it is renderer/prep.ts; this only wires it up
   */
  const prep = createPrep(doc, {
    isSide: () => modes?.effective() === 'side',
    trace,
  })

  /** The preparation on entering side: the right column gets its copies of formulas and figures (§7.2), and tables shrink to fit a column */
  function enterSide(effective: Mode): void {
    // The mode gate may have just opened: parked images are released (§15)
    images?.resume()
    if (effective !== 'side') {
      fitObserver?.disconnect()
      fitObserver = null
      prep.cancel()
      // The inline margins for alignment serve the two-column layout only and go back to the site's styles in the
      // other modes; the margin-note stacking likewise — in the other modes the floats avoid one another by their own height, with no push from us
      clearPairMargins(doc)
      clearMarginNotes(doc)
      return
    }
    // Entering side: the column width re-read, one full tidy pass (coming back from stack / only the alignment margins were cleared and have to be computed afresh)
    prep.refreshColumn()
    prep.touchAll()
    // The column width follows the window, and the zoom ratios have to be recomputed with it. Only when the width
    // really changed: scaling a table itself makes the observed target report a size change, and without this gate it would oscillate
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
    // Switching is allowed while not translating too: the controller writes the attribute onto <html>, and the styles apply at once
    if (!modes) modes = createModeController(doc, mode, { onChange: enterSide })
    const effective = modes.choose(mode)
    enterSide(effective)
    savedMode = mode
    const config = await deps.config.get()
    if (config.mode !== mode) await deps.config.set({ ...config, mode })
    return { mode, effective }
  }

  function restorePage(epoch?: string): { removedNodes: number; refused?: true } {
    if (epoch !== undefined && epoch !== epochNow()) return { removedNodes: 0, refused: true }
    actions++
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

  // An appearance changed on the settings page applies at once (#47): only the injected sheet and the attributes on
  // <html> are recomputed, not one translation node is touched, and no translation is requested again (§8.5's
  // chainConfigChanged ignores style anyway). A subscription rather than a message: the settings page is itself the
  // active tab and cannot reach the content page; a subscription also updates every open paper at once
  function onConfig(config: Config): void {
    // The gate first, the comparison after: the watcher firing means it holds the newest stored content, even when
    // nothing needs redrawing this time. Otherwise “the page started with the old appearance + the reader clicks
    // restore defaults” takes the equal-value fast path, the gate is not raised, and the old snapshot from the
    // following getConfig() puts the non-default appearance back (Codex on #106)
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
    // The language changed: the failure widgets already drawn copied the words into their own shadow roots and have to be rewritten (Codex on #161)
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
    // Wait for the first configuration read: one answer settles this round's popup mode bar (see the note on savedMode)
    status: () => ready.then(() => ({
      paper,
      mode: modes?.effective() ?? savedMode,
      preference: modes?.preference() ?? savedMode,
      progress,
      session: active,
      epoch: epochNow(),
      ...(imageProgress ? { images: imageProgress } : {}),
      ...(running ? { running } : {}),
    })),
  }
}
