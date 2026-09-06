import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { MAX_IMAGE_BYTES, collectImageTargets, startImageTranslation, toBase64, type ImageRunOptions, type ImageTarget } from '@/core/image'
import { IMG_CLASS } from '@/core/marks'
import { restore } from '@/core/renderer'
import { DEFAULT_PRELOAD } from '@/core/scheduler/lazy'
import type { OcrCall, OcrLine } from '@/shared/ocr'
import { docOf } from '../renderer/helpers'

// 图片翻译的小管线（DESIGN §15）。happy-dom 没有 IntersectionObserver，目标靠 translate 手动交出去

const FIGURE = '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="https://arxiv.org/html/x/a.png" id="F1.g1" width="476" height="357">'
  + '<figcaption class="ltx_caption" id="F1.cap">Figure 1. Escape velocity versus radius.</figcaption></figure>'
const line = (text: string, y: number): OcrLine => ({ text, conf: 1, quad: [[0.1, y], [0.3, y], [0.3, y + 0.03], [0.1, y + 0.03]] })
const LINES = [line('Static charge', 0.1), line('Even sites', 0.5), line('12.5', 0.9)]
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).buffer

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
  it('正常路径：取图 → OCR → 合框过滤 → 翻译 → 叠加层；同批带图注做上下文；回调与进度', async () => {
    const { doc, targets, run, ocr, translate, rendered, progress } = setup()
    await run.translate(targets)
    const overlay = doc.querySelector(`.${IMG_CLASS}`)!
    expect(overlay).not.toBeNull()
    expect(overlay.previousElementSibling).toBe(targets[0]!.el)
    // 3 行里数字被过滤，2 个标签
    expect(Array.from(overlay.children).map(s => s.textContent)).toEqual(['译:Static charge', '译:Even sites'])
    expect(Array.from(overlay.children).map(s => (s as HTMLElement).title)).toEqual(['Static charge', 'Even sites'])
    // OCR 调用：hash、base64、mime、paper、scope
    expect(ocr).toHaveBeenCalledTimes(1)
    const ocrCall = ocr.mock.calls[0]![0]
    expect(ocrCall).toMatchObject({ image: toBase64(PNG), mime: 'image/png', paper: '2507.00150', scope: 's1' })
    expect(ocrCall.imageHash).toMatch(/^[0-9a-f]{64}$/)
    // 翻译调用：纯文本路径，段 id 带图的 id，图注进 sectionTitle，缓存按 markup，带 scope
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

  it('原文里的 < 与 & 按占位符协议转义、译文解码', async () => {
    const { doc, targets, run } = setup({
      ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('ab < cd & ef', 0.1)] }, cached: false }),
      // 引擎照占位符协议返回转义过的文本，前面加个前缀（恒等译文不画）
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true, result: { segments: call.request.segments.map(s => ({ id: s.id, text: `译:${s.text}` })), provider: 'mock' }, cached: 0 }),
    })
    await run.translate(targets)
    // 发出去的是 `ab &lt; cd &amp; ef`，回来解码后标签里是原样的字符
    expect(doc.querySelector(`.${IMG_CLASS} > span`)!.textContent).toBe('译:ab < cd & ef')
  })

  it('stop() 之后到达的 OCR 结果不落 DOM：恢复原文与晚到的识别互不干扰', async () => {
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

  it('会话换了（isCurrent 为假）：翻译结果到达也丢弃', async () => {
    let current = true
    const { doc, targets, run } = setup({
      isCurrent: () => current,
      translate: async (call: { request: { segments: { id: string; text: string }[] } }) => {
        current = false // 回应到达前会话已换
        return { ok: true, result: { segments: call.request.segments.map(s => ({ id: s.id, text: '译' })), provider: 'mock' }, cached: 0 }
      },
    })
    await run.translate(targets)
    expect(doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
  })

  it('模式闸关着：进入的目标停着不请求；resume 时放出去', async () => {
    let enabled = false
    const { doc, targets, run, ocr } = setup({ isEnabled: () => enabled })
    await run.translate(targets)
    expect(ocr).not.toHaveBeenCalled()
    expect(run.progress().requested).toBe(0)
    run.resume() // 还关着：没动静
    expect(ocr).not.toHaveBeenCalled()
    enabled = true
    run.resume()
    await vi.waitFor(() => expect(doc.querySelector(`.${IMG_CLASS}`)).not.toBeNull())
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('不是位图 / 超过上限：记失败、零请求；failed() 给出来，重试走 translate', async () => {
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

  it('OCR 出错记失败；图里没有可翻的字算完成、不插叠加层', async () => {
    const failing = setup({ ocr: async () => ({ ok: false, error: { kind: 'network', message: 'helper 断开' } }) })
    await failing.run.translate(failing.targets)
    expect(failing.run.failed()).toHaveLength(1)
    const empty = setup({ ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('12.5', 0.1), line('B', 0.5)] }, cached: false }) })
    await empty.run.translate(empty.targets)
    expect(empty.run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(empty.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(empty.translate).not.toHaveBeenCalled()
  })

  it('译文与原文相同的标签不画（单位、变量名、引擎原样返回）；全都相同就不插叠加层', async () => {
    const identity = async (call: { request: { segments: { id: string; text: string }[] } }) => ({
      ok: true as const,
      result: { segments: call.request.segments.map(s => ({ id: s.id, text: s.text === 'Static charge' ? '静态电荷' : s.text })), provider: 'mock' },
      cached: 0,
    })
    const some = setup({ translate: identity })
    await some.run.translate(some.targets)
    const spans = Array.from(some.doc.querySelectorAll(`.${IMG_CLASS} > span`))
    expect(spans.map(s => s.textContent)).toEqual(['静态电荷']) // "Even sites" 原样返回，不画
    const all = setup({ ocr: async () => ({ ok: true, result: { width: 1, height: 1, lines: [line('Vr [km s-]', 0.9)] }, cached: false }), translate: identity })
    await all.run.translate(all.targets)
    expect(all.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(all.run.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(all.rendered).toEqual([])
  })

  it('已在请求中的目标不重复请求', async () => {
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
