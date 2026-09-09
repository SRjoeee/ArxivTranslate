import { useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import type { BlockStats } from '@/core/extractor/stats'
import type { ProviderStatus } from '@/providers/transport'
import type { Mode } from '@/core/renderer'
import { configFallbackReason, getConfig, setConfig } from '@/config/storage'
import type { Config } from '@/config/schema'
import { BUILTIN_SOURCE_LANGUAGE } from '@/providers/chrome-builtin'
import { BUILT_IN_PROMPTS } from '@/providers/prompt-library'
import { toBcp47 } from '@/config/languages'
import { sendMessage, sendToActiveTab, type PageStatus } from '@/shared/messages'

const scriptStart = performance.now()

// Translate / restore / progress, provider status and mode switching (§7.2); engines are selected in settings.
export function App() {
  const [ping, setPing] = useState('Connecting to background…')
  const [provider, setProvider] = useState<ProviderStatus | null>(null)
  const [page, setPage] = useState<PageStatus | null>(null)
  const [stats, setStats] = useState<BlockStats | null>(null)
  const [note, setNote] = useState('')
  const [config, setLocalConfig] = useState<Config | null>(null)
  /** Chrome language pack status (§8.4): downloadable requires create() inside a click handler for the user gesture. */
  const [pack, setPack] = useState<'unsupported' | 'available' | 'downloadable' | 'downloading' | 'unavailable' | null>(null)
  const [packNote, setPackNote] = useState('')
  /** Configuration fallback reason; show a warning at the top when non-null. */
  const [configFallback, setConfigFallback] = useState<string | null>(null)

  const refresh = useCallback(() => {
    sendToActiveTab({ type: 'axt:page-status' }).then(setPage).catch(() => setPage(null))
  }, [])
  const loadStats = useCallback(() => {
    sendToActiveTab({ type: 'axt:stats' }).then(setStats).catch(() => setStats(null))
  }, [])
  /** Recheck engine availability after downloads or setting changes so the Translate button does not retain its initial state. */
  const loadProvider = useCallback(() => {
    sendMessage({ type: 'axt:provider-status' }).then(setProvider).catch(() => setProvider(null))
  }, [])
  /** Language pack status (§8.4): Translator is available in the popup extension page, so no content-script detour is needed. */
  const checkPack = useCallback(async (target: string) => {
    const api = (globalThis as { Translator?: { availability(o: { sourceLanguage: string; targetLanguage: string }): Promise<string> } }).Translator
    if (!api) return setPack('unsupported')
    try {
      const state = await api.availability({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(target) })
      setPack(state as 'available' | 'downloadable' | 'downloading' | 'unavailable')
    } catch {
      setPack('unavailable')
    }
  }, [])

  useEffect(() => {
    console.debug(`[axt] popup mounted ${Math.round(performance.now() - scriptStart)} ms after script start`)
    const t0 = performance.now()
    sendMessage({ type: 'axt:ping' })
      .then(r => {
        setPing(`Background connected v${r.version}`)
        console.debug(`[axt] ping round-trip ${Math.round(performance.now() - t0)} ms`)
      })
      .catch(e => setPing(`Background did not respond: ${String(e)}`))
    loadProvider()
    getConfig().then(config => {
      setLocalConfig(config)
      // Falling back to defaults disables the user's saved key, engine and mode; explain this explicitly.
      setConfigFallback(configFallbackReason())
      void checkPack(config.targetLanguage)
    }).catch(() => setLocalConfig(null))
    loadStats()
    refresh()
  }, [refresh, loadStats, checkPack, loadProvider])

  // While a page loads, content script has not yet injected (document_idle), so the first message may have no receiver.
  // Retry a few times at 500 ms intervals before deciding this is not an arXiv page (Codex #3).
  useEffect(() => {
    if (page !== null) return
    let attempts = 0
    const id = setInterval(() => {
      if (++attempts > 6) {
        clearInterval(id)
        return
      }
      refresh()
      loadStats()
    }, 500)
    return () => clearInterval(id)
  }, [page, refresh, loadStats])

  // Poll progress every 500 ms while translation is on: scrolling keeps triggering work; there is no final completion (§10).
  // Also fetch background fallback status; measured message round trips take milliseconds (RESEARCH §6.7).
  const on = page?.progress.state === 'on'
  useEffect(() => {
    if (!on) return
    const id = setInterval(() => {
      refresh()
      loadProvider()
    }, 500)
    return () => clearInterval(id)
  }, [on, refresh, loadProvider])

  async function translate() {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:translate-page' })
      if (!r.started) setNote(r.reason ?? 'Could not start')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  const MODES: [Mode, string, string][] = [
    ['stack', 'Stacked', 'Translation follows the original; works at any width'],
    ['side', 'Side by side', 'Needs a wide window; automatically uses stacked mode when narrow'],
    ['only', 'Translation only', 'Hide the original; references remain bilingual'],
  ]

  async function chooseMode(mode: Mode) {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:set-mode', mode })
      if (r.mode !== r.preference) setNote(`Window is narrow; using stacked mode (selected: ${MODES.find(([m]) => m === r.preference)?.[1] ?? r.preference})`)
      refresh()
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  async function retryFailed() {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:retry-failed' })
      setNote(`Resubmitted ${r.retried} blocks`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  /**
   * Prompt selection (Read Frog popup translate-prompt-selector): save immediately; takes effect the next time Translate is clicked.
   * Change only prompts; read all other fields from current storage. Content script writes mode changes, making the popup's initial snapshot stale.
   * Writing the whole snapshot would revert the mode (Codex #39).
   */
  async function choosePrompt(promptId: string) {
    try {
      const latest = await getConfig()
      const next = { ...latest, prompts: { ...latest.prompts, promptId } }
      setLocalConfig(next)
      await setConfig(next)
      if (on) setNote('Prompt saved. Restore the original, then click Translate to apply it.')
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
  }

  /**
   * Download a language pack. **Must run directly from a click**: create() without a gesture throws NotAllowedError when downloadable (RESEARCH §6.1).
   * During the first download, availability() remains downloadable and the monitor emits no progress (67s observed), so show an indeterminate state.
   */
  async function downloadPack() {
    if (!config) return
    const api = (globalThis as { Translator?: { create(o: { sourceLanguage: string; targetLanguage: string }): Promise<unknown> } }).Translator
    if (!api) return
    setPack('downloading')
    setPackNote('Downloading language pack; the first download takes about a minute…')
    try {
      await api.create({ sourceLanguage: BUILTIN_SOURCE_LANGUAGE, targetLanguage: toBcp47(config.targetLanguage) })
      await checkPack(config.targetLanguage)
      // Recheck availability so Translate becomes enabled without closing and reopening the popup.
      loadProvider()
      // An active page may have permanently demoted the built-in engine for this session; reset it so later blocks use offline translation.
      // The chain lives in background (§8.0): rebuild it to include the now-available built-in engine.
      const reset = await sendMessage({ type: 'axt:engine-ready', id: 'chrome-builtin' }).then(r => r.reset).catch(() => false)
      setPackNote(reset ? 'Ready; subsequent paragraphs will use the offline engine' : 'Ready; click Translate to start')
    } catch (e) {
      setPackNote(`Download failed: ${e instanceof Error ? e.message : String(e)}`)
      await checkPack(config.targetLanguage)
    }
  }

  async function restorePage() {
    setNote('')
    try {
      const r = await sendToActiveTab({ type: 'axt:restore-page' })
      setNote(`Original restored (${r.removedNodes} translation nodes removed)`)
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e))
    }
    refresh()
  }

  // A fallback allows translation even if the preferred engine is unavailable (§8.5); ignoring it would disable Translate despite a working Google fallback.
  const canTranslate = !!page?.paper && (!!provider?.available || !!provider?.fallback) && !on
  const canRestore = !!page && page.progress.state !== 'idle'

  return (
    <main style={{ minWidth: 280, padding: 12, font: '13px system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 14, margin: '0 0 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        arXiv HTML Translator
        <button type="button" style={{ font: 'inherit', fontSize: 12 }} onClick={() => browser.runtime.openOptionsPage()}>Settings</button>
      </h1>
      {configFallback && (
        <p style={{ margin: '0 0 8px', padding: '6px 8px', borderRadius: 4, background: '#fdf0f0', color: '#b00' }}>
          Could not read configuration; using defaults. Your saved API key and engine selection <strong>are not active</strong>.
          <span style={{ display: 'block', marginTop: 4, color: '#666' }}>{configFallback}</span>
        </p>
      )}
      <p style={{ margin: '0 0 4px', color: '#666' }}>{ping}</p>
      <p style={{ margin: '0 0 8px', color: '#666' }}>
        {provider === null
          ? 'Engine status unknown'
          : provider.available
            ? `Engine: ${provider.providerId} · ${provider.model ?? ''}`
            : provider.fallback
              ? `${provider.providerId} unavailable; using ${provider.fallback.displayName}`
              : provider.providerId === 'chrome-builtin'
                ? 'Built-in language pack is not ready; download it below'
                : 'API key not configured; add it in Settings'}
      </p>

      {page === null
        ? <p style={{ margin: 0, color: '#666' }}>This tab is not an arXiv HTML page, or it needs a refresh after an extension update</p>
        : (
          <section>
            <p style={{ margin: '0 0 8px' }}>
              <button type="button" onClick={translate} disabled={!canTranslate}>{on ? 'On' : 'Translate'}</button>
              {' '}
              <button type="button" onClick={restorePage} disabled={!canRestore}>Restore original</button>
            </p>
            <p style={{ margin: '0 0 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
              <span style={{ color: '#666' }}>View</span>
              {MODES.map(([m, label, title]) => (
                <button
                  type="button"
                  key={m}
                  title={title}
                  onClick={() => chooseMode(m)}
                  aria-pressed={page.preference === m}
                  style={{ font: 'inherit', fontWeight: page.preference === m ? 700 : 400 }}
                >
                  {label}
                </button>
              ))}
            </p>
            {config?.provider === 'openai-compat' && (
              <p style={{ margin: '0 0 8px', display: 'flex', gap: 4, alignItems: 'center' }}>
                <span style={{ color: '#666' }}>Prompt</span>
                <select style={{ font: 'inherit', fontSize: 12, flex: 1 }} value={config.prompts.promptId} onChange={e => choosePrompt(e.target.value)}>
                  {Object.values(BUILT_IN_PROMPTS).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  {config.prompts.patterns.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </p>
            )}
            {provider?.engine.demoted && (
              <p style={{ margin: '0 0 8px', padding: 6, background: '#fff4e5', borderRadius: 4, fontSize: 12, lineHeight: 1.5 }}>
                {provider.engine.demoted.displayName} unavailable ({provider.engine.demoted.kind}); switched to {provider.engine.displayName}.
                Translation quality is lower than an LLM. Fix settings, restore the original and translate again to switch back.
              </p>
            )}
            {(pack === 'downloadable' || pack === 'downloading' || packNote) && (
              <p style={{ margin: '0 0 8px', fontSize: 12, color: '#666' }}>
                {pack === 'downloadable' && (
                  <button type="button" style={{ font: 'inherit', fontSize: 12 }} onClick={downloadPack}>Download offline language pack</button>
                )}
                {pack === 'downloading' && <span>Downloading…</span>}
                {packNote && <span style={{ display: 'block', marginTop: 4 }}>{packNote}</span>}
              </p>
            )}
            <ProgressLine page={page} />
            {/* No retry after fatal errors: the run is halted and content-side translate() returns immediately,
                while still reporting the failed block count, falsely claiming N blocks were resubmitted without any request (Codex #36).
                Instead, fix configuration and click Translate as instructed above to start a new run. */}
            {(page.progress.failed > 0 || (page.images?.failed ?? 0) > 0) && page.progress.state !== 'idle' && !page.progress.fatal && !page.images?.fatal && (
              <p style={{ margin: '6px 0 0' }}>
                <button type="button" style={{ font: 'inherit', fontSize: 12 }} onClick={retryFailed}>
                  Retry failed {[page.progress.failed > 0 ? `${page.progress.failed} blocks` : '', (page.images?.failed ?? 0) > 0 ? `${page.images?.failed} images` : ''].filter(Boolean).join(', ')}
                </button>
              </p>
            )}
          </section>
        )}
      {note && <p style={{ margin: '8px 0 0', color: '#b00' }}>{note}</p>}
      {stats && <StatsLine stats={stats} />}
    </main>
  )
}

function ProgressLine({ page }: { page: PageStatus }) {
  const p = page.progress
  // Translate what enters view (§10): show translated / triggered (total); translation stays on rather than reaching a final completion.
  const counts = `Translated ${p.done} / triggered ${p.requested} (${p.total} total)${p.failed ? `, failed ${p.failed}` : ''}${p.cached ? `, cached ${p.cached}` : ''}`
  const text = p.state === 'idle' ? 'Not translated'
    : p.state === 'on' ? `${counts}${p.inFlight > 0 ? ' · Translating…' : ' · Ready; scroll to continue'}`
    : `Stopped: ${counts}`
  const images = page.images
  return (
    <p style={{ margin: 0 }}>
      {text}
      {images && images.requested > 0 && <span> | Images {images.done}/{images.requested}{images.failed ? `, failed ${images.failed}` : ''}</span>}
      {images?.fatal && <span style={{ color: '#b00' }}> | Image translation stopped: {images.fatal}. Restore the original, fix settings and translate again.</span>}
      {p.fatal && <span style={{ color: '#b00' }}> | {p.fatal}. Fix settings and click Translate to continue.</span>}
    </p>
  )
}

function StatsLine({ stats }: { stats: BlockStats }) {
  return (
    <p style={{ margin: '8px 0 0', color: '#666', fontSize: 12 }}>
      Blocks {stats.total} (text {stats.text}, tables {stats.table}; cells {stats.cells}, numeric cells {stats.numericCells})
    </p>
  )
}
