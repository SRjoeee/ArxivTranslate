import { describe, expect, it, vi } from 'vitest'
import { extract, markBlocks } from '@/core/extractor'
import { MAX_IMAGE_BYTES, captionOf, collectImageTargets, readImageResponse, startImageTranslation, toBase64, type ImageRunOptions, type ImageTarget } from '@/core/image'
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

/** 在同一份 DOM 上再开一轮：沿用第一轮的 doc / targets / fetch / ocr / translate */
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

  it('配置级错误（auth / no-key）：第一张图就停调度，之后进入的图不再取、不再识别；fatal() 给出原因（Codex 在 #89 指出）', async () => {
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
    await run.translate([targets[1]!]) // 停了：第二张连 OCR 都不做
    expect(ocr).toHaveBeenCalledTimes(1)
    expect(run.progress().requested).toBe(1)
  })

  it('普通失败（network）不算致命：下一张照常处理', async () => {
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

  it('并发有上限：同时在处理的图不超过 maxConcurrent，其余排队（Codex 在 #89 指出）', async () => {
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
    expect(inFlight).toBe(2) // 5 张只开了 2 张，其余排队
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(4))
    releaseAll()
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(5))
    releaseAll()
    await all
    expect(peak).toBe(2)
    expect(run.progress().done).toBe(5)
  })

  it('并发上限对整个 run 生效：两次 translate() 各带一批，同时在飞的仍不超过 maxConcurrent（Codex 在 #89 指出）', async () => {
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
    const second = run.translate(targets.slice(3)) // 观察器的第二次回调
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

  it('致命错误时并发中与排队的目标一并记失败，进度对得上、failed() 全给出（Codex 在 #89 指出）', async () => {
    const doc = docOf([1, 2, 3].map(i => FIGURE.replace(/F1/g, `F${i}`)).join(''))
    markBlocks(extract(doc))
    const targets = collectImageTargets(doc)
    const release: (() => void)[] = []
    const ocr = vi.fn(async (_call: OcrCall) => {
      await new Promise<void>(resolve => release.push(resolve))
      return { ok: true as const, result: { width: 1, height: 1, lines: LINES }, cached: false }
    })
    const run = startImageTranslation({
      doc, targets, paper: 'p', target: 'cmn', scope: 's', preload: DEFAULT_PRELOAD,
      fetchBytes: async () => ({ bytes: PNG, mime: 'image/png' }), ocr, maxConcurrent: 2,
      translate: async () => ({ ok: false, error: { kind: 'no-key', message: '未配置 key' } }),
      isEnabled: () => true, isCurrent: () => true,
    })
    const all = run.translate(targets) // 2 在飞、1 排队
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(2))
    release.shift()?.() // 第一张回来 → 翻译 no-key → 致命
    await vi.waitFor(() => expect(run.fatal()).toBeDefined())
    release.shift()?.() // 第二张这时才回来：会话已致命，丢弃
    await all
    expect(ocr).toHaveBeenCalledTimes(2) // 排队的第三张没开始
    expect(run.progress()).toEqual({ total: 3, requested: 3, done: 0, failed: 3, fatal: expect.stringContaining('no-key') })
    expect(run.failed()).toHaveLength(3)
  })

  it('stop() 结清排队没开始的：等它们的 translate() 也会返回', async () => {
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
    const all = run.translate(targets) // 1 在飞、2 排队
    await vi.waitFor(() => expect(ocr).toHaveBeenCalledTimes(1))
    run.stop()
    release() // 在飞的回来了：会话已停，丢弃；排队的两张要是没被结清，all 永远不返回
    const outcome = await Promise.race([all.then(() => 'settled'), new Promise(resolve => setTimeout(() => resolve('hung'), 500))])
    expect(outcome).toBe('settled')
    // 排队的两张连字节都不取：不结清的话它们会被 worker 依次拿起、先 fetch 再发现会话已停
    expect(fetchBytes).toHaveBeenCalledTimes(1)
    expect(ocr).toHaveBeenCalledTimes(1)
  })

  it('新一轮没有标签（换了目标语言后全是恒等译文）：上一轮的叠加层要清掉（Codex 在 #89 指出）', async () => {
    const first = setup()
    await first.run.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).not.toBeNull()
    // 同一份 DOM 上开第二轮：译文原样返回
    const identity = async (call: { request: { segments: { id: string; text: string }[] } }) => ({ ok: true as const, result: { segments: call.request.segments.map(s => ({ id: s.id, text: s.text })), provider: 'mock' }, cached: 0 })
    const second = startImageTranslation({ ...firstOptions(first), translate: identity })
    await second.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(second.progress().done).toBe(1)
  })

  it('动图（frames > 1）不叠译文、按完成处理，旧叠加层也清掉（helper 只识别了第 0 帧，Codex 在 #89 指出）', async () => {
    const first = setup()
    await first.run.translate(first.targets)
    const animated = startImageTranslation({ ...firstOptions(first), ocr: async () => ({ ok: true, result: { width: 1, height: 1, frames: 2, lines: LINES }, cached: false }) })
    await animated.translate(first.targets)
    expect(first.doc.querySelector(`.${IMG_CLASS}`)).toBeNull()
    expect(animated.progress()).toEqual({ total: 1, requested: 1, done: 1, failed: 0 })
    expect(first.translate).toHaveBeenCalledTimes(1) // 第二轮没发翻译
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

describe('captionOf', () => {
  it('嵌套分图取自己那层的说明，不是最外层的第一个说明（2410.00260 的 A2.F4，Codex 在 #89 指出）', () => {
    const doc = docOf('<figure id="A2.F4" class="ltx_figure"><div class="ltx_flex_figure">'
      + '<div class="ltx_flex_cell"><figure id="sf1" class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" id="g1" src="a.png"><figcaption class="ltx_caption">(a) Classifier confusion matrix</figcaption></figure></div>'
      + '<div class="ltx_flex_cell"><figure id="sf2" class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" id="g2" src="b.png"><figcaption class="ltx_caption">(b) Agreement between LLM judge and classifier</figcaption></figure></div>'
      + '</div><figcaption class="ltx_caption">Figure 4: Results comparison</figcaption></figure>'
      + '<figure id="F9" class="ltx_figure"><div class="ltx_flex_cell"><img class="ltx_graphics" id="g3" src="c.png"></div><figcaption class="ltx_caption">Figure 9: Outer only</figcaption></figure>')
    expect(captionOf(doc.getElementById('g2')!)).toBe('(b) Agreement between LLM judge and classifier')
    expect(captionOf(doc.getElementById('g1')!)).toBe('(a) Classifier confusion matrix')
    // 分图自己没有说明就往外层找
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

  it('Content-Length 超上限：不读响应体就拒', async () => {
    const res = new Response(stream([10]), { headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) } })
    await expect(readImageResponse(res)).rejects.toThrow(/超过/)
    expect(res.bodyUsed).toBe(false) // 没碰响应体
  })

  it('没有 Content-Length 的响应流式读取：超过上限立刻取消，不把整个响应读进内存（Codex 在 #89 指出）', async () => {
    let cancelled = false
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++
        if (pulled > 10) controller.close() // 有限的 10 块共 10 000 字节：不设上限的读法会把它全读完再"成功"
        else controller.enqueue(new Uint8Array(1000))
      },
      cancel() { cancelled = true },
    })
    const res = new Response(body, { headers: { 'content-type': 'image/png' } })
    await expect(readImageResponse(res, 2500)).rejects.toThrow(/超过/)
    expect(cancelled).toBe(true)
    expect(pulled).toBeLessThanOrEqual(4) // 读到第 3 块（3000 > 2500）就停，不会一直拉
  })

  it('正常大小：拼成一整块，mime 从 content-type 取', async () => {
    const res = new Response(stream([100, 200]), { headers: { 'content-type': 'image/jpeg; charset=binary' } })
    const out = await readImageResponse(res, 1000)
    expect(out.bytes.byteLength).toBe(300)
    expect(out.mime).toBe('image/jpeg')
  })
})
