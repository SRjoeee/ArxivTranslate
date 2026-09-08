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
import { createLazyScheduler, type LazyScheduler, type PreloadOptions } from '@/core/scheduler/lazy'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import type { TranslateContext } from '@/providers/types'
import { sha256Hex } from '@/shared/digest'
import type { ImageProgress, OcrCall, OcrMessageResponse } from '@/shared/ocr'
import { linesToBoxes } from './boxes'

export type { ImageTarget } from '@/core/renderer/image'

/** 位图上限：arXiv 的图通常几百 KB，6 MB 已经很宽；再大的 base64 过消息通道不值得 */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** helper 能解的位图类型；SVG 与未知类型不送（§15.1：SVG 整体跳过） */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|tiff)$/i
/** 图注做上下文时的长度上限：进 prompt 也进缓存键 */
const CAPTION_MAX_CHARS = 300
/** 配置级错误（与文字管线的 FATAL_KINDS 同一套）：第一次遇到就停调度，别让之后进入视口的每张图都去取图、识别、再撞一次 */
const FATAL_KINDS = new Set(['no-key', 'auth'])
/** 同时在处理的图：取字节、base64、消息载荷都占内存，helper 又是顺序的，多开只是把 6 MB 一张的图囤在那里 */
const MAX_CONCURRENT = 2

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
  isEnabled: () => boolean
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

type Outcome = 'waiting' | 'requested' | 'done' | 'failed'

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
  for (const el of Array.from(root.querySelectorAll<HTMLImageElement>(FIGURE_SELECTORS.graphics))) {
    if (el.closest(`[${ID_ATTR}]`) || el.closest(INJECTED_SELECTOR)) continue
    let id = el.id || `axt-img-${++n}`
    while (used.has(id)) id = `${id}-${++n}`
    used.add(id)
    targets.push({ id, el })
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
  const norm = (t: string) => t.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
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
    const text = own?.textContent?.replace(/\s+/g, ' ').trim()
    if (text) return text.slice(0, CAPTION_MAX_CHARS)
  }
  return undefined
}

export function startImageTranslation(options: ImageRunOptions): ImageRun {
  const fetchBytes = options.fetchBytes ?? defaultFetchBytes
  const outcome = new Map<ImageTarget, Outcome>(options.targets.map(t => [t, 'waiting']))
  const reasons = new Map<ImageTarget, string>()
  /** 进入过视口但模式闸关着的目标 */
  const parked = new Set<ImageTarget>()
  let stopped = false
  let fatal: string | undefined
  const alive = () => !stopped && fatal === undefined && options.isCurrent()
  /**
   * run 级的队列与 worker 池：并发上限对整个 run 生效，不是对每次 translate() 调用各算一份——
   * 观察器每次回调、每次重试都会调 translate()，各开一池的话上限形同虚设（Codex 在 #89 指出）
   */
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT
  const queue: { target: ImageTarget; done: () => void }[] = []
  let active = 0

  const progress = (): ImageProgress => {
    let requested = 0
    let done = 0
    let failed = 0
    for (const state of outcome.values()) {
      if (state !== 'waiting') requested++
      if (state === 'done') done++
      if (state === 'failed') failed++
    }
    return { total: outcome.size, requested, done, failed, ...(fatal !== undefined ? { fatal } : {}) }
  }
  const report = () => {
    if (!stopped) options.onProgress?.(progress())
  }
  const fail = (target: ImageTarget, reason: string) => {
    outcome.set(target, 'failed')
    reasons.set(target, reason)
  }

  const process = async (target: ImageTarget): Promise<void> => {
    try {
      const { bytes, mime } = await fetchBytes(target.el.currentSrc || target.el.src)
      if (!alive()) return
      if (!IMAGE_TYPES.test(mime)) return fail(target, `不是位图（${mime || '未知类型'}）`)
      if (bytes.byteLength > MAX_IMAGE_BYTES) return fail(target, `图片超过 ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
      const imageHash = await sha256Hex(bytes)
      if (!alive()) return
      const ocr = await options.ocr({ imageHash, image: toBase64(bytes), mime, paper: options.paper, scope: options.scope })
      if (!alive()) return
      if (!ocr.ok) return fail(target, `识别失败：${ocr.error.message}`)
      // 没有标签就算完成，但上一轮留下的叠加层要清掉（换了目标语言后旧译文不该一直挂着，Codex 在 #89 指出）
      const finishEmpty = () => {
        // 真的摘掉了旧叠加层就要通知整理层：side 的拆图副本里还留着它，签名不重算副本就不重建（Codex 在 #89 指出）
        const removed = clearImage(target)
        outcome.set(target, 'done')
        if (removed) options.onRendered?.([target])
      }
      // 动图：helper 只识别了第 0 帧，浏览器在放后面的帧，框对不上——不叠
      if ((ocr.result.frames ?? 1) > 1) return finishEmpty()
      const boxes = linesToBoxes(ocr.result.lines)
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
        // key 失效 / 没配 key：与文字管线一样，第一次遇到就停调度，之后的图不再取、不再识别
        if (FATAL_KINDS.has(res.error.kind) && fatal === undefined) {
          fatal = `${res.error.kind}: ${res.error.message}`
          scheduler?.disconnect()
          parked.clear()
          // 已认领但没完成的（并发中的、排队的）一并记失败，进度与 failed() 才对得上；排队的直接结清
          for (const [other, state] of outcome) if (state === 'requested' && other !== target) fail(other, `停在配置错误：${res.error.message}`)
          for (const entry of queue.splice(0)) entry.done()
          fail(target, `翻译失败：${res.error.message}`)
          // 立刻把带 fatal 的进度发出去：别等还在等 OCR 的另一个 worker（最长一个 helper 超时）结束才让 popup 知道（Codex 在 #89 指出）
          report()
          return
        }
        return fail(target, `翻译失败：${res.error.message}`)
      }
      // 转义用的是协商出的格式，反转义必须用同一个：原来这里连格式都没传，markers 下会拿 HTML 实体规则去解一段纯文本
      const translated = new Map(res.result.segments.map(s => [s.id, unescapeText(s.text, wireFormatOf(options.renderPath))]))
      const labels: ImageLabel[] = []
      for (const [i, box] of boxes.entries()) {
        const text = translated.get(`${target.id}#L${i}`)?.trim()
        // 译文与原文相同（单位、变量名、引擎原样返回的）不画：白框盖住原图只会把排版好的下标变成 OCR 读歪的字
        if (!text || sameText(text, box.text)) continue
        labels.push({ x: box.x, y: box.y, w: box.w, h: box.h, lines: box.lines, source: box.text, text })
      }
      if (labels.length === 0) return finishEmpty()
      renderImage(target, labels)
      outcome.set(target, 'done')
      options.onRendered?.([target])
    } catch (e) {
      if (!alive()) return
      fail(target, e instanceof Error ? e.message : String(e))
    }
  }

  const translate = async (picked: ImageTarget[]): Promise<void> => {
    if (!alive()) return
    const fresh = picked.filter(t => outcome.has(t) && outcome.get(t) !== 'requested')
    if (fresh.length === 0) return
    if (!options.isEnabled()) {
      for (const t of fresh) parked.add(t)
      return
    }
    scheduler?.claim(fresh)
    for (const t of fresh) {
      parked.delete(t)
      outcome.set(t, 'requested')
    }
    report()
    // 进 run 级队列，worker 池按上限取（fetch → hash → base64 → OCR 一条龙，别一次全开）
    const settled = fresh.map(target => new Promise<void>(done => queue.push({ target, done })))
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
  let scheduler: LazyScheduler<ImageTarget> | null = null
  scheduler = createLazyScheduler(options.targets, { ...options.preload, onEnter: entered => { void translate(entered) } })

  return {
    translate,
    resume() {
      if (parked.size === 0 || !options.isEnabled()) return
      const picked = Array.from(parked)
      parked.clear()
      void translate(picked)
    },
    stop() {
      if (stopped) return
      stopped = true
      scheduler?.disconnect()
      parked.clear()
      // 排队没开始的直接结清，等它们的 translate() 才会返回
      for (const entry of queue.splice(0)) entry.done()
    },
    failed: () => options.targets.filter(t => outcome.get(t) === 'failed'),
    fatal: () => fatal,
    progress,
  }
}
