import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { MAX_IMAGE_BYTES, captionOf, collectImageTargets, readImageResponse, startImageTranslation, toBase64, type ImageRunOptions, type ImageTarget } from '@/core/image'
import { IMG_CLASS } from '@/core/marks'
import { restore } from '@/core/renderer/page'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import type { OcrCall, OcrLine } from '@/shared/ocr'
import { docOf } from '../renderer/helpers'

// The small image-translation pipeline (DESIGN §15). happy-dom has no IntersectionObserver, so targets are handed over by translate by hand

const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="https://arxiv.org/html/x/a.png" id="F1.g1" width="476" height="357">'
  + '<figcaption class="ltx_caption" id="F1.cap">Figure 1. Escape velocity versus radius.</figcaption></figure>'
const line = (text: string, y: number): OcrLine => ({ text, conf: 1, quad: [[0.1, y], [0.3, y], [0.3, y + 0.03], [0.1, y + 0.03]] })
const LINES = [line('Static charge', 0.1), line('Even sites', 0.5), line('12.5', 0.9)]
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer

/** Open another round on the same DOM: reusing the first round's doc / targets / fetch / ocr / translate */
function firstOptions(first: ReturnType<typeof setup>): ImageRunOptions {
  return {
    doc: first.doc, targets: first.targets, paper: '2507.00150', target: 'cmn', scope: 's2', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
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
    doc, targets, paper: '2507.00150', target: 'cmn', scope: 's1', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
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
  it('the normal path: fetch → OCR → merge and filter boxes → translate → overlay; the caption in the same batch as context; callbacks and progress', async () => {
    const { doc, targets, run, ocr, translate, rendered, progress } = setup()
    await run.translate(targets)
    const overlay = doc.querySelector(`.${IMG_CLASS}`)!
    expect(overlay).not.toBeNull()
    expect(overlay.previousElementSibling).toBe(targets[0]!.el)
    // Of the 3 lines the number is filtered out, 2 labels
    expect(Array.from(overlay.children).map(s => s.textContent)).toEqual(['译:Static charge', '译:Even sites'])
    expect(Array.from(overlay.children).map(s => (s as HTMLElement).title)).toEqual(['Static charge', 'Even sites'])
    // The OCR call: hash, base64, mime, paper, scope
    expect(ocr).toHaveBeenCalledTimes(1)
    const ocrCall = ocr.mock.calls[0]![0]
    expect(ocrCall).toMatchObject({ image: toBase64(PNG), mime: 'image/png', paper: '2507.00150', scope: 's1' })
    expect(ocrCall.imageHash).toMatch(/^[0-9a-f]{64}$/)
    // The translate call: the plain-text path, segment ids carrying the image's id, the caption in sectionTitle, cache by tags, with scope
    const call = translate.mock.calls[0]![0] as { request: { segments: { id: string; text: string }[]; context?: { sectionTitle?: string; paperTitle?: string } }; cache: unknown; scope?: string }
    expect(call.request.segments).toEqual([{ id: 'F1.g1#L0', text: 'Static charge' }, { id: 'F1.g1#L1', text: 'Even sites' }])
    expect(call.request.context).toEqual({ paperTitle: 'Paper', sectionTitle: 'Figure 1. Escape velocity versus radius.' })
    expect(call.cache).toEqual({ paper: '2507.00150', renderPath: 'tags' })
    expect(call.scope).toBe('s1')
    expect(rendered).toEqual([targets])
    expect(run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(progress.at(-1)).toEqual({ requested: 1, done: 1, failed: 0 })
    expect(run.failed()).toEqual([])
  })

  it('< and & in the source are escaped by the placeholder protocol, the translation decoded', async () => {
    const { doc, targets, run } = setup({
      ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('ab < cd & ef', 0.1)] }, cached: false }),
      // The engine returns the escaped text by the placeholder protocol, with a prefix in front (an identity translation is not drawn)
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true, result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }),
    })
    await run.translate(targets)
    // Sent out is `ab &lt; cd &amp; ef`; decoded on return, the label holds the characters as they were
    expect(doc.querySelector(`.${IMG_CLASS} > span`)!.textContent).toBe('译:ab < cd & ef')
  })

  it('an OCR result arriving after stop() does not land in the DOM: restoring the original and a late recognition do not interfere', async () => {
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

  it('the session changed (isCurrent false): a translation result arriving is dropped too', async () => {
    let current = true
    const { doc, targets, run } = setup({
      isCurrent: () => current,
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => {
        current = false // the session changed before the reply arrived
        return { ok: true, result: { segments: call.request.segments.map(s => ({ id: s.id, text: '译' })), provider: 'mock' }, cached: 0 }
      },
    })
    await run.translate(targets)
    expect(doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
  })

  it('the mode gate closed: targets entering wait without a request; released on resume', async () => {
    let enabled = false
    const { doc, targets, run, ocr } = setup({ isEnabled: () => enabled })
    await run.translate(targets)
    expect(ocr).not.toHaveBeenCalled()
    expect(run.progress().requested).toBe(0)
    run.resume() // still closed: nothing happens
    expect(ocr).not.toHaveBeenCalled()
    enabled = true
    run.resume()
    await vi.waitFor(() => expect(doc.querySelector(`.${IMG_CLASS}`)).not.toBeNull())
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('not a bitmap / over the cap: recorded failed, zero requests; failed() lists it, retry goes through translate', async () => {
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

  it('an OCR error is recorded failed; an image without translatable text counts as done and gets no overlay', async () => {
    const failing = setup({ ocr: async () => ({ ok: false, error: { kind: 'network', message: 'helper disconnected', isolatable: false } }) })
    await failing.run.translate(failing.targets)
    expect(failing.run.failed()).toHaveLength(1)
    const empty = setup({ ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('12.5', 0.1), line('B', 0.5)] }, cached: false }) })
    await empty.run.translate(empty.targets)
    expect(empty.run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(empty.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(empty.translate).not.toHaveBeenCalled()
  })

  it('labels whose translation equals the source are not drawn (units, variable names, the engine returning as it was); with all equal no overlay is inserted', async () => {
    const identity = async (call: { request: { segments: { id: string; text: string }[] } }) => ({
      ok: true as const,
      result: { segments: call.request.segments.map(s => ({ id: s.id, text: s.text === 'Static charge' ? '静态电荷' : s.text })), provider: 'mock' },
      cached: 0,
    })
    const some = setup({ translate: identity })
    await some.run.translate(some.targets)
    const spans = Array.from(some.doc.querySelectorAll(`.${IMG_CLASS} > span`))
    expect(spans.map(s => s.textContent)).toEqual(['静态电荷']) // "Even sites" came back as it was and is not drawn
    const all = setup({ ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('Vr [km s-]', 0.9)] }, cached: false }), translate: identity })
    await all.run.translate(all.targets)
    expect(all.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(all.run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(all.rendered).toEqual([])
  })

  it('a configuration-level error (auth / no-key): scheduling stops at the first image, images entering afterwards are neither fetched nor recognised; fatal() gives the reason (Codex on #89)', async () => {
    const doc = docOf(FIGURE + FIGURE.replace(/F1/g, 'F2'))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    const ocr = vi.fn(async (_call: OcrCall) => ({ ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }),
      ocr,
      translate: async () => ({ ok: false, error: { kind: 'auth', message: 'User not found.', isolatable: false } }),
      isEnabled: () => true, isCurrent: () => true,
    })
    await run.translate([targets[0]!])
    expect(run.fatal()).toContain('auth')
    expect(run.failed()).toEqual([targets[0]])
    await run.translate([targets[1]!]) // stopped: the second image gets no OCR at all
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(run.progress().requested).toBe(1)
  })

  it('an ordinary failure (network) is not fatal: the next image is processed as usual', async () => {
    const doc = docOf(FIGURE + FIGURE.replace(/F1/g, 'F2'))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    const ocr = vi.fn(async (_call: OcrCall) => ({ ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr,
      translate: async () => ({ ok: false, error: { kind: 'network', message: 'offline', isolatable: false } }),
      isEnabled: () => true, isCurrent: () => true,
    })
    await run.translate(targets)
    expect(run.fatal()).toBeUndefined()
    expect(ocr).toHaveBeenCalledTimes(2)
    expect(run.failed()).toHaveLength(2)
  })

  // Codex on #163: one image's labels may span several batches (an inline TikZ with hundreds of nodes),
  // and when one batch fails the labels another batch had translated come back with the failure; the image must not stay empty
  it('partial success: the labels translated are drawn first, while the image is still recorded failed', async () => {
    const { doc, targets, run } = setup({
      // The first label came out translated, the rest did not
      translate: async call => ({
        ok: false as const,
        error: { kind: 'network' as const, message: 'offline', isolatable: false },
        partial: call.request.segments.slice(0, 1).map(s => ({ id: s.id, text: `译:${s.text}` })),
      }),
    })
    await run.translate(targets)
    expect(run.failed()).toHaveLength(1)
    // The overlay is drawn, with only the one label that was translated
    const overlay = doc.querySelector('.axt-img')
    expect(overlay).not.toBeNull()
    expect(overlay!.querySelectorAll('span')).toHaveLength(1)
  })

  // Fifth round: a fatal failure stops the whole scheduling on the spot, and this image gets no second chance this round —
  // the labels an earlier step of the fallback chain translated come back with the last step's auth failure, and only drawn before the fatal branch do they get drawn at all
  it('a fatal failure draws first too: labels translated along the fallback chain must not be lost with the auth failure', async () => {
    const { doc, targets, run } = setup({
      translate: async call => ({
        ok: false as const,
        error: { kind: 'auth' as const, message: 'User not found.', isolatable: false },
        partial: call.request.segments.slice(0, 1).map(s => ({ id: s.id, text: `译:${s.text}` })),
      }),
    })
    await run.translate(targets)
    expect(run.fatal()).toBeDefined()
    expect(doc.querySelector('.axt-img')?.querySelectorAll('span')).toHaveLength(1)
  })

  it('with not one label translated no overlay is drawn', async () => {
    const { doc, targets, run } = setup({
      translate: async () => ({ ok: false as const, error: { kind: 'network' as const, message: 'offline', isolatable: false } }),
    })
    await run.translate(targets)
    expect(run.failed()).toHaveLength(1)
    expect(doc.querySelector('.axt-img')).toBeNull()
  })

  it('concurrency is capped: no more than maxConcurrent images processed at once, the rest queued (Codex on #89)', async () => {
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
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr, maxConcurrent: 2,
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true as const, result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }),
      isEnabled: () => true, isCurrent: () => true,
    })
    const all = run.translate(targets)
    const releaseAll = () => { for (const r of release.splice(0)) r() }
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(2))
    expect(inFlight).toBe(2) // of 5 images only 2 started, the rest queued
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(4))
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(5))
    releaseAll()
    await all
    expect(peak).toBe(2)
    expect(run.progress().done).toBe(5)
  })

  it('the concurrency cap applies to the whole run: two translate() calls with a batch each, still no more than maxConcurrent in flight (Codex on #89)', async () => {
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
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr, maxConcurrent: 2,
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true as const, result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }),
      isEnabled: () => true, isCurrent: () => true,
    })
    const first = run.translate(targets.slice(0, 3))
    const second = run.translate(targets.slice(3)) // the observer's second callback
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

  it('on a fatal error the targets in flight and queued are all recorded failed, the progress adds up, failed() lists them all (Codex on #89)', async () => {
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
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr, maxConcurrent: 2,
      translate: async () => ({ ok: false, error: { kind: 'no-key', message: 'no key configured', isolatable: false } }),
      isEnabled: () => true, isCurrent: () => true,
      onProgress: p => { progress.push({ failed: p.failed, fatal: p.fatal }) },
    })
    const all = run.translate(targets) // 2 in flight, 1 queued
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(2))
    release.shift()?.() // the first comes back → translate no-key → fatal
    await vi.waitFor(() => expect(run.fatal()).toBeDefined())
    // The other is still waiting for OCR: the progress with fatal has gone out already, and the popup need not wait for it (Codex on #89)
    expect(progress.at(-1)).toMatchObject({ failed: 3 })
    expect(run.progress().fatal).toContain('no-key')
    release.shift()?.() // the second comes back only now: the session is fatal, dropped
    await all
    expect(ocr).toHaveBeenCalledTimes(2) // the queued third never started
    expect(run.progress()).toEqual({ total: 3, requested: 3, done: 0, failed: 3, fatal: expect.stringContaining('no-key') })
    expect(run.failed()).toHaveLength(3)
  })

  it('stop() settles the queued ones that never started: the translate() waiting for them returns too', async () => {
    const doc = docOf([1, 2, 3].map(i => FIGURE.replace(/F1/g, `F${i}`)).join(''))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    let release: () => void = () => {}
    const ocr = vi.fn(async (_call: OcrCall) => { await new Promise<void>(resolve => { release = resolve }); return { ok: true as const, result: { width: 1, height: 1, lines: [] }, cached: false } })
    const fetchBytes = vi.fn(async () => ({ bytes: PNG, mime: 'image/png' }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes, ocr, maxConcurrent: 1,
      translate: async () => ({ ok: false, error: { kind: 'network', message: 'x', isolatable: false } }),
      isEnabled: () => true, isCurrent: () => true,
    })
    const all = run.translate(targets) // 1 in flight, 2 queued
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(1))
    run.stop()
    release() // the one in flight came back: the session is stopped, dropped; unless the two queued are settled, all never returns
    const outcome = await Promise.race([all.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('hung'), 500))])
    expect(outcome).toBe('settled')
    // The two queued fetch not one byte: unsettled, the worker would pick them up in turn, fetch first and only then find the session stopped
    expect(fetchBytes).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('a new round with no labels (all identity translations after a change of target language): the previous round\'s overlay has to go (Codex on #89)', async () => {
    const first = setup()
    await first.run.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).not.toBeNull()
    // A second round on the same DOM: the translation comes back as it was
    const identity = async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true as const, result: { segments: call.request.segments.map(s => ({ id: s.id, text: s.text })), provider: 'mock' }, cached: 0 })
    const rendered: ImageTarget[][] = []
    const second = startImageTranslation({ ...firstOptions(first), translate: identity, onRendered: ts => { rendered.push(ts) } })
    await second.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(second.progress().done).toBe(1)
    // The old overlay was removed → the tidy layer is told to recompute the split signature; an image with nothing to remove is not reported
    expect(rendered).toEqual([first.targets])
    const third = startImageTranslation({ ...firstOptions(first), translate: identity, onRendered: ts => { rendered.push(ts) } })
    await third.translate(first.targets)
    expect(rendered).toHaveLength(1)
  })

  it('an animation (frames > 1) gets no translation overlay and is treated as done, the old overlay removed too (the helper recognised frame 0 only, Codex on #89)', async () => {
    const first = setup()
    await first.run.translate(first.targets)
    const animated = startImageTranslation({ ...firstOptions(first), ocr: async () => ({ ok: true, result: { width: 1, height: 1, frames: 2, lines: LINES }, cached: false }) })
    await animated.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(animated.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(first.translate).toHaveBeenCalledTimes(1) // the second round sent no translation
  })

  it('a target already in flight is not requested again', async () => {
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
  it('a nested subfigure takes the caption of its own level, not the outermost\'s first caption (A2.F4 of 2410.00260, Codex on #89)', () => {
    const doc = docOf('<figure id="A2.F4" class="ltx_figure"><div class="ltx_flex_figure">'
      + '<div class="ltx_flex_cell"><figure id="sf1" class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" id="g1" src="a.png"><figcaption class="ltx_caption">(a) Classifier confusion matrix</figcaption></figure></div>'
      + '<div class="ltx_flex_cell"><figure id="sf2" class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" id="g2" src="b.png"><figcaption class="ltx_caption">(b) Agreement between LLM judge and classifier</figcaption></figure></div>'
      + '</div><figcaption class="ltx_caption">Figure 4: Results comparison</figcaption></figure>'
      + '<figure id="F9" class="ltx_figure"><div class="ltx_flex_cell"><img class="ltx_graphics" id="g3" src="c.png"></div><figcaption class="ltx_caption">Figure 9: Outer only</figcaption></figure>')
    expect(captionOf(doc.getElementById('g2')!)).toBe('(b) Agreement between LLM judge and classifier')
    expect(captionOf(doc.getElementById('g1')!)).toBe('(a) Classifier confusion matrix')
    // A subfigure without a caption of its own looks outward
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

  it('Content-Length over the cap: refused without reading the body', async () => {
    const res = new Response(stream([10]), { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } })
    await expect(readImageResponse(res)).rejects.toThrow(/over/)
    expect(res.bodyUsed).toBe(false) // the body was not touched
  })

  it('a response without Content-Length is read as a stream: over the cap it is cancelled at once, not read whole into memory (Codex on #89)', async () => {
    let cancelled = false
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        if (pulled > 10) controller.close() // finite: 10 chunks of 10 000 bytes in all; an uncapped read would read them all and then “succeed”
        else controller.enqueue(new Uint8Array(1000))
      },
      cancel() { cancelled = true },
    })
    const res = new Response(body, { headers: { 'content-type': 'image/png' } })
    await expect(readImageResponse(res, 2500)).rejects.toThrow(/over/)
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThanOrEqual(4) // stops at chunk 3 (3000 > 2500) and does not keep pulling
  })

  it('a normal size: assembled into one block, the mime taken from content-type', async () => {
    const res = new Response(stream([100, 200]), { headers: { 'content-type': 'image/jpeg; charset=binary' } })
    const out = await readImageResponse(res, 1000)
    expect(out.bytes.byteLength).toBe(300)
    expect(out.mime).toBe('image/jpeg')
  })
})
