import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { collectImageTargets, startImageTranslation, type ImageRunOptions } from '@/core/image'
import { IMG_CLASS } from '@/core/marks'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import type { OcrCall } from '@/shared/ocr'
import { docOf } from '../renderer/helpers'

// SVG 图（DESIGN §15.5）：不取字节、不发 OCR，直接读 contentDocument 里的字形

const PLOT = readFileSync(join(import.meta.dirname, '../fixtures/svg/2609.03768-fig_closure.svg'), 'utf8')

const FIGURE = '<figure class="ltx_figure" id="F1">'
  + '<object type="image/svg+xml" data="x/fig.svg" class="ltx_graphics" id="F1.g1" width="245" height="187"></object>'
  + '<figcaption class="ltx_caption" id="F1.cap">Figure 1. Training time.</figcaption></figure>'
const RASTER = '<figure class="ltx_figure" id="F2"><img class="ltx_graphics" src="https://arxiv.org/html/x/a.png" id="F2.g1"></figure>'

/** happy-dom gives an <object> no contentDocument, so the embedded figure is planted by hand. */
function plant(el: Element, markup: string | null) {
  Object.defineProperty(el, 'contentDocument', {
    configurable: true,
    get: () => (markup === null ? null : new DOMParser().parseFromString(markup, 'image/svg+xml')),
  })
}

function setup(markup: string | null, extra: Partial<ImageRunOptions> = {}) {
  const doc = docOf(FIGURE + RASTER)
  markBlocks(extract(doc))
  const targets = collectImageTargets(doc)
  for (const t of targets) if (t.kind === 'svg') plant(t.el, markup)
  const ocr = vi.fn(async (_call: OcrCall) => ({ ok: true as const, result: { width: 1, height: 1, lines: [] }, cached: false }))
  const translate = vi.fn(async (call: { request: { segments: { id: string; text: string }[] } }) => ({
    ok: true as const,
    result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' },
    cached: 0,
  }))
  const options: ImageRunOptions = {
    doc, targets: targets.filter(t => t.kind === 'svg'), paper: '2609.03768', target: 'cmn', scope: 's1',
    renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
    fetchBytes: async () => { throw new Error('SVG 路径不该取字节') },
    ocr, translate, isEnabled: () => true, isCurrent: () => true,
    ...extra,
  }
  return { doc, targets, run: startImageTranslation(options), ocr, translate }
}

describe('SVG figures in the image pipeline (§15.5)', () => {
  it('collects <object type="image/svg+xml"> alongside bitmaps, and tells them apart', () => {
    const doc = docOf(FIGURE + RASTER)
    markBlocks(extract(doc))
    expect(collectImageTargets(doc).map(t => [t.id, t.kind])).toEqual([['F1.g1', 'svg'], ['F2.g1', 'raster']])
  })

  it('reads the embedded figure instead of fetching and recognising it', async () => {
    const { targets, run, ocr, translate, doc } = setup(PLOT)
    await run.translate(targets.filter(t => t.kind === 'svg'))

    // Neither the network nor the helper is touched — fetchBytes throws if it is
    expect(ocr).not.toHaveBeenCalled()
    const sent = translate.mock.calls[0]![0].request.segments.map(s => s.text)
    expect(sent).toContain('wall time per epoch [ms]')
    expect(sent).toContain('closure')
    const overlay = doc.querySelector(`.${IMG_CLASS}`)
    expect(overlay?.previousElementSibling?.tagName.toLowerCase()).toBe('object')
    expect(overlay?.querySelectorAll('span').length).toBe(sent.length)
  })

  it('rotates the label a rotated run came from', async () => {
    const { targets, run, doc } = setup(PLOT)
    await run.translate(targets.filter(t => t.kind === 'svg'))
    const spans = Array.from(doc.querySelectorAll(`.${IMG_CLASS} span`))
    const vertical = spans.filter(s => (s.getAttribute('style') ?? '').includes('rotate('))
    expect(vertical.map(s => s.getAttribute('title'))).toEqual(['wall time per epoch [ms]'])
  })

  it('fails the figure rather than the run when the embedded document is not there', async () => {
    // Measured as never happening on real papers (RESEARCH §6.11), so this is the graceful
    // degradation path, not a normal one
    const { targets, run, translate } = setup(null)
    await run.translate(targets.filter(t => t.kind === 'svg'))
    expect(translate).not.toHaveBeenCalled()
    expect(run.failed().map(t => t.id)).toEqual(['F1.g1'])
    expect(run.fatal()).toBeUndefined()
  })

  it('waits for a figure that has not loaded yet instead of failing it', async () => {
    // The viewport scheduler is one-shot: a target failed here is never handed back when the
    // object's `load` finally fires, so it stays untranslated until a manual retry (Codex on #134)
    const doc = docOf(FIGURE)
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    const el = targets[0]!.el
    let markup: string | null = null
    plant(el, null)
    Object.defineProperty(el, 'contentDocument', {
      configurable: true,
      get: () => (markup === null ? null : new DOMParser().parseFromString(markup, 'image/svg+xml')),
    })
    const translate = vi.fn(async (call: { request: { segments: { id: string; text: string }[] } }) => ({
      ok: true as const,
      result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' },
      cached: 0,
    }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes: async () => { throw new Error('不该取字节') },
      ocr: vi.fn(async () => ({ ok: true as const, result: { width: 1, height: 1, lines: [] }, cached: false })),
      translate, isEnabled: () => true, isCurrent: () => true,
    })
    const pending = run.translate(targets)
    // 加载完成之后才有内容，然后派 load 事件
    markup = PLOT
    el.dispatchEvent(new Event('load'))
    await pending

    expect(run.failed()).toEqual([])
    expect(translate.mock.calls[0]![0].request.segments.map(s => s.text)).toContain('closure')
  })

  it('parks and resumes per target, so SVG runs while bitmaps wait for the helper', async () => {
    // The helper decides bitmaps only. Blocking the whole run on its handshake delays SVG figures
    // behind something they do not need — up to the 30s timeout when an installed helper hangs —
    // and a rejected handshake skipped them entirely (Codex on #134)
    const doc = docOf(FIGURE + RASTER)
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    for (const t of targets) if (t.kind === 'svg') plant(t.el, PLOT)
    let helperReady = false
    const ocr = vi.fn(async (_c: OcrCall) => ({ ok: true as const, result: { width: 1, height: 1, lines: [] }, cached: false }))
    const translate = vi.fn(async (call: { request: { segments: { id: string; text: string }[] } }) => ({
      ok: true as const,
      result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' },
      cached: 0,
    }))
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', renderPath: 'tags' as const, preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: new Uint8Array([1]).buffer, mime: 'image/png' }),
      ocr, translate,
      isEnabled: t => t.kind === 'svg' || helperReady,
      isCurrent: () => true,
    })

    await run.translate(targets)
    // The SVG figure went; the bitmap is parked, so the helper was never called
    expect(translate).toHaveBeenCalledTimes(1)
    expect(ocr).not.toHaveBeenCalled()

    helperReady = true
    run.resume()
    // `resume` 交给 `translate` 是不等待的，满载时一个 tick 不够
    for (let i = 0; i < 50 && ocr.mock.calls.length === 0; i++) await new Promise(r => setTimeout(r, 5))
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('skips code drawn as a figure', async () => {
    const listing = readFileSync(join(import.meta.dirname, '../fixtures/svg/2608.29808-bounter-case.svg'), 'utf8')
    const { targets, run, translate } = setup(listing)
    await run.translate(targets.filter(t => t.kind === 'svg'))
    const sent = translate.mock.calls[0]?.[0].request.segments.map(s => s.text) ?? []
    expect(sent.some(t => t.includes('PyErr_SetString'))).toBe(false)
    // The prose annotations on the same figure still go
    expect(sent).toContain('No sanitization forwidth')
  })
})
