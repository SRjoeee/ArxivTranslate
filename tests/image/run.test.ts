import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { MAX_IMAGE_BYTES, captionOf, collectImageTargets, readImageResponse, startImageTranslation, toBase64, type ImageRunOptions, type ImageTarget } from '@/core/image'
import { IMG_CLASS } from '@/core/marks'
import { restore } from '@/core/renderer'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import type { OcrCall, OcrLine } from '@/shared/ocr'
import { docOf } from '../renderer/helpers'

// Image translation pipeline (DESIGN §15). happy-dom has no IntersectionObserver, so tests submit targets through translate.

const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="https://arxiv.org/html/x/a.png" id="F1.g1" width="476" height="357">'
  + '<figcaption class="ltx_caption" id="F1.cap">Figure 1. Escape velocity versus radius.</figcaption></figure>'
const line = (text: string, y: number): OcrLine => ({ text, conf: 1, quad: [[0.1, y], [0.3, y], [0.3, y + 0.03], [0.1, y + 0.03]] })
const LINES = [line('Static charge', 0.1), line('Even sites', 0.5), line('12.5', 0.9)]
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer

/** Start another run on the same DOM, reusing doc, targets, fetch, ocr, and translate */
function firstOptions(first: ReturnType<typeof setup>): ImageRunOptions {
  return {
    doc: first.doc, targets: first.targets, paper: '2507.00150', target: 'cmn', scope: 's2', preload: DEFAULT_PRELOAD,
    fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr: first.ocr, translate: first.translate,
    isEnabled: () => true, isCurrent: () => true,
  }
}

function setup(overrides: Partial<ImageRunOptions> = {}) {
  const doc = docOf(FIGURE)
  markBlocks(extract(doc))
  const targets = collectImageTargets(doc)
  const ocr = vi.fn(async (_call: OcrCall) => ({ ok: true as const, result: { width: 476, height: 357, lines: LINES }, cached: false }))
  const translate = vi.fn(async (call: { request: { segments: { id: string; text: string }[] } }) => ({
    ok: true as const,
    result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' },
    cached: 0,
  }))
  const rendered: ImageTarget[][] = []
  const progress: { requested: number; done: number; failed: number }[] = []
  const options: ImageRunOptions = {
    doc, targets, paper: '2507.00150', target: 'cmn', scope: 's1', preload: DEFAULT_PRELOAD,
    context: { paperTitle: 'Paper' },
    fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }),
    ocr, translate,
    isEnabled: () => true,
    isCurrent: () => true,
    onRendered: ts => { rendered.push(ts) },
    onProgress: p => { progress.push({ requested: p.requested, done: p.done, failed: p.failed }) },
    ...overrides,
  }
  const run = startImageTranslation(options)
  return { doc, targets, run, ocr, translate, rendered, progress }
}

describe('startImageTranslation', () => {
  it('normal flow: fetch → OCR → merge/filter boxes → translate → overlay; includes captions as context and reports callbacks and progress', async () => {
    const { doc, targets, run, ocr, translate, rendered, progress } = setup()
    await run.translate(targets)
    const overlay = doc.querySelector(`.${IMG_CLASS}`)!
    expect(overlay).not.toBeNull()
    expect(overlay.previousElementSibling).toBe(targets[0]!.el)
    // The numeric line is filtered from three lines, leaving two labels.
    expect(Array.from(overlay.children).map(s => s.textContent)).toEqual(['译:Static charge', '译:Even sites'])
    expect(Array.from(overlay.children).map(s => (s as HTMLElement).title)).toEqual(['Static charge', 'Even sites'])
    // OCR arguments: hash, base64, mime, paper, scope
    expect(ocr).toHaveBeenCalledTimes(1)
    const ocrCall = ocr.mock.calls[0]![0]
    expect(ocrCall).toMatchObject({ image: toBase64(PNG), mime: 'image/png', paper: '2507.00150', scope: 's1' })
    expect(ocrCall.imageHash).toMatch(/^[0-9a-f]{64}$/)
    // Translation arguments: plain text, image-prefixed segment IDs, caption in sectionTitle, markup cache path, and scope
    const call = translate.mock.calls[0]![0] as { request: { segments: { id: string; text: string }[]; context?: { sectionTitle?: string; paperTitle?: string } }; cache: unknown; scope?: string }
    expect(call.request.segments).toEqual([{ id: 'F1.g1#L0', text: 'Static charge' }, { id: 'F1.g1#L1', text: 'Even sites' }])
    expect(call.request.context).toEqual({ paperTitle: 'Paper', sectionTitle: 'Figure 1. Escape velocity versus radius.' })
    expect(call.cache).toEqual({ paper: '2507.00150', renderPath: 'markup' })
    expect(call.scope).toBe('s1')
    expect(rendered).toEqual([targets])
    expect(run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(progress.at(-1)).toEqual({ requested: 1, done: 1, failed: 0 })
    expect(run.failed()).toEqual([])
  })

  it('escapes original < and & according to the placeholder protocol and decodes translated output', async () => {
    const { doc, targets, run } = setup({
      ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('ab < cd & ef', 0.1)] }, cached: false }),
      // The engine returns protocol-escaped text with a prefix, since identity translations produce no overlay.
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true, result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }),
    })
    await run.translate(targets)
    // The request contains `ab &lt; cd &amp; ef`; decoding restores the original characters in the label.
    expect(doc.querySelector(`.${IMG_CLASS} > span`)!.textContent).toBe('译:ab < cd & ef')
  })

  it('OCR results arriving after stop() do not mutate the DOM or interfere with restoration', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const { doc, targets, run } = setup({
      ocr: async () => { await held; return { ok: true, result: { width: 1, height: 1, lines: LINES }, cached: false } },
    })
    const pending = run.translate(targets)
    await Promise.resolve()
    run.stop()
    restore(doc)
    const restored = doc.documentElement.outerHTML
    release()
    await pending
    expect(doc.documentElement.outerHTML).toBe(restored)
    expect(doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
  })

  it('discards translation results when the session changes and isCurrent becomes false', async () => {
    let current = true
    const { doc, targets, run } = setup({
      isCurrent: () => current,
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => {
        current = false // The session changed before the reply arrived.
        return { ok: true, result: { segments: call.request.segments.map(s => ({ id: s.id, text: '译' })), provider: 'mock' }, cached: 0 }
      },
    })
    await run.translate(targets)
    expect(doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
  })

  it('a closed mode gate parks targets without requests; resume releases them', async () => {
    let enabled = false
    const { doc, targets, run, ocr } = setup({ isEnabled: () => enabled })
    await run.translate(targets)
    expect(ocr).not.toHaveBeenCalled()
    expect(run.progress().requested).toBe(0)
    run.resume() // Still closed: no activity.
    expect(ocr).not.toHaveBeenCalled()
    enabled = true
    run.resume()
    await vi.waitFor(() => expect(doc.querySelector(`.${IMG_CLASS}`)).not.toBeNull())
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('non-bitmap or oversized images fail without requests; failed() returns them and translate retries them', async () => {
    let mime = 'image/svg+xml'
    const { targets, run, ocr } = setup({ fetchBytes: async () => ({ bytes: PNG, mime }) })
    await run.translate(targets)
    expect(ocr).not.toHaveBeenCalled()
    expect(run.failed()).toEqual(targets)
    expect(run.progress()).toEqual({ total: 1, requested: 1, done: 0, failed: 1 })
    mime = 'image/png'
    await run.translate(run.failed())
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(run.failed()).toEqual([])
    const big = setup({ fetchBytes: async () => ({ bytes: new ArrayBuffer(MAX_IMAGE_BYTES + 1), mime: 'image/png' }) })
    await big.run.translate(big.targets)
    expect(big.ocr).not.toHaveBeenCalled()
    expect(big.run.failed()).toHaveLength(1)
  })

  it('OCR errors count as failures; images with no translatable text complete without overlays', async () => {
    const failing = setup({ ocr: async () => ({ ok: false, error: { kind: 'network', message: 'Helper disconnected' } }) })
    await failing.run.translate(failing.targets)
    expect(failing.run.failed()).toHaveLength(1)
    const empty = setup({ ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('12.5', 0.1), line('B', 0.5)] }, cached: false }) })
    await empty.run.translate(empty.targets)
    expect(empty.run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(empty.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(empty.translate).not.toHaveBeenCalled()
  })

  it('omits identity-translated labels such as units or variables; if all are unchanged, inserts no overlay', async () => {
    const identity = async (call: { request: { segments: { id: string; text: string }[] } }) => ({
      ok: true as const,
      result: { segments: call.request.segments.map(s => ({ id: s.id, text: s.text === 'Static charge' ? '静态电荷' : s.text })), provider: 'mock' },
      cached: 0,
    })
    const some = setup({ translate: identity })
    await some.run.translate(some.targets)
    const spans = Array.from(some.doc.querySelectorAll(`.${IMG_CLASS} > span`))
    expect(spans.map(s => s.textContent)).toEqual(['静态电荷']) // "Even sites" is unchanged, so no label is drawn.
    const all = setup({ ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('Vr [km s-]', 0.9)] }, cached: false }), translate: identity })
    await all.run.translate(all.targets)
    expect(all.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(all.run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(all.rendered).toEqual([])
  })

  it('configuration errors (auth/no-key) halt scheduling on the first image; later targets are not fetched or recognized, and fatal() reports the reason (Codex #89)', async () => {
    const doc = docOf(FIGURE + FIGURE.replace(/F1/g, 'F2'))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    const ocr = vi.fn(async (_call: OcrCall) => ({ ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }),
      ocr,
      translate: async () => ({ ok: false, error: { kind: 'auth', message: 'User not found.' } }),
      isEnabled: () => true, isCurrent: () => true,
    })
    await run.translate([targets[0]!])
    expect(run.fatal()).toContain('auth')
    expect(run.failed()).toEqual([targets[0]])
    await run.translate([targets[1]!]) // Stopped: the second image never reaches OCR.
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(run.progress().requested).toBe(1)
  })

  it('ordinary network failures are nonfatal and allow the next image to run', async () => {
    const doc = docOf(FIGURE + FIGURE.replace(/F1/g, 'F2'))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    const ocr = vi.fn(async (_call: OcrCall) => ({ ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr,
      translate: async () => ({ ok: false, error: { kind: 'network', message: 'offline' } }),
      isEnabled: () => true, isCurrent: () => true,
    })
    await run.translate(targets)
    expect(run.fatal()).toBeUndefined()
    expect(ocr).toHaveBeenCalledTimes(2)
    expect(run.failed()).toHaveLength(2)
  })

  it('limits concurrently processed images to maxConcurrent and queues the rest (Codex #89)', async () => {
    const doc = docOf([1, 2, 3, 4, 5].map(i => FIGURE.replace(/F1/g, `F${i}`)).join(''))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    expect(targets).toHaveLength(5)
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    const ocr = vi.fn(async (_call: OcrCall) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return { ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }
    })
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr, maxConcurrent: 2,
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true as const, result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }),
      isEnabled: () => true, isCurrent: () => true,
    })
    const all = run.translate(targets)
    const releaseAll = () => { for (const r of release.splice(0)) r() }
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(2))
    expect(inFlight).toBe(2) // Only two of five images have started; the rest are queued.
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(4))
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(5))
    releaseAll()
    await all
    expect(peak).toBe(2)
    expect(run.progress().done).toBe(5)
  })

  it('the concurrency limit applies to the whole run across separate translate batches (Codex #89)', async () => {
    const doc = docOf([1, 2, 3, 4, 5].map(i => FIGURE.replace(/F1/g, `F${i}`)).join(''))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    let inFlight = 0
    let peak = 0
    const release: (() => void)[] = []
    const ocr = vi.fn(async (_call: OcrCall) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise<void>(resolve => release.push(resolve))
      inFlight--
      return { ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }
    })
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr, maxConcurrent: 2,
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true as const, result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }),
      isEnabled: () => true, isCurrent: () => true,
    })
    const first = run.translate(targets.slice(0, 3))
    const second = run.translate(targets.slice(3)) // Second observer callback
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(2))
    expect(inFlight).toBe(2)
    const releaseAll = () => { for (const r of release.splice(0)) r() }
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(4))
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(5))
    releaseAll()
    await Promise.all([first, second])
    expect(peak).toBe(2)
    expect(run.progress().done).toBe(5)
  })

  it('fatal errors mark both concurrent and queued targets failed so progress and failed() include all of them (Codex #89)', async () => {
    const doc = docOf([1, 2, 3].map(i => FIGURE.replace(/F1/g, `F${i}`)).join(''))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    const release: (() => void)[] = []
    const ocr = vi.fn(async (_call: OcrCall) => {
      await new Promise<void>(resolve => release.push(resolve))
      return { ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }
    })
    const progress: { failed: number; fatal?: string }[] = []
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr, maxConcurrent: 2,
      translate: async () => ({ ok: false, error: { kind: 'no-key', message: 'API key not configured' } }),
      isEnabled: () => true, isCurrent: () => true,
      onProgress: p => { progress.push({ failed: p.failed, fatal: p.fatal }) },
    })
    const all = run.translate(targets) // Two in flight, one queued
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(2))
    release.shift()?.() // First image returns → translation reports no-key → fatal
    await vi.waitFor(() => expect(run.fatal()).toBeDefined())
    // The other image is still awaiting OCR, but fatal progress is already emitted so the popup need not wait (Codex #89).
    expect(progress.at(-1)).toMatchObject({ failed: 3 })
    expect(run.progress().fatal).toContain('no-key')
    release.shift()?.() // The second reply arrives after the fatal error and is discarded.
    await all
    expect(ocr).toHaveBeenCalledTimes(2) // The queued third image never started.
    expect(run.progress()).toEqual({ total: 3, requested: 3, done: 0, failed: 3, fatal: expect.stringContaining('no-key') })
    expect(run.failed()).toHaveLength(3)
  })

  it('stop() settles queued targets so their waiting translate() calls also return', async () => {
    const doc = docOf([1, 2, 3].map(i => FIGURE.replace(/F1/g, `F${i}`)).join(''))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    let release: () => void = () => {}
    const ocr = vi.fn(async (_call: OcrCall) => { await new Promise<void>(resolve => { release = resolve }); return { ok: true as const, result: { width: 1, height: 1, lines: [] }, cached: false } })
    const fetchBytes = vi.fn(async () => ({ bytes: PNG, mime: 'image/png' }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', preload: DEFAULT_PRELOAD,
      fetchBytes, ocr, maxConcurrent: 1,
      translate: async () => ({ ok: false, error: { kind: 'network', message: 'x' } }),
      isEnabled: () => true, isCurrent: () => true,
    })
    const all = run.translate(targets) // One in flight, two queued
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(1))
    run.stop()
    release() // Discard the in-flight reply after stopping; all would never resolve if the queued targets were not settled.
    const outcome = await Promise.race([all.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('hung'), 500))])
    expect(outcome).toBe('settled')
    // Queued images are not even fetched; otherwise workers would fetch each one before noticing the stopped session.
    expect(fetchBytes).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('a new run with only identity translations after a language change removes old overlays (Codex #89)', async () => {
    const first = setup()
    await first.run.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).not.toBeNull()
    // Second run on the same DOM returns unchanged translations.
    const identity = async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true as const, result: { segments: call.request.segments.map(s => ({ id: s.id, text: s.text })), provider: 'mock' }, cached: 0 })
    const rendered: ImageTarget[][] = []
    const second = startImageTranslation({ ...firstOptions(first), translate: identity, onRendered: ts => { rendered.push(ts) } })
    await second.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(second.progress().done).toBe(1)
    // Removing an old overlay notifies preparation to recompute split signatures; images with nothing to remove do not notify.
    expect(rendered).toEqual([first.targets])
    const third = startImageTranslation({ ...firstOptions(first), translate: identity, onRendered: ts => { rendered.push(ts) } })
    await third.translate(first.targets)
    expect(rendered).toHaveLength(1)
  })

  it('animated images (frames > 1) complete without overlays and remove old ones because the helper recognized only frame 0 (Codex #89)', async () => {
    const first = setup()
    await first.run.translate(first.targets)
    const animated = startImageTranslation({ ...firstOptions(first), ocr: async () => ({ ok: true, result: { width: 1, height: 1, frames: 2, lines: LINES }, cached: false }) })
    await animated.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(animated.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(first.translate).toHaveBeenCalledTimes(1) // The second run sends no translation request.
  })

  it('does not duplicate requests for targets already in flight', async () => {
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const ocr = vi.fn(async () => { await held; return { ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false } })
    const { targets, run } = setup({ ocr })
    const first = run.translate(targets)
    await Promise.resolve()
    void run.translate(targets)
    release()
    await first
    expect(ocr).toHaveBeenCalledTimes(1)
  })
})

describe('captionOf', () => {
  it('nested subfigures use their own caption instead of the outermost first caption (2410.00260 A2.F4, Codex #89)', () => {
    const doc = docOf('<figure id="A2.F4" class="ltx_figure"><div class="ltx_flex_figure">'
      + '<div class="ltx_flex_cell"><figure id="sf1" class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" id="g1" src="a.png"><figcaption class="ltx_caption">(a) Classifier confusion matrix</figcaption></figure></div>'
      + '<div class="ltx_flex_cell"><figure id="sf2" class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" id="g2" src="b.png"><figcaption class="ltx_caption">(b) Agreement between LLM judge and classifier</figcaption></figure></div>'
      + '</div><figcaption class="ltx_caption">Figure 4: Results comparison</figcaption></figure>'
      + '<figure id="F9" class="ltx_figure"><div class="ltx_flex_cell"><img class="ltx_graphics" id="g3" src="c.png"></div><figcaption class="ltx_caption">Figure 9: Outer only</figcaption></figure>')
    expect(captionOf(doc.getElementById('g2')!)).toBe('(b) Agreement between LLM judge and classifier')
    expect(captionOf(doc.getElementById('g1')!)).toBe('(a) Classifier confusion matrix')
    // Search outward when a subfigure has no caption.
    expect(captionOf(doc.getElementById('g3')!)).toBe('Figure 9: Outer only')
  })
})

describe('readImageResponse', () => {
  const stream = (chunks: number[]) => new ReadableStream<Uint8Array>({
    start(controller) {
      for (const n of chunks) controller.enqueue(new Uint8Array(n))
      controller.close()
    },
  })

  it('rejects oversized Content-Length without reading the response body', async () => {
    const res = new Response(stream([10]), { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } })
    await expect(readImageResponse(res)).rejects.toThrow(/exceeds/)
    expect(res.bodyUsed).toBe(false) // The body was not read.
  })

  it('streams responses without Content-Length and cancels immediately over the limit instead of buffering the whole body (Codex #89)', async () => {
    let cancelled = false
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        if (pulled > 10) controller.close() // Ten finite chunks total 10,000 bytes; an unbounded reader would consume them all and report success.
        else controller.enqueue(new Uint8Array(1000))
      },
      cancel() { cancelled = true },
    })
    const res = new Response(body, { headers: { 'content-type': 'image/png' } })
    await expect(readImageResponse(res, 2500)).rejects.toThrow(/exceeds/)
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThanOrEqual(4) // Stop after the third chunk (3000 > 2500), without continuing to pull.
  })

  it('assembles normal-sized responses and reads MIME type from content-type', async () => {
    const res = new Response(stream([100, 200]), { headers: { 'content-type': 'image/jpeg; charset=binary' } })
    const out = await readImageResponse(res, 1000)
    expect(out.bytes.byteLength).toBe(300)
    expect(out.mime).toBe('image/jpeg')
  })
})
