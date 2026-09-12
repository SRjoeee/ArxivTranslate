// 图片翻译的小管线（DESIGN §15）：位图不进 Block 联合（七处穷举 switch、renderPending 会按原标签造出
// <img class="axt-pending">），自己一条流水线，只复用视口调度器、会话 id 与纯文本翻译路径。
//
// 每张图：取字节（同源、走 HTTP 缓存）→ SHA-256 → background 做 OCR（按 imageHash 缓存）→ 行合成框、
// 过滤数字与单字母 → 框里的原文按 translateTitle 的纯文本路径送现有 provider（同一批带图注做上下文）→
// 插叠加层。**每个 await 之后重查会话**（与文字管线同一模式）：恢复原文 / 重开之后到达的结果一律丢弃。
// 等待 / 失败没有 DOM 节点（§15.2）：失败记在这里，popup 显示、重试按钮管。
import { type RenderPath, wireFormatOf } from '@/cache/key'
import { ID_ATTR } from '@/core/extractor'
import { escapeText, unescapeText } from '@/core/protector/text'
import { type ImageLabel, type ImageTarget, clearImage, renderImage } from '@/core/renderer/image'
import { DOCUMENT_ROOT, FIGURE_SELECTORS } from '@/core/rules/latexml'
import { INJECTED_SELECTOR } from '@/core/marks'
import { createRunLedger } from '@/core/run/ledger'
import type { PreloadOptions } from '@/core/scheduler/lazy'
import { foreignLinesOf, linesOf, looksLikeCode, pictureTexts } from '@/core/svg'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import { isPermanentErrorKind, type TranslateContext } from '@/providers/types'
import { sha256Hex } from '@/shared/digest'
import type { ImageProgress, OcrCall, OcrLine, OcrMessageResponse } from '@/shared/ocr'
import { isTranslatable, linesToBoxes, type Box } from './boxes'
import { squash } from '@/core/text'

export type { ImageTarget } from '@/core/renderer/image'

/** 位图上限：arXiv 的图通常几百 KB，6 MB 已经很宽；再大的 base64 过消息通道不值得 */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** helper 能解的位图类型；SVG 与未知类型不送（§15.1：SVG 整体跳过） */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|tiff)$/i
/** 图注做上下文时的长度上限：进 prompt 也进缓存键 */
const CAPTION_MAX_CHARS = 300
/** 同时在处理的图：取字节、base64、消息载荷都占内存，helper 又是顺序的，多开只是把 6 MB 一张的图囤在那里 */
const MAX_CONCURRENT = 2
/** `<object>` 还在加载时等它多久（§15.5）。等不到就跳过这一张，不拖住队列 */
const SVG_LOAD_TIMEOUT_MS = 5000

export interface ImageBytes {
  bytes: ArrayBuffer
  mime: string
}

export interface ImageRunOptions {
  doc: Document
  targets: ImageTarget[]
  paper: string
  /** 目标语言（ISO 639-3，与文字管线相同） */
  target: string
  scope: string
  /** 会话协商出的渲染路径（§8.5）：OCR 行也走同一条线，转义与缓存键必须跟着它 */
  renderPath: RenderPath
  preload: PreloadOptions
  context?: TranslateContext
  ocr: (call: OcrCall) => Promise<OcrMessageResponse>
  translate: (call: TranslateCall) => Promise<TranslateMessageResponse>
  /** 当前生效的模式在用户勾选的集合里；不在时进入视口的图先停着，resume 时再翻 */
  /**
   * 这个目标现在能不能翻。**按目标问，不是一个全局开关**：显示模式对两种图一样，
   * 但位图要等本机 helper、SVG 图不用（§15.5）。答 false 的目标停在 parked 里，
   * 条件变了调 `resume()` 放出来
   */
  isEnabled: (target: ImageTarget) => boolean
  /** 会话还是当前这一个（恢复原文 / 重开之后为假） */
  isCurrent: () => boolean
  /** 测试注入：并发上限 */
  maxConcurrent?: number
  /** 测试注入：取字节 */
  fetchBytes?: (url: string) => Promise<ImageBytes>
  onProgress?: (progress: ImageProgress) => void
  onRendered?: (targets: ImageTarget[]) => void
}

export interface ImageRun {
  /** 配置级错误（auth / no-key）之后停下的原因；停下后 translate / resume 都不再动 */
  fatal(): string | undefined
  /** 手动把目标交出去翻（重试）；已在请求中的不重复 */
  translate(targets: ImageTarget[]): Promise<void>
  /** 模式闸打开了：把停着的目标放出去 */
  resume(): void
  stop(): void
  failed(): ImageTarget[]
  progress(): ImageProgress
}

/** 这张内联图里有没有值得翻的标签：纯公式的 TikZ 图（语料里的多数）不必进调度 */
function hasPictureText(picture: Element): boolean {
  return pictureTexts(picture).some(isTranslatable)
}

/**
 * 翻译根内的位图，不含块内的（块内的图会随占位符克隆进译文、only 模式下原块整个隐藏，叠加层无处可挂；
 * 与拆图的"游离媒体"同一判定）与我们自己节点里的。要在块标记写完之后调用
 */
export function collectImageTargets(doc: Document): ImageTarget[] {
  const root = doc.querySelector(DOCUMENT_ROOT)
  if (!root) return []
  const used = new Set<string>()
  let n = 0
  const targets: ImageTarget[] = []
  for (const el of Array.from(root.querySelectorAll(`${FIGURE_SELECTORS.graphics}, ${FIGURE_SELECTORS.picture}`))) {
    if (el.closest(`[${ID_ATTR}]`) || el.closest(INJECTED_SELECTOR)) continue
    const tag = el.tagName.toLowerCase()
    // 内联 TikZ 图（§15.6）：只收**带词的**那些。语料里 170 张里多数画的是公式，收下来只会给调度器
    // 添一堆最后什么都没有的目标；判定读的是文字，不读几何
    if (tag === 'svg' && (el.parentElement?.closest(FIGURE_SELECTORS.picture) || !hasPictureText(el))) continue
    let id = el.id || `axt-img-${++n}`
    while (used.has(id)) id = `${id}-${++n}`
    used.add(id)
    targets.push({ id, el, kind: tag === 'object' ? 'svg' : tag === 'svg' ? 'picture' : 'raster' })
  }
  return targets
}

/**
 * 按上限读响应体：Content-Length 可信就先看它，没有或不准的经流式读取、超过上限立刻取消——
 * `arrayBuffer()` 会把整个响应先分配出来再判大小，上限就形同虚设（Codex 在 #89 指出）
 */
export async function readImageResponse(res: Response, max = MAX_IMAGE_BYTES): Promise<ImageBytes> {
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  const tooBig = () => new Error(`图片超过 ${max / 1024 / 1024} MB`)
  const declared = Number(res.headers.get('content-length') ?? Number.NaN)
  if (Number.isFinite(declared) && declared > max) throw tooBig()
  if (!res.body) {
    const bytes = await res.arrayBuffer()
    if (bytes.byteLength > max) throw tooBig()
    return { bytes, mime }
  }
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await reader.cancel()
      throw tooBig()
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.byteLength
  }
  return { bytes: out.buffer, mime }
}

async function defaultFetchBytes(url: string): Promise<ImageBytes> {
  // force-cache：页面已经加载过这张图，复用浏览器的图片缓存，不再下载一次
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) throw new Error(`取图失败：HTTP ${res.status}`)
  return readImageResponse(res)
}

/** ArrayBuffer → base64，分块避免 String.fromCharCode 的参数上限 */
export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** 译文与原文是不是一回事：折叠空白、忽略大小写与首尾标点 */
export function sameText(a: string, b: string): boolean {
  const norm = (t: string) => squash(t.normalize('NFC')).toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
  return norm(a) === norm(b)
}

/**
 * 图注文字做上下文（§15.1：Safari 逐行无上下文的翻法是质量差的原因）。
 * 取**离图最近**的那一层 figure 自己的说明（`:scope > figcaption`），没有再往外层找：多面板插图里
 * 每个分图各有说明，从最外层 `querySelector('figcaption')` 会把第一个分图的说明给所有分图
 *（2410.00260 的 A2.F4：(b) 会拿到 (a) 的 "Classifier confusion matrix"，Codex 在 #89 指出）
 */
export function captionOf(el: Element): string | undefined {
  for (let fig = el.closest('figure'); fig; fig = fig.parentElement?.closest('figure') ?? null) {
    const own = Array.from(fig.children).find(child => child.tagName === 'FIGCAPTION')
    const text = squash(own?.textContent)
    if (text) return text.slice(0, CAPTION_MAX_CHARS)
  }
  return undefined
}

export function startImageTranslation(options: ImageRunOptions): ImageRun {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes
  /** 进入过视口但模式闸关着的目标 */
  const parked = new Set<ImageTarget>()
  // The bookkeeping shared with the text run (ADR-0006): outcomes, the permanent-error record, stop, the scheduler
  const ledger = createRunLedger(options.targets, {
    preload: options.preload,
    onEnter: entered => { void translate(entered) },
    isCurrent: options.isCurrent,
    onStop: () => {
      parked.clear()
      // 排队没开始的直接结清，等它们的 translate() 才会返回
      for (const entry of queue.splice(0)) entry.done()
    },
  })
  const alive = () => !ledger.halted()
  /**
   * run 级的队列与 worker 池：并发上限对整个 run 生效，不是对每次 translate() 调用各算一份——
   * 观察器每次回调、每次重试都会调 translate()，各开一池的话上限形同虚设（Codex 在 #89 指出）
   */
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT
  const queue: { target: ImageTarget; done: () => void }[] = []
  let active = 0

  const progress = (): ImageProgress => ledger.progress()
  const report = () => {
    if (!ledger.stopped()) options.onProgress?.(progress())
  }
  const fail = (target: ImageTarget, reason: string) => ledger.settle(target, 'failed', reason)

  /** 把回来的段落配回它们的框；成功与部分成功两条路共用一份 */
  const labelsFrom = (segments: readonly { id: string; text: string }[], boxes: readonly Box[], target: ImageTarget): ImageLabel[] => {
    // 转义用的是协商出的格式，反转义必须用同一个：原来这里连格式都没传，markers 下会拿 HTML 实体规则去解一段纯文本
    const translated = new Map(segments.map(s => [s.id, unescapeText(s.text, wireFormatOf(options.renderPath))]))
    const labels: ImageLabel[] = []
    for (const [i, box] of boxes.entries()) {
      const text = translated.get(`${target.id}#L${i}`)?.trim()
      // 译文与原文相同（单位、变量名、引擎原样返回的）不画：白框盖住原图只会把排版好的下标变成 OCR 读歪的字
      if (!text || sameText(text, box.text)) continue
      const label: ImageLabel = { x: box.x, y: box.y, w: box.w, h: box.h, lines: box.lines, source: box.text, text }
      if (box.angle) {
        label.angle = box.angle
        // 斜标签自己的盒子：叠加层按它沿文字的轴摆（§15.5）
        if (box.len) label.len = box.len
        if (box.thick) label.thick = box.thick
      }
      labels.push(label)
    }
    return labels
  }

  /**
   * SVG 图的「识别」：直接读 `contentDocument` 里的字形（§15.5）。
   *
   * 不取字节、不算 hash、不发 OCR —— 文字是**读**出来的，`data-text` 把每个字形对应的字符写在
   * 属性里，误差为零。代码清单在这里剔掉：§5 的跳过规则是 HTML 选择器，够不着 SVG 里一串平铺的
   * `<use>`（Codex 在 #133 指出），所以这条路要自己认。
   *
   * **还没加载好就等它的 `load`**，不能当场判失败：视口调度是一次性的，判了失败之后
   * `load` 事件不会把这张图重新交上来，它就一直不翻直到用户手动重试（Codex 在 #134 指出）。
   * 实测 4 篇论文 44 张图在页面 load 之后全部可达、连滚动前都是（RESEARCH §6.11），
   * 所以这条路平时根本走不到——但会话可以在页面还在加载时就开始。
   */
  const svgOf = (target: ImageTarget): Element | undefined => {
    const svg = (target.el as HTMLObjectElement).contentDocument?.documentElement
    return svg?.tagName.toLowerCase() === 'svg' ? svg : undefined
  }

  const svgLines = async (target: ImageTarget): Promise<OcrLine[] | string> => {
    let svg = svgOf(target)
    if (!svg) {
      await new Promise<void>(resolve => {
        const view = target.el.ownerDocument.defaultView
        const done = () => {
          if (timer !== undefined) view?.clearTimeout(timer)
          target.el.removeEventListener('load', done)
          resolve()
        }
        const timer = view?.setTimeout(done, SVG_LOAD_TIMEOUT_MS)
        target.el.addEventListener('load', done, { once: true })
      })
      svg = svgOf(target)
    }
    if (!svg) return '图还没加载出来'
    return linesOf(svg).filter(line => !looksLikeCode(line.text))
  }

  const process = async (target: ImageTarget): Promise<void> => {
    try {
      let lines: readonly OcrLine[]
      let frames = 1
      if (target.kind === 'picture') {
        // 内联 TikZ 图（§15.6）：文字与几何都在主文档里，没有要取、要等、要识别的东西
        lines = foreignLinesOf(target.el).filter(line => !looksLikeCode(line.text))
      } else if (target.kind === 'svg') {
        const read = await svgLines(target)
        if (!alive()) return
        if (typeof read === 'string') return fail(target, read)
        lines = read
      } else {
        const el = target.el as HTMLImageElement
        const { bytes, mime } = await fetchBytes(el.currentSrc || el.src)
        if (!alive()) return
        if (!IMAGE_TYPES.test(mime)) return fail(target, `不是位图（${mime || '未知类型'}）`)
        if (bytes.byteLength > MAX_IMAGE_BYTES) return fail(target, `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
        const imageHash = await sha256Hex(bytes)
        if (!alive()) return
        const ocr = await options.ocr({ imageHash, image: toBase64(bytes), mime, paper: options.paper, scope: options.scope })
        if (!alive()) return
        if (!ocr.ok) return fail(target, `识别失败：${ocr.error.message}`)
        lines = ocr.result.lines
        frames = ocr.result.frames ?? 1
      }
      // 没有标签就算完成，但上一轮留下的叠加层要清掉（换了目标语言后旧译文不该一直挂着，Codex 在 #89 指出）
      const finishEmpty = () => {
        // 真的摘掉了旧叠加层就要通知整理层：side 的拆图副本里还留着它，签名不重算副本就不重建（Codex 在 #89 指出）
        const removed = clearImage(target)
        ledger.settle(target, 'done')
        if (removed) options.onRendered?.([target])
      }
      // 动图：helper 只识别了第 0 帧，浏览器在放后面的帧，框对不上——不叠
      if (frames > 1) return finishEmpty()
      // 内联图的每一行本来就是一个完整的 TikZ 节点，不该与上下相邻的节点合并（§15.6）
      const boxes = linesToBoxes(lines, target.kind === 'picture' ? { merge: false } : {})
      if (boxes.length === 0) return finishEmpty() // 图里没有可翻的文字
      const caption = captionOf(target.el)
      const context: TranslateContext = { ...options.context, ...(caption ? { sectionTitle: caption } : {}) }
      const res = await options.translate({
        request: {
          segments: boxes.map((box, i) => ({ id: `${target.id}#L${i}`, text: escapeText(box.text, wireFormatOf(options.renderPath)) })),
          source: 'en',
          target: options.target,
          context: Object.keys(context).length ? context : undefined,
        },
        cache: { paper: options.paper, renderPath: options.renderPath },
        scope: options.scope,
      })
      if (!alive()) return
      if (!res.ok) {
        // 一张图的标签可能横跨多个批次（内联 TikZ 动辄上百个节点）：一批失败时另一批已经译好的
        // 标签随失败一起回来（§8.2 的 `partial`），先把它们画上去再处理失败——整张图空着不如
        // 少几个标签，而重试时画过的那些直接命中缓存（Codex 在 #163 指出，文字管线已经这么做了）。
        // **画在致命分支之前**：降级链上前一步译出来的段落会跟着末步的 auth 失败一起回来，
        // 而致命分支会就地停掉整个调度、这张图这一轮再没有第二次机会（Codex 在 #163 第五轮指出）
        const done = labelsFrom(res.partial ?? [], boxes, target)
        if (done.length > 0) {
          renderImage(target, done)
          options.onRendered?.([target])
        }
        // key 失效 / 没配 key：与文字管线一样，第一次遇到就停调度，之后的图不再取、不再识别
        // 配置级错误（PERMANENT_ERROR_KINDS，与文字管线同一套）：第一次遇到就停调度，别让之后进入视口的每张图都去取图、识别、再撞一次
        if (isPermanentErrorKind(res.error.kind) && ledger.fatal(res.error.kind, res.error.message)) {
          parked.clear()
          // 已认领但没完成的（并发中的、排队的）一并记失败，进度与 failed() 才对得上；排队的直接结清
          for (const other of ledger.inState('requested')) if (other !== target) fail(other, `停在配置错误：${res.error.message}`)
          for (const entry of queue.splice(0)) entry.done()
          fail(target, `翻译失败：${res.error.message}`)
          // 立刻把带 fatal 的进度发出去：别等还在等 OCR 的另一个 worker（最长一个 helper 超时）结束才让 popup 知道（Codex 在 #89 指出）
          report()
          return
        }
        return fail(target, `翻译失败：${res.error.message}`)
      }
      const labels = labelsFrom(res.result.segments, boxes, target)
      if (labels.length === 0) return finishEmpty()
      renderImage(target, labels)
      ledger.settle(target, 'done')
      options.onRendered?.([target])
    } catch (e) {
      if (!alive()) return
      fail(target, e instanceof Error ? e.message : String(e))
    }
  }

  const translate = async (picked: ImageTarget[]): Promise<void> => {
    // The gate is asked per target (§15.5): bitmaps wait for the helper, SVG figures do not; the refused ones park
    const { taken: ready, held } = ledger.intake(picked, options.isEnabled)
    for (const t of held) parked.add(t)
    if (ready.length === 0) return
    for (const t of ready) parked.delete(t)
    ledger.request(ready)
    report()
    // 进 run 级队列，worker 池按上限取（fetch → hash → base64 → OCR 一条龙，别一次全开）
    const settled = ready.map(target => new Promise<void>(done => queue.push({ target, done })))
    pump()
    await Promise.all(settled)
    report()
  }

  const pump = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const entry = queue.shift() as { target: ImageTarget; done: () => void }
      active++
      void process(entry.target).finally(() => {
        active--
        entry.done()
        pump()
      })
    }
  }

  // 首屏在这里同步播种，回调会在 translate 就绪之前触发，所以 translate 得先定义
  ledger.observe()

  return {
    translate,
    resume() {
      // 不在这里筛：`translate` 自己按目标问一遍 `isEnabled`，不合格的原样退回 parked，
      // 筛一遍只是省一次往返，却多一条测不出来的分支
      if (parked.size === 0) return
      const picked = Array.from(parked)
      parked.clear()
      void translate(picked)
    },
    stop: () => ledger.stop(),
    failed: () => ledger.failed(),
    fatal: () => ledger.fatalReason(),
    progress,
  }
}
