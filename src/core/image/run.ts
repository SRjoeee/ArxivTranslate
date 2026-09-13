// The small pipeline of image translation (DESIGN §15): a bitmap does not join the Block union (seven exhaustive
// switches, and renderPending would build an <img class="axt-pending"> after the original's tag); it has a pipeline
// of its own and reuses only the viewport scheduler, the session id and the plain-text translation path.
//
// Per image: fetch the bytes (same origin, through the HTTP cache) → SHA-256 → OCR in the background (cached by
// imageHash) → merge lines into boxes, drop numbers and single letters → send the boxes' text to the existing provider
// on translateTitle's plain-text path (the caption as context, one batch) → insert the overlay. **The session is
// re-checked after every await** (the pattern of the text pipeline): a result arriving after a restore / a restart is
// dropped. Pending and failure have no DOM node (§15.2): failures are recorded here, shown by the popup and handled
// by the retry button.
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

/** The bitmap cap: arXiv figures are usually a few hundred KB, 6 MB is generous; a larger base64 through the message channel is not worth it */
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024
/** The bitmap types the helper decodes; SVG and unknown types are not sent (§15.1: SVG is skipped whole) */
const IMAGE_TYPES = /^image\/(png|jpe?g|gif|webp|bmp|tiff)$/i
/** The length cap of a caption used as context: it enters the prompt and the cache key */
const CAPTION_MAX_CHARS = 300
/** Images in flight at once: the bytes, the base64 and the message payload all take memory, and the helper is sequential — more only hoards 6 MB images */
const MAX_CONCURRENT = 2
/** How long an `<object>` still loading is waited for (§15.5). Past that the image is skipped rather than holding the queue */
const SVG_LOAD_TIMEOUT_MS = 5000

export interface ImageBytes {
  bytes: ArrayBuffer
  mime: string
}

export interface ImageRunOptions {
  doc: Document
  targets: ImageTarget[]
  paper: string
  /** The target language (ISO 639-3, as in the text pipeline) */
  target: string
  scope: string
  /** The render path the session negotiated (§8.5): OCR lines go down the same wire, and escaping and the cache key must follow it */
  renderPath: RenderPath
  preload: PreloadOptions
  context?: TranslateContext
  ocr: (call: OcrCall) => Promise<OcrMessageResponse>
  translate: (call: TranslateCall) => Promise<TranslateMessageResponse>
  /** The mode in effect is among the ones the reader ticked; otherwise an image entering the viewport parks, translated on resume */
  /**
   * Can this target be translated now. **Asked per target, not one global switch**: the display mode applies to
   * both kinds of image alike, but a bitmap waits for the local helper and an SVG figure does not (§15.5). A target
   * answered false stays in parked; `resume()` releases it when the conditions change
   */
  isEnabled: (target: ImageTarget) => boolean
  /** Is the session still the current one (false after a restore / a restart) */
  isCurrent: () => boolean
  /** Test injection: the concurrency cap */
  maxConcurrent?: number
  /** Test injection: fetching the bytes */
  fetchBytes?: (url: string) => Promise<ImageBytes>
  onProgress?: (progress: ImageProgress) => void
  onRendered?: (targets: ImageTarget[]) => void
}

export interface ImageRun {
  /** Why it stopped after a configuration-level error (auth / no-key); once stopped, neither translate nor resume does anything */
  fatal(): string | undefined
  /** Hand targets over by hand (a retry); one already requested is not repeated */
  translate(targets: ImageTarget[]): Promise<void>
  /** The mode gate opened: release the parked targets */
  resume(): void
  stop(): void
  failed(): ImageTarget[]
  progress(): ImageProgress
}

/** Does this inline figure hold a label worth translating: a formula-only TikZ picture (most of the corpus) need not enter the scheduler */
function hasPictureText(picture: Element): boolean {
  return pictureTexts(picture).some(isTranslatable)
}

/**
 * The bitmaps inside the translation root, excluding those inside blocks (an image in a block is cloned into the
 * translation with the placeholders, and in only mode the original block is hidden whole, leaving the overlay
 * nowhere to hang; the same test as the split figures' “loose media”) and those in our own nodes. Call after the
 * block marks are written
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
    // Inline TikZ pictures (§15.6): only those **with words**. Most of the 170 in the corpus draw formulas, and taking
    // them would only give the scheduler a heap of targets that end with nothing; the test reads text, not geometry
    if (tag === 'svg' && (el.parentElement?.closest(FIGURE_SELECTORS.picture) || !hasPictureText(el))) continue
    let id = el.id || `axt-img-${++n}`
    while (used.has(id)) id = `${id}-${++n}`
    used.add(id)
    targets.push({ id, el, kind: tag === 'object' ? 'svg' : tag === 'svg' ? 'picture' : 'raster' })
  }
  return targets
}

/**
 * Read the response body up to a cap: a trustworthy Content-Length is checked first; without one, or an inaccurate
 * one, the body is streamed and cancelled the moment the cap is passed — `arrayBuffer()` would allocate the whole
 * response before its size could be judged, and the cap would be a fiction (Codex on #89)
 */
export async function readImageResponse(res: Response, max = MAX_IMAGE_BYTES): Promise<ImageBytes> {
  const mime = (res.headers.get('content-type') ?? '').split(';')[0]?.trim() ?? ''
  const tooBig = () => new Error(`image over ${max / 1024 / 1024} MB`)
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
  // force-cache: the page has loaded this image already; the browser's image cache is reused rather than downloading again
  const res = await fetch(url, { cache: 'force-cache' })
  if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`)
  return readImageResponse(res)
}

/** ArrayBuffer → base64, in chunks to stay under the argument limit of String.fromCharCode */
export function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  for (let i = 0; i < view.length; i += 0x8000) binary += String.fromCharCode(...view.subarray(i, i + 0x8000))
  return btoa(binary)
}

/** Are the translation and the original the same thing: whitespace collapsed, case and surrounding punctuation ignored */
export function sameText(a: string, b: string): boolean {
  const norm = (t: string) => squash(t.normalize('NFC')).toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, '')
  return norm(a) === norm(b)
}

/**
 * The caption text as context (§15.1: Safari's line-by-line translation without context is why its quality is poor).
 * The **nearest** figure's own caption (`:scope > figcaption`), and only when it has none the search goes on outward:
 * in a multi-panel figure every panel has its own caption, and `querySelector('figcaption')` from the outermost would
 * give the first panel's caption to all of them (A2.F4 of 2410.00260: (b) would get (a)'s "Classifier confusion
 * matrix"; Codex on #89)
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
  /** Targets that entered the viewport while the mode gate was shut */
  const parked = new Set<ImageTarget>()
  // The bookkeeping shared with the text run (ADR-0006): outcomes, the permanent-error record, stop, the scheduler
  const ledger = createRunLedger(options.targets, {
    preload: options.preload,
    onEnter: entered => { void translate(entered) },
    isCurrent: options.isCurrent,
    onStop: () => {
      parked.clear()
      // Those queued but not started are settled at once; their translate() only returns then
      for (const entry of queue.splice(0)) entry.done()
    },
  })
  const alive = () => !ledger.halted()
  /**
   * The run-level queue and worker pool: the concurrency cap applies to the whole run, not to each translate() call
   * on its own — every observer callback and every retry calls translate(), and a pool per call would make the cap a
   * fiction (Codex on #89)
   */
  const maxConcurrent = options.maxConcurrent ?? MAX_CONCURRENT
  const queue: { target: ImageTarget; done: () => void }[] = []
  let active = 0

  const progress = (): ImageProgress => ledger.progress()
  const report = () => {
    if (!ledger.stopped()) options.onProgress?.(progress())
  }
  const fail = (target: ImageTarget, reason: string) => ledger.settle(target, 'failed', reason)

  /** Match the segments that came back to their boxes; success and partial success share it */
  const labelsFrom = (segments: readonly { id: string; text: string }[], boxes: readonly Box[], target: ImageTarget): ImageLabel[] => {
    // Escaped in the negotiated format, unescaped in the same one: the format used to go untold here, and under markers a plain-text run was decoded by the HTML entity rules
    const translated = new Map(segments.map(s => [s.id, unescapeText(s.text, wireFormatOf(options.renderPath))]))
    const labels: ImageLabel[] = []
    for (const [i, box] of boxes.entries()) {
      const text = translated.get(`${target.id}#L${i}`)?.trim()
      // A translation equal to the original (units, variable names, what the engine returned as it was) is not drawn: a white box over the image would only turn a well-set subscript into text OCR read askew
      if (!text || sameText(text, box.text)) continue
      const label: ImageLabel = { x: box.x, y: box.y, w: box.w, h: box.h, lines: box.lines, source: box.text, text }
      if (box.angle) {
        label.angle = box.angle
        // A tilted label's own box: the overlay lays it along the text's axis (§15.5)
        if (box.len) label.len = box.len
        if (box.thick) label.thick = box.thick
      }
      labels.push(label)
    }
    return labels
  }

  /**
   * The “recognition” of an SVG figure: the glyphs of its `contentDocument` read directly (§15.5).
   *
   * No bytes fetched, no hash, no OCR — the text is **read**: `data-text` holds the character of every glyph in an
   * attribute, with zero error. Code listings are picked out here: the skip rules of §5 are HTML selectors and cannot
   * reach a run of flat `<use>` inside an SVG (Codex on #133), so this path has to recognise them itself.
   *
   * **Not yet loaded, its `load` is awaited** rather than failing on the spot: the viewport scheduling is one-shot,
   * and after a failure the `load` event would not hand the figure over again, so it would stay untranslated until
   * the reader retried by hand (Codex on #134). Measured over 44 figures in 4 papers: all reachable after the page's
   * load, even before any scroll (RESEARCH §6.11), so this path is normally never taken — but a session can start
   * while the page is still loading.
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
    if (!svg) return 'the figure has not loaded yet'
    return linesOf(svg).filter(line => !looksLikeCode(line.text))
  }

  const process = async (target: ImageTarget): Promise<void> => {
    try {
      let lines: readonly OcrLine[]
      let frames = 1
      if (target.kind === 'picture') {
        // An inline TikZ picture (§15.6): text and geometry are in the main document; nothing to fetch, wait for or recognise
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
        if (!IMAGE_TYPES.test(mime)) return fail(target, `not a bitmap (${mime || 'unknown type'})`)
        if (bytes.byteLength > MAX_IMAGE_BYTES) return fail(target, `image over ${MAX_IMAGE_BYTES / 1024 / 1024} MB`)
        const imageHash = await sha256Hex(bytes)
        if (!alive()) return
        const ocr = await options.ocr({ imageHash, image: toBase64(bytes), mime, paper: options.paper, scope: options.scope })
        if (!alive()) return
        if (!ocr.ok) return fail(target, `recognition failed: ${ocr.error.message}`)
        lines = ocr.result.lines
        frames = ocr.result.frames ?? 1
      }
      // No labels counts as done, but the overlay of the previous round has to go (after a target-language change the old translation must not hang on; Codex on #89)
      const finishEmpty = () => {
        // An old overlay really removed has to be told to the tidy layer: side's split copy still holds it, and without a recomputed signature the copy is not rebuilt (Codex on #89)
        const removed = clearImage(target)
        ledger.settle(target, 'done')
        if (removed) options.onRendered?.([target])
      }
      // An animated image: the helper recognised frame 0 only, the browser is showing later frames, the boxes would not line up — no overlay
      if (frames > 1) return finishEmpty()
      // Every line of an inline picture is a complete TikZ node already and must not merge with its vertical neighbours (§15.6)
      const boxes = linesToBoxes(lines, target.kind === 'picture' ? { merge: false } : {})
      if (boxes.length === 0) return finishEmpty() // nothing translatable in the image
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
        // One image's labels may span several batches (an inline TikZ picture easily has a hundred nodes): when one
        // batch fails, the labels another batch had translated come back with the failure (`partial` of §8.2), and
        // they are drawn before the failure is handled — a few labels short beats an empty image, and on retry the
        // drawn ones hit the cache (Codex on #163; the text pipeline does the same already). **Drawn before the
        // fatal branch**: segments an earlier step of the fallback chain translated come back with the last step's
        // auth failure, and the fatal branch stops the whole scheduler on the spot — this image gets no second chance
        // this round (Codex on #163, fifth round)
        const done = labelsFrom(res.partial ?? [], boxes, target)
        if (done.length > 0) {
          renderImage(target, done)
          options.onRendered?.([target])
        }
        // An invalid / missing key: as in the text pipeline, the scheduler stops on the first one, and later images are
        // neither fetched nor recognised. A configuration-level error (PERMANENT_ERROR_KINDS, the same set as the text
        // pipeline's): stop on the first, rather than letting every image entering the viewport fetch, recognise and hit it again
        if (isPermanentErrorKind(res.error.kind) && ledger.fatal(res.error.kind, res.error.message)) {
          parked.clear()
          // The claimed but unfinished ones (in flight, queued) are recorded as failed too, so the progress and failed() agree; the queued ones settle at once
          for (const other of ledger.inState('requested')) if (other !== target) fail(other, `stopped on a configuration error: ${res.error.message}`)
          for (const entry of queue.splice(0)) entry.done()
          fail(target, `translation failed: ${res.error.message}`)
          // The progress with fatal goes out at once: not after another worker still waiting on OCR (up to one helper timeout) finishes, before the popup learns of it (Codex on #89)
          report()
          return
        }
        return fail(target, `translation failed: ${res.error.message}`)
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
    // Into the run-level queue; the worker pool takes up to the cap (fetch → hash → base64 → OCR in one go, not all at once)
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

  // The first screen is seeded here synchronously, and the callback fires before translate is ready, so translate has to be defined first
  ledger.observe()

  return {
    translate,
    resume() {
      // No filtering here: `translate` asks `isEnabled` per target itself and returns the unfit ones to parked as they
      // were; filtering would save one round trip and add one untestable branch
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
