// Image pipeline (DESIGN §15): keep bitmaps outside the Block union (seven exhaustive switches; renderPending would create
// <img class="axt-pending">). Reuse only viewport scheduling, session IDs, and the plain-text translation path.
//
// Per image: fetch bytes (same-origin HTTP cache) → SHA-256 → background OCR (cached by imageHash) → merge lines into boxes,
// filter numbers and single letters → send box text through translateTitle's plain-text provider path (caption context in each batch) →
// insert overlay. Recheck the session after every await, as in the text pipeline; discard results arriving after restore or restart.
// No pending / failed DOM nodes (§15.2): record failures here for popup counts and retry.
import { ID_ATTR } from '@/core/extractor'
import { decodeText, escapeText } from '@/core/protector/text'
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

/** Bitmap cap: arXiv images are usually hundreds of KB; 6 MB is generous. Larger base64 messages are not worthwhile. */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** Bitmap types the helper can decode; exclude SVG and unknown types (§15.1). */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|tiff)$/i
/** Caption context length cap; included in both prompt and cache key. */
const CAPTION_MAX_CHARS = 300
/** Configuration errors match text FATAL_KINDS: stop at the first one, avoiding repeated fetch / OCR / failure for later images. */
const FATAL_KINDS = new Set(['no-key', 'auth'])
/** Concurrent images: bytes, base64, and messages all consume memory. The helper is sequential; more work just queues 6 MB images in memory. */
const MAX_CONCURRENT = 2

export interface ImageBytes {
  bytes: ArrayBuffer
  mime: string
}

export interface ImageRunOptions {
  doc: Document
  targets: ImageTarget[]
  paper: string
  /** Target language (ISO 639-3, as in the text pipeline). */
  target: string
  scope: string
  preload: PreloadOptions
  context?: TranslateContext
  ocr: (call: OcrCall) => Promise<OcrMessageResponse>
  translate: (call: TranslateCall) => Promise<TranslateMessageResponse>
  /** Whether the active mode is selected; hold entering images otherwise, until resume. */
  isEnabled: () => boolean
  /** Whether this session is still current (false after restore / restart). */
  isCurrent: () => boolean
  /** Test injection: concurrency cap. */
  maxConcurrent?: number
  /** Test injection: byte fetcher. */
  fetchBytes?: (url: string) => Promise<ImageBytes>
  onProgress?: (progress: ImageProgress) => void
  onRendered?: (targets: ImageTarget[]) => void
}

export interface ImageRun {
  /** Stop reason after a configuration error (auth / no-key); translate / resume do nothing afterward. */
  fatal(): string | undefined
  /** Manually dispatch targets for retry; do not duplicate in-flight requests. */
  translate(targets: ImageTarget[]): Promise<void>
  /** Mode enabled: release held targets. */
  resume(): void
  stop(): void
  failed(): ImageTarget[]
  progress(): ImageProgress
}

type Outcome = 'waiting' | 'requested' | 'done' | 'failed'

/**
 * Bitmaps inside the translation root, excluding block contents (cloned through placeholders; only mode hides the entire original block,
 * leaving nowhere for an overlay, as with split-figure unowned media) and injected nodes. Call after all block markers are written.
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
 * Read with a size cap: check Content-Length when reliable, then stream and cancel immediately at the limit if absent or inaccurate.
 * arrayBuffer() allocates the whole response before checking, defeating the cap (Codex #89).
 */
export async function readImageResponse(res: Response, max = MAX_IMAGE_BYTES): Promise<ImageBytes> {
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  const tooBig = () => new Error(`Image exceeds ${max / 1024 / 1024} MB`)
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
  // force-cache: reuse the image the page already loaded instead of downloading it again.
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status}`)
  return readImageResponse(res)
}

/** ArrayBuffer → base64, chunked to avoid String.fromCharCode's argument limit. */
export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Compare source and translation, collapsing whitespace and ignoring case and surrounding punctuation. */
export function sameText(a: string, b: string): boolean {
  const norm = (t: string) => t.normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
  return norm(a) === norm(b)
}

/**
 * Caption context (§15.1): Safari's context-free line translation harms quality.
 * Use the nearest figure's own caption (`:scope > figcaption`), then search outward if absent. In multi-panel figures,
 * an outer querySelector('figcaption') would give every panel the first panel's caption
 * (2410.00260 A2.F4: (b) would get (a)'s "Classifier confusion matrix"; Codex #89).
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
  /** Targets that entered the viewport while their mode was disabled. */
  const parked = new Set<ImageTarget>()
  let stopped = false
  let fatal: string | undefined
  const alive = () => !stopped && fatal === undefined && options.isCurrent()
  /**
   * Run-wide queue and worker pool: the cap applies to the entire run, not each translate() call.
   * Every observer callback and retry calls translate(); separate pools would defeat the cap (Codex #89).
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
      if (!IMAGE_TYPES.test(mime)) return fail(target, `Not a bitmap (${mime || 'unknown type'})`)
      if (bytes.byteLength > MAX_IMAGE_BYTES) return fail(target, `Image exceeds ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
      const imageHash = await sha256Hex(bytes)
      if (!alive()) return
      const ocr = await options.ocr({ imageHash, image: toBase64(bytes), mime, paper: options.paper, scope: options.scope })
      if (!alive()) return
      if (!ocr.ok) return fail(target, `OCR failed: ${ocr.error.message}`)
      // No labels counts as complete, but clear old overlays so a target-language change cannot leave stale text (Codex #89).
      const finishEmpty = () => {
        // Notify cleanup when an old overlay was removed: side split copies still contain it and need a new signature (Codex #89).
        const removed = clearImage(target)
        outcome.set(target, 'done')
        if (removed) options.onRendered?.([target])
      }
      // Animation: OCR covers only frame 0 while the browser plays later frames; boxes would not align, so omit overlays.
      if ((ocr.result.frames ?? 1) > 1) return finishEmpty()
      const boxes = linesToBoxes(ocr.result.lines)
      if (boxes.length === 0) return finishEmpty() // No translatable text in the image.
      const caption = captionOf(target.el)
      const context: TranslateContext = { ...options.context, ...(caption ? { sectionTitle: caption } : {}) }
      const res = await options.translate({
        request: {
          segments: boxes.map((box, i) => ({ id: `${target.id}#L${i}`, text: escapeText(box.text) })),
          source: 'en',
          target: options.target,
          context: Object.keys(context).length ? context : undefined,
        },
        cache: { paper: options.paper, renderPath: 'markup' },
        scope: options.scope,
      })
      if (!alive()) return
      if (!res.ok) {
        // Invalid / missing key: stop on the first error, as with text; do not fetch or recognize later images.
        if (FATAL_KINDS.has(res.error.kind) && fatal === undefined) {
          fatal = `${res.error.kind}: ${res.error.message}`
          scheduler?.disconnect()
          parked.clear()
          // Fail all claimed, unfinished targets (active and queued) so progress and failed() agree; settle queued targets immediately.
          for (const [other, state] of outcome) if (state === 'requested' && other !== target) fail(other, `Stopped by configuration error: ${res.error.message}`)
          for (const entry of queue.splice(0)) entry.done()
          fail(target, `Translation failed: ${res.error.message}`)
          // Report fatal progress immediately, without waiting for another worker's OCR (up to one helper timeout; Codex #89).
          report()
          return
        }
        return fail(target, `Translation failed: ${res.error.message}`)
      }
      const translated = new Map(res.result.segments.map(s => [s.id, decodeText(s.text)]))
      const labels: ImageLabel[] = []
      for (const [i, box] of boxes.entries()) {
        const text = translated.get(`${target.id}#L${i}`)?.trim()
        // Omit unchanged translations (units, variables, engine passthrough): white boxes would replace correct subscripts with OCR errors.
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
    // Enqueue for the run-wide pool, which caps the entire fetch → hash → base64 → OCR sequence.
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

  // Seed the first viewport synchronously; the callback runs before translate would otherwise be ready, so define it first.
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
      // Settle queued work immediately so waiting translate() calls can return.
      for (const entry of queue.splice(0)) entry.done()
    },
    failed: () => options.targets.filter(t => outcome.get(t) === 'failed'),
    fatal: () => fatal,
    progress,
  }
}
