import type { Config } from '@/config/schema'
import { getConfig, setConfig } from '@/config/storage'
import { extract, paperContext, type Block } from '@/core/extractor'
import { collectImageTargets, startImageTranslation, type ImageRun } from '@/core/image'
import { statsOf } from '@/core/extractor/stats'
import { paperIdFromUrl, startTranslation, type Progress, type TranslationRun } from '@/core/pipeline'
import {
  clearPairMargins, createModeController, createPrep, installAnchorFallback,
  restore, setImageModes,
  type Mode, type ModeController,
} from '@/core/renderer'
import { decodeText, escapeText } from '@/core/protector/text'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { beginSession, endSession, getSessionId, translateTitle, type TitleTranslator } from '@/core/scheduler'
import { isAxtMessage, sendMessage } from '@/shared/messages'
import type { ImageProgress } from '@/shared/ocr'
import { createMessageTransport } from '@/shared/transport'
import { enableDebug } from './debug'

// Inject on arxiv.org/html/*. Page load only extracts (no DOM writes), retaining Block[] in memory.
// Translation starts on popup axt:translate-page (DESIGN §4.1). #axt-debug outlines blocks; #axt-translate auto-starts for debugging/automation.
export default defineContentScript({
  matches: ['https://arxiv.org/html/*'],
  runAt: 'document_idle',
  main() {
    const t0 = performance.now()
    const blocks: Block[] = extract(document)
    // Extract title/abstract once before translations exist, avoiding previous translations being included in the abstract on a later pass.
    const paperContextValue = paperContext(document)
    console.debug(`[axt] extracted ${blocks.length} blocks in ${Math.round(performance.now() - t0)} ms`)

    const paper = paperIdFromUrl(location.href)
    // Store mode preference in config; ModeController determines the effective mode from viewport width (§7.2).
    // Do not create the controller before translation, avoiding data-axt-mode on untouched pages; popup sees the stored preference then.
    // Engine chain, queues and requests live in background (DESIGN §8.0): content fetch uses page origin and CORS preflight,
    // and HTTPS pages cannot reach HTTP endpoints such as local Ollama (RESEARCH §6.7). Keep only a message proxy here.
    const backend = createMessageTransport()
    let modes: ModeController | null = null
    /** Anchor fallback teardown (issue #44): install on session start, remove on restore. */
    let uninstallAnchors: (() => void) | null = null
    let savedMode: Mode = 'stack'
    /** Translation style (§7.5): like mode, an <html> attribute; read config once at translation start. */
    let style: Config['style'] = { preset: 'none', customCss: '' }
    void getConfig().then(config => { savedMode = config.mode; style = config.style })
    // One session = one run (observers/requests) + a session id as cancellation scope (DESIGN §10).
    let run: TranslationRun | null = null
    let title: TitleTranslator | null = null
    /** Image translation (§15), only with an available helper and at least one enabled mode. */
    let images: ImageRun | null = null
    let imageProgress: ImageProgress | null = null
    const idle = (): Progress => ({ state: 'idle', total: blocks.length, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 })
    let progress: Progress = idle()

    /** End this session: disconnect observers, remove pending nodes, cancel queued/in-flight requests; retain rendered translations. */
    function endRun(): void {
      title?.stop()
      title = null
      run?.stop()
      run = null
      images?.stop()
      images = null
      imageProgress = null
      const session = endSession()
      // Best-effort cancellation: queued batches stop, fetches abort; session-id checks below reject any uncancelled results.
      if (session) void backend.cancel(session)
    }

    async function start(requested?: Mode): Promise<{ started: boolean; reason?: string }> {
      if (progress.state === 'on') return { started: false, reason: 'Translation is already on; scroll to continue' }
      if (!paper) return { started: false, reason: 'Not an arXiv HTML page' }
      if (blocks.length === 0) return { started: false, reason: 'No translatable blocks on this page' }
      const tStart = performance.now()
      const config = await getConfig()
      // Send glossary in every batch (§8.2). Omit empty glossaries: including the field would invalidate every existing cache key at once.
      const context = config.glossary.length > 0 ? { ...paperContextValue, glossary: config.glossary } : paperContextValue
      // The chain lives in background; fetch only capabilities needed for batch planning and rendering-path selection (§2, rule 3).
      let status: Awaited<ReturnType<typeof backend.status>>
      try {
        status = await backend.status()
      } catch (e) {
        return { started: false, reason: `Extension background did not respond: ${e instanceof Error ? e.message : String(e)}` }
      }
      // Start normally when a fallback exists even if the preferred engine is unavailable; requests go directly to a free engine (§8.5).
      if (!status.available && !status.fallback) return { started: false, reason: 'API key not configured; add it in Settings' }
      console.debug(`[axt] start: ready in ${Math.round(performance.now() - tStart)} ms, since page start ${Math.round(tStart)} ms`)

      modes?.stop()
      modes = createModeController(document, requested ?? config.mode, { onChange: enterSide })
      style = config.style
      endRun() // Previous halted session not yet restored, e.g. retry after a fatal error.
      // Anchor fallback (issue #44): only mode hides target blocks, otherwise cross-references appear unresponsive.
      uninstallAnchors?.()
      uninstallAnchors = installAnchorFallback(document)
      const session = beginSession()
      progress = { ...idle(), state: 'on' }
      prep.reset() // New session: allow mirroring again, clear measurement cache and reread column width.
      enterSide(modes.effective())
      const t1 = performance.now()
      let wasBusy = false
      run = startTranslation({
        doc: document,
        blocks,
        target: config.targetLanguage,
        mode: modes.effective(),
        style,
        paper,
        // Include title/abstract in every batch (DESIGN §8.2).
        context,
        capabilities: { maxBatchChars: status.maxBatchChars, maxBatchItems: status.maxBatchItems, preservesMarkup: status.preservesMarkup },
        transport: request => backend.translate(request),
        scope: session,
        preload: config.preload,
        // Pass this batch's changed blocks to preparation; touch only their containers, avoiding a full-page rescan each time (issue #46).
        onRendered: blocks => {
          if (getSessionId() !== session) return
          prep.touch(blocks)
        },
        onProgress: p => {
          // Ignore callbacks from old runs after restore or restart ends their session.
          if (getSessionId() !== session) return
          progress = p
          // Translation stays on without a final endpoint; log each busy-to-idle transition for e2e and manual tests.
          const busy = p.inFlight > 0
          if (wasBusy && !busy) {
            console.debug(`[axt] session idle: ${p.done}/${p.requested} requested of ${p.total}, ${p.failed} failed, ${p.cached} cached, ${Math.round(performance.now() - t1)} ms${p.fatal ? `, fatal: ${p.fatal}` : ''}`)
          }
          wasBusy = busy
        },
      })
      run.ready.catch(e => console.error('[axt] translation crashed', e))
      // Translate the tab title too (§10), using the same service/cache; escape plain text for the placeholder protocol, then decode.
      title = translateTitle(document, {
        isCurrent: () => getSessionId() === session,
        translate: async text => {
          const res = await backend.translate({
            request: { segments: [{ id: 'document.title', text: escapeText(text) }], source: 'en', target: config.targetLanguage, context },
            cache: { paper, renderPath: 'markup' },
            scope: session,
          })
          return res.ok ? decodeText(res.result.segments[0]?.text ?? '') || null : null
        },
      })
      startImages(session, config, context)
      return { started: true }
    }

    /**
     * Image translation (§15): ask background whether the local helper exists; otherwise skip this path while leaving page translation unaffected.
     * Bitmaps lazy-load by viewport like text blocks; images entering view in a disabled mode wait until an enabled mode is selected.
     */
    function startImages(session: string, config: Config, context: Parameters<typeof startTranslation>[0]['context']): void {
      // Remove prior overlays and mode gates when restarting after a fatal error without restore: the helper may be gone, image translation disabled,
      // or target changed. Old overlays must not remain; the new run replaces them as it reaches each image (Codex #89).
      setImageModes(document, [])
      if (config.image.modes.length === 0) return
      sendMessage({ type: 'axt:helper-status' }).then(status => {
        if (!status.available || getSessionId() !== session || !paper) return
        setImageModes(document, config.image.modes)
        const targets = collectImageTargets(document)
        if (targets.length === 0) return
        const t1 = performance.now()
        let wasBusy = false
        images = startImageTranslation({
          doc: document,
          targets,
          paper,
          target: config.targetLanguage,
          scope: session,
          preload: config.preload,
          context,
          ocr: call => sendMessage({ type: 'axt:ocr', ...call }),
          translate: request => backend.translate(request),
          isEnabled: () => config.image.modes.includes(modes?.effective() ?? config.mode),
          isCurrent: () => getSessionId() === session,
          onProgress: p => {
            if (getSessionId() !== session) return
            imageProgress = p
            const busy = p.requested - p.done - p.failed > 0
            if (wasBusy && !busy) console.debug(`[axt] images idle: ${p.done}/${p.requested} of ${p.total}, ${p.failed} failed, ${Math.round(performance.now() - t1)} ms`)
            wasBusy = busy
          },
          // Overlay inserted: preparation splits its figure into two in side mode (§7.2).
          onRendered: rendered => {
            if (getSessionId() !== session) return
            prep.touch(rendered)
          },
        })
        console.debug(`[axt] images: ${targets.length} bitmaps, helper ${status.version ?? ''}, modes ${config.image.modes.join('/')}`)
      }).catch(e => console.debug('[axt] helper-status failed', e))
    }

    let fitObserver: ResizeObserver | null = null

    /**
     * Post-translation preparation (DESIGN §7.2 / §10, issue #46): relocate notes, split figures, mirror, fit tables and align margins.
     * Driven by each pipeline batch's changed blocks, touching only their containers. Mirror once per session.
     * Read column width before any writes on each pass. Implementation lives in renderer/prep.ts; this only wires it up.
     */
    const prep = createPrep(document, {
      isSide: () => modes?.effective() === 'side',
      trace: line => console.debug(`[axt] ${line}`),
    })

    /** Prepare side mode: mirror formulas/figures into the right column (§7.2) and shrink tables to fit one column. */
    function enterSide(effective: Mode): void {
      // A mode gate may have just opened; release waiting images (§15).
      images?.resume()
      if (effective !== 'side') {
        fitObserver?.disconnect()
        fitObserver = null
        prep.cancel()
        // Inline alignment margins serve side mode only; restore site styling for other modes.
        clearPairMargins(document)
        return
      }
      // Entering side: reread column width and run full preparation; stack/only cleared alignment margins, so recalculate.
      prep.refreshColumn()
      prep.touchAll()
      // Window changes require rescaling tables, but only when column width actually changes.
      // Table scaling itself triggers an observed resize; without this gate, it would oscillate.
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
      // Allow switching even while not translating; the controller updates <html> and styles apply immediately.
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
          const failedImages = images?.failed() ?? []
          void images?.translate(failedImages)
          sendResponse({ retried: failed.length + failedImages.length })
          return true
        }
        case 'axt:page-status':
          sendResponse({ paper, mode: modes?.effective() ?? savedMode, preference: modes?.preference() ?? savedMode, progress, ...(imageProgress ? { images: imageProgress } : {}) })
          return true
      }
    })

    if (location.hash === '#axt-debug') enableDebug(blocks)
    if (location.hash === '#axt-translate') void start()
  },
})
