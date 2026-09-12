// The page session (ADR-0004): what the content entry did before it became an adapter, fixed here
// before anything about it is simplified. The pipeline, renderer and scheduler run for real against
// the test document; only the browser-side dependencies (backend, OCR, helper probe, config store,
// locale) are fakes.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CONFIG, type Config } from '@/config/schema'
import { extract } from '@/core/extractor'
import { ID_ATTR } from '@/core/extractor'
import { MODE_ATTR, ON_ATTR, STATE_ATTR, UNDERLINE_ATTR } from '@/core/renderer/attrs'
import { IMG_MODES_ATTR } from '@/core/renderer/image'
import { createPageSession, type PageSession, type SessionDeps } from '@/core/session'
import type { ProviderStatus, TranslationTransport } from '@/providers/transport'
import type { TranslateCall } from '@/providers/translate-service'
import type { ImageBytes } from '@/core/image'
import type { OcrCall, OcrLine } from '@/shared/ocr'
import { S } from '@/ui/strings'

const PAGE =
  '<h2 class="ltx_title ltx_title_section" id="s1">Introduction</h2>'
  + '<p class="ltx_p" id="p1">One sentence here.</p>'
  + '<p class="ltx_p" id="p2">Two sentences here.</p>'
const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="https://arxiv.org/html/x/fig.png" alt=""><figcaption class="ltx_caption">Figure 1. A plot.</figcaption></figure>'

const tick = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async (rounds = 4) => { for (let i = 0; i < rounds; i++) await tick() }

function providerStatus(over: Partial<ProviderStatus> = {}): ProviderStatus {
  return {
    providerId: 'microsoft', available: true, maxBatchChars: 100_000, maxBatchItems: 100, renderPath: 'tags',
    targetLanguage: 'cmn', promptId: 'default', revision: 1, engine: { id: 'microsoft', displayName: 'Microsoft' },
    chain: ['microsoft'], demotions: [], ...over,
  }
}

interface HarnessOptions {
  page?: string
  paper?: string | null
  config?: Partial<Config>
  /** What the backend says it translated with */
  provider?: string
  status?: (scope: string | undefined, calls: number) => ProviderStatus | Promise<ProviderStatus>
  helper?: boolean
  /** Hold the very first configuration read until `releaseConfig()` */
  holdFirstConfig?: boolean
  /** Hold the n-th backend status read until `releaseStatus()` */
  holdStatusAt?: number
  /** Bytes the image pipeline gets for any bitmap URL */
  fetchImage?: (url: string) => Promise<ImageBytes>
  /** What the fake OCR recognises in every bitmap */
  ocrLines?: OcrLine[]
}

function harness(options: HarnessOptions = {}) {
  document.head.innerHTML = '<title>A Paper</title>'
  document.body.innerHTML = `<article class="ltx_document">${options.page ?? PAGE}</article>`
  const blocks = extract(document)
  let config: Config = { ...DEFAULT_CONFIG, ...options.config }
  const calls: TranslateCall[] = []
  const cancelled: string[] = []
  const statusCalls: (string | undefined)[] = []
  const ocrCalls: OcrCall[] = []
  let releaseStatus: () => void = () => undefined
  const backend: TranslationTransport = {
    async translate(call) {
      calls.push(call)
      return { ok: true, result: { segments: call.request.segments.map(s => ({ id: s.id, text: s.text })), provider: options.provider ?? 'microsoft' }, cached: 0 }
    },
    async cancel(scope) { cancelled.push(scope); return 0 },
    async status(scope) {
      statusCalls.push(scope)
      if (options.holdStatusAt === statusCalls.length) await new Promise<void>(resolve => { releaseStatus = resolve })
      return options.status ? options.status(scope, statusCalls.length) : providerStatus()
    },
  }
  let releaseConfig: () => void = () => undefined
  let reads = 0
  const deps: SessionDeps = {
    doc: document,
    blocks,
    paper: options.paper === undefined ? '2410.00260' : options.paper,
    context: { paperTitle: 'A Paper' },
    backend,
    ocr: async call => {
      ocrCalls.push(call)
      if (!options.ocrLines) return { ok: false, error: { kind: 'unknown', message: 'no OCR in this test' } }
      return { ok: true, result: { width: 100, height: 100, lines: options.ocrLines }, cached: false }
    },
    helperStatus: async () => (options.helper ? { state: 'ready', version: '0.1.0' } : { state: 'not-installed' }),
    ...(options.fetchImage ? { fetchImage: options.fetchImage } : {}),
    config: {
      get: async () => {
        reads += 1
        if (reads === 1 && options.holdFirstConfig) await new Promise<void>(resolve => { releaseConfig = resolve })
        return config
      },
      set: async next => { config = next },
    },
    applyLocale: vi.fn(),
    trace: vi.fn(),
  }
  const session = createPageSession(deps)
  return {
    session, blocks, calls, cancelled, statusCalls, ocrCalls, deps,
    config: () => config,
    releaseConfig: () => releaseConfig(),
    releaseStatus: () => releaseStatus(),
    trace: () => (deps.trace as ReturnType<typeof vi.fn>).mock.calls.map(c => String(c[0])),
  }
}

let live: PageSession | null = null
afterEach(() => {
  live?.restore()
  live = null
  document.body.innerHTML = ''
})

describe('page session', () => {
  it('answers status only after the first configuration read, with the stored mode as the preference', async () => {
    const h = harness({ config: { mode: 'stack' }, holdFirstConfig: true })
    let answered = false
    const pending = h.session.status().then(status => { answered = true; return status })
    await settle()
    expect(answered).toBe(false)
    h.releaseConfig()
    const status = await pending
    expect(status).toEqual({ paper: '2410.00260', mode: 'stack', preference: 'stack', progress: { state: 'idle', total: 3, requested: 0, done: 0, failed: 0, cached: 0, inFlight: 0 }, session: null })
  })

  it('start: marks the page, mints a session, reports what it runs on', async () => {
    const h = harness()
    live = h.session
    expect(await h.session.start()).toEqual({ started: true })
    await settle()
    const html = document.documentElement
    expect(html.hasAttribute(ON_ATTR)).toBe(true)
    // the stored preference is `side`; the effective mode depends on the test window's width (§7.2)
    const effective = html.getAttribute(MODE_ATTR)
    expect(['side', 'stack']).toContain(effective)
    expect(document.querySelectorAll(`[${ID_ATTR}]`)).toHaveLength(3)
    expect(document.querySelectorAll(`[${STATE_ATTR}="pending"]`)).toHaveLength(3)
    const status = await h.session.status()
    expect(status.session).toEqual(expect.any(String))
    expect(status.preference).toBe(DEFAULT_CONFIG.mode)
    expect(status.mode).toBe(effective)
    expect(status.progress.state).toBe('on')
    expect(status.running).toEqual({ provider: DEFAULT_CONFIG.provider, target: DEFAULT_CONFIG.targetLanguage, engine: 'microsoft', revision: 1 })
    expect(status.images).toBeUndefined()
  })

  it('a second start is refused while the session is on; a restart replaces it and cancels the old scope', async () => {
    const h = harness()
    live = h.session
    await h.session.start()
    const first = (await h.session.status()).session!
    expect(await h.session.start()).toEqual({ started: false, reason: S.page.alreadyOn })
    expect(await h.session.start(undefined, true)).toEqual({ started: true })
    const second = (await h.session.status()).session!
    expect(second).not.toBe(first)
    expect(h.cancelled).toEqual([first])
  })

  it('refuses to start off a paper page, on an empty page, without a backend, and without any usable service', async () => {
    expect(await harness({ paper: null }).session.start()).toEqual({ started: false, reason: S.page.notPaper })
    expect(await harness({ page: '<div class="ltx_para"></div>' }).session.start()).toEqual({ started: false, reason: S.page.nothingToTranslate })
    const silent = harness({ status: () => Promise.reject(new Error('gone')) })
    expect(await silent.session.start()).toEqual({ started: false, reason: `${S.page.backendSilent}：gone` })
    const none = harness({ status: () => providerStatus({ available: false }) })
    expect(await none.session.start()).toEqual({ started: false, reason: S.page.noService })
    // a fallback on the chain is enough to start: the requests land on the free engine (§8.5)
    const fallback = harness({ status: () => providerStatus({ available: false, fallback: { id: 'google-web', displayName: 'Google' } }) })
    live = fallback.session
    expect(await fallback.session.start()).toEqual({ started: true })
  })

  it('restore: every injected node and attribute goes, the scope is cancelled, and a stale automatic restart is refused', async () => {
    const h = harness()
    await h.session.start()
    await settle()
    const id = (await h.session.status()).session!
    const result = h.session.restore()
    expect(result.removedNodes).toBeGreaterThanOrEqual(0)
    expect(document.querySelectorAll('[class*="axt-"], [data-axt-on]')).toHaveLength(0)
    expect(Array.from(document.querySelectorAll('*')).some(el => Array.from(el.attributes).some(a => a.name.startsWith('data-axt-')))).toBe(false)
    expect(h.cancelled).toEqual([id])
    const status = await h.session.status()
    expect(status.session).toBeNull()
    expect(status.progress.state).toBe('idle')
    expect(status.running).toBeUndefined()
    // the continuation of a restart decided in the old session must not translate the page again (Codex on #157)
    expect(await h.session.start(undefined, true, id)).toEqual({ started: false, reason: S.page.sessionOver })
    expect((await h.session.status()).session).toBeNull()
  })

  it('translates the blocks it is handed and reports progress', async () => {
    const h = harness()
    live = h.session
    await h.session.start()
    await settle()
    await h.session.translate(h.blocks.slice(1))
    const id = (await h.session.status()).session!
    expect(h.calls.length).toBeGreaterThanOrEqual(1)
    expect(h.calls.every(c => c.scope === id)).toBe(true)
    const status = await h.session.status()
    expect(status.progress).toMatchObject({ state: 'on', requested: 2, done: 2, failed: 0 })
    expect(document.querySelectorAll('.axt-t')).toHaveLength(2)
    // The line the e2e suites parse (extension.mjs's IDLE regex): one per busy → idle transition, in this format
    const idle = h.trace().filter(line => line.startsWith('session idle:'))
    expect(idle.length).toBeGreaterThanOrEqual(1)
    for (const line of idle) expect(line).toMatch(/^session idle: \d+\/\d+ requested of \d+, \d+ failed, \d+ cached, \d+ ms$/)
    expect(h.session.retryFailed()).toBe(0)
  })

  it('restoring the page while an automatic restart awaits the backend refuses that restart and sends nothing more', async () => {
    // the restart's own status read (the second one) is held so the restore can land in the middle of it (Codex on #157)
    const h = harness({ holdStatusAt: 2 })
    live = h.session
    await h.session.start()
    await settle()
    const id = (await h.session.status()).session!
    const restart = h.session.start(undefined, true, id)
    await settle()
    h.session.restore()
    const before = h.calls.length
    h.releaseStatus()
    expect(await restart).toEqual({ started: false, reason: S.page.sessionOver })
    expect((await h.session.status()).session).toBeNull()
    expect(document.documentElement.hasAttribute(ON_ATTR)).toBe(false)
    expect(h.calls.length).toBe(before)
    expect(h.cancelled).toEqual([id])
  })

  it('every request — text, title, OCR and image labels — carries the active session id, and a restart moves them to the new one', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).buffer
    const h = harness({
      page: PAGE + FIGURE,
      helper: true,
      config: { image: { enabled: true, modes: ['side', 'stack', 'only'] } },
      fetchImage: async () => ({ bytes: png, mime: 'image/png' }),
      ocrLines: [{ text: 'Energy density', quad: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.2], [0.1, 0.2]], conf: 0.99 }],
    })
    live = h.session
    await h.session.start()
    await settle()
    const id = (await h.session.status()).session!
    await h.session.translate(h.blocks.slice(1))
    await h.session.translateImages()
    await settle(6)
    expect(h.calls.some(c => c.request.segments[0]?.id === 'document.title')).toBe(true)
    expect(h.calls.some(c => c.request.segments[0]?.id.endsWith('#L0'))).toBe(true)
    expect(h.calls.length).toBeGreaterThanOrEqual(3)
    expect(h.calls.map(c => c.scope)).toEqual(h.calls.map(() => id))
    expect(h.ocrCalls.map(c => c.scope)).toEqual([id])
    // after a restart the new id goes out, never the old one
    await h.session.start(undefined, true)
    const next = (await h.session.status()).session!
    const since = h.calls.length
    await h.session.translate(h.blocks.slice(1))
    await settle()
    expect(h.calls.length).toBeGreaterThan(since)
    expect(h.calls.slice(since).map(c => c.scope)).toEqual(h.calls.slice(since).map(() => next))
  })

  it('a permanent hand-over restarts the page once on the serving engine; a temporary one does not', async () => {
    let handedOver = false
    const h = harness({
      provider: 'google-web',
      status: scope => {
        if (scope !== undefined) { handedOver = true; return providerStatus({ demotions: [{ id: 'microsoft', kind: 'auth' }] }) }
        return providerStatus(handedOver ? { engine: { id: 'google-web', displayName: 'Google' }, chain: ['microsoft', 'google-web'] } : {})
      },
    })
    live = h.session
    await h.session.start()
    const first = (await h.session.status()).session!
    await h.session.translate(h.blocks.slice(1, 2))
    await settle(8)
    const second = (await h.session.status()).session!
    expect(second).not.toBe(first)
    expect(h.cancelled).toEqual([first])
    expect(h.statusCalls).toContain(first)
    expect(h.trace().some(line => line.startsWith('hand-over to google-web is permanent (auth)'))).toBe(true)
    // the new session runs on google-web: translating again changes nothing
    await h.session.translate(h.blocks.slice(2, 3))
    await settle(8)
    expect((await h.session.status()).session).toBe(second)

    const temporary = harness({
      provider: 'google-web',
      status: scope => providerStatus(scope !== undefined ? { demotions: [{ id: 'microsoft', kind: 'rate-limit' }] } : {}),
    })
    live?.restore()
    live = temporary.session
    await temporary.session.start()
    const id = (await temporary.session.status()).session!
    await temporary.session.translate(temporary.blocks.slice(1, 2))
    await settle(8)
    expect((await temporary.session.status()).session).toBe(id)
    expect(temporary.cancelled).toEqual([])
  })

  it('a look chosen while the first configuration read is in flight survives that read (the watcher gate)', async () => {
    const underlined = { id: 'svc-test', name: 'Test', color: '', opacity: 1, underline: 'solid' as const, thickness: 1 as const, blur: false, css: '' }
    const h = harness({ holdFirstConfig: true })
    live = h.session
    const chosen: Config = { ...h.config(), appearance: { ...h.config().appearance, styles: [...h.config().appearance.styles, underlined], activeStyle: 'svc-test' } }
    h.session.onConfig(chosen)
    // the late read returns the stored configuration, whose active style has no underline
    h.releaseConfig()
    await h.session.ready
    await h.session.start()
    expect(document.documentElement.getAttribute(UNDERLINE_ATTR)).toBe('solid')
  })

  it('setMode switches the attribute at once, persists the preference, and works before any session', async () => {
    const h = harness({ config: { mode: 'side' } })
    live = h.session
    expect(await h.session.setMode('stack')).toEqual({ mode: 'stack', effective: 'stack' })
    expect(document.documentElement.getAttribute(MODE_ATTR)).toBe('stack')
    expect(h.config().mode).toBe('stack')
    const status = await h.session.status()
    expect(status.preference).toBe('stack')
    expect(status.mode).toBe('stack')
    await h.session.start()
    expect(document.documentElement.getAttribute(MODE_ATTR)).toBe('stack')
    await h.session.setMode('only')
    expect(document.documentElement.getAttribute(MODE_ATTR)).toBe('only')
    expect((await h.session.status()).preference).toBe('only')
  })

  it('a configuration change re-applies the interface language and nothing else is required to see it', async () => {
    const h = harness()
    live = h.session
    await h.session.start()
    h.session.onConfig({ ...h.config(), uiLanguage: 'en' })
    expect(h.deps.applyLocale).toHaveBeenCalledWith('en')
  })

  it('images: bitmaps wait for the helper, resumeRaster releases them once, the switch clears the overlays gate', async () => {
    const h = harness({ page: PAGE + FIGURE, config: { image: { enabled: true, modes: ['side', 'stack', 'only'] } } })
    live = h.session
    await h.session.start()
    await settle()
    expect(document.documentElement.getAttribute(IMG_MODES_ATTR)).toBe('side stack only')
    expect(h.trace().some(line => line.startsWith('images: 0 SVG + 0 inline pictures + 1 bitmaps'))).toBe(true)
    // the probe said "not available": the bitmap is parked, and the first resume releases it
    expect(h.session.resumeRaster()).toBe(true)
    expect(h.session.resumeRaster()).toBe(false)
    // switching image translation off mid-session drops the gate attribute
    h.session.onConfig({ ...h.config(), image: { enabled: false, modes: [] } })
    expect(document.documentElement.hasAttribute(IMG_MODES_ATTR)).toBe(false)
    // outside a session nothing is parked
    h.session.restore()
    live = null
    expect(h.session.resumeRaster()).toBe(false)
  })
})
