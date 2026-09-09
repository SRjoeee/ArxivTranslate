// Translation run (DESIGN §4 data flow, §10 scheduling, §6.3 / §8.2 fallback). Content-side logic communicates with the service through transport.
// Session-based, following Read Frog: startup marks blocks and registers a one-shot observer. Blocks enter a batch only within the viewport
// plus prefetch margin. Insert pending nodes with spinners before requests (§7.6). There is no full-paper completion point: translate as the user scrolls.
import { toBcp47 } from '@/config/languages'
import { ID_ATTR, type Block, type TextBlock } from '@/core/extractor'
import type { TranslateContext } from '@/providers/types'
import { joinRuns, rehydrate, splitRuns, validate } from '@/core/protector'
import {
  clearAllPending, enable, markPartial, renderFailed, renderPending, renderTable, renderText, setState, type Mode,
  type StylePreset,
} from '@/core/renderer'
import { createLazyScheduler, type LazyScheduler, type PreloadOptions } from '@/core/scheduler/lazy'
import { createWorkPacer, pauseIfBudgetSpent } from '@/core/scheduler/pacer'
import type { RenderPath } from '@/cache/key'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import { planBatches, sectionTitles, type Batch, type Segment } from './batches'

export interface Progress {
  /** on: scrolling keeps triggering work; stopped: restored by the user or halted by a fatal error. */
  state: 'idle' | 'on' | 'stopped'
  total: number
  /** Blocks that entered the viewport and have been requested. */
  requested: number
  done: number
  failed: number
  cached: number
  /** Blocks with requests in flight. */
  inFlight: number
  /** Errors such as no-key / auth that would keep failing; no new batches once set. */
  fatal?: string
}

export type Transport = (request: TranslateCall) => Promise<TranslateMessageResponse>

export interface RunOptions {
  doc: Document
  blocks: Block[]
  target: string
  mode: Mode
  /** Translation style preset (§7.5); omit to retain the current page attribute. */
  style?: { preset: StylePreset; customCss?: string }
  paper: string
  capabilities: { maxBatchChars: number; maxBatchItems: number; preservesMarkup: boolean }
  transport: Transport
  onProgress?: (progress: Progress) => void
  /**
   * These blocks just changed in the DOM (spinner / translation / failure widget). Twice per batch, alongside onProgress (issue #46).
   * Separate from Progress because Progress goes to the popup and must be serializable; Block contains DOM nodes.
   */
  onRendered?: (blocks: Block[]) => void
  /** Paper context (title, abstract, glossary) included in every batch; batches supply their own section title. */
  context?: TranslateContext
  /** Cancellation scope = session ID on every call; the caller cancels queued and in-flight requests on stop (§10). */
  scope?: string
  /** Viewport trigger distance and threshold (§10). */
  preload: PreloadOptions
}

export interface TranslationRun {
  /** Marking and observer ready (marking yields the main thread in slices). */
  ready: Promise<void>
  /** Queue blocks from observer entry, retry, or tests; skip requests already in flight. */
  translate(blocks: Block[]): Promise<void>
  /** End session: disconnect observer, remove pending nodes, stop rendering and reporting. */
  stop(): void
  progress(): Progress
  /** Failed blocks in document order; the popup's retry action passes them back to translate. */
  failed(): Block[]
}

const FATAL_KINDS = new Set(['no-key', 'auth'])

type Outcome = 'waiting' | 'requested' | 'done' | 'failed'
/** Segment result: translation or failure reason for the failure widget (§7.6). */
type SegmentResult = { fragment: DocumentFragment } | { error: string }
type BatchResult = Map<Segment, SegmentResult>
const CANCELLED: SegmentResult = { error: 'Cancelled' }
const MISMATCH: SegmentResult = { error: 'Translation placeholders do not match the original' }
const errorOf = (res: Extract<TranslateMessageResponse, { ok: false }>): SegmentResult => ({ error: `${res.error.kind}: ${res.error.message}` })

export function startTranslation(options: RunOptions): TranslationRun {
  const { doc, blocks, transport } = options
  const outcome = new Map<Block, Outcome>(blocks.map(block => [block, 'waiting']))
  let cached = 0
  let fatal: string | undefined
  let stopped = false
  let scheduler: LazyScheduler | null = null

  const progress = (): Progress => {
    let requested = 0
    let done = 0
    let failed = 0
    let inFlight = 0
    for (const state of outcome.values()) {
      if (state === 'waiting') continue
      requested++
      if (state === 'done') done++
      else if (state === 'failed') failed++
      else inFlight++
    }
    return { state: stopped || fatal !== undefined ? 'stopped' : 'on', total: blocks.length, requested, done, failed, cached, inFlight, ...(fatal !== undefined ? { fatal } : {}) }
  }
  const report = () => {
    if (!stopped) options.onProgress?.(progress())
  }
  // No separate stopped guard: the first call does not yield between translate()'s halted() check and this batch;
  // the second follows `if (stopped) return`, which already guards it. Another check here would be untestable dead code.
  const rendered = (blocks: Block[]) => options.onRendered?.(blocks)
  const halted = () => stopped || fatal !== undefined

  // Store the target language on <html>; renderText writes it on each translated node. The page lang describes the source (en on arXiv).
  // Without a target tag, screen readers would pronounce Chinese translations with an English voice.
  enable(doc, options.mode, options.style, toBcp47(options.target))
  const sectionOf = sectionTitles(blocks)

  // Mark every block synchronously (issue #67): both side-prep gates depend on data-axt-id. A container with unmarked blocks
  // would be cloned wholesale as static content into the right column, then gain duplicate English once its blocks are translated.
  // With sliced marking and three prep passes, this occurred 36 times in 2312.17141 and
  // 87 times in 2609.00245, in large .ltx_para / .ltx_proof / .ltx_theorem containers.
  // Slicing originally prevented hundreds of attribute writes from freezing the page (Read Frog #1881), but measurement disproved that cost:
  // the loop only writes attributes, never reads layout. Chromium took 1.2 ms for 979 blocks and 0 ms for subsequent forced layout.
  // Synchronous marking also removes the halted() race: without await, restore cannot interleave.
  for (const block of blocks) block.el.setAttribute(ID_ATTR, block.id)

  // State attributes still use slices: they affect styling (pending spinner) but not side-prep classification.
  const ready = (async () => {
    const pacer = createWorkPacer()
    for (const block of blocks) {
      // Check the session before every block write: the user may have restored the original while the main thread yielded.
      // Checking only outside the loop would write state after restore finished cleaning,
      // leaving orphaned data-axt-* attributes (violating §7.1; issue #45 experiment 1).
      if (halted()) return
      setState(block, 'pending')
      await pauseIfBudgetSpent(pacer)
    }
    if (halted()) return
    scheduler = createLazyScheduler(blocks, { ...options.preload, onEnter: entered => { void translate(entered) } })
  })()

  const send = (items: { id: string; text: string }[], renderPath: RenderPath, sectionTitle?: string, opts: { bypassCache?: boolean } = {}) => {
    const context: TranslateContext = { ...options.context, ...(sectionTitle ? { sectionTitle } : {}) }
    return transport({
      request: { segments: items, source: 'en', target: options.target, context: Object.keys(context).length ? context : undefined },
      cache: { paper: options.paper, renderPath, ...(opts.bypassCache ? { bypass: true } : {}) },
      ...(options.scope ? { scope: options.scope } : {}),
    })
  }

  const noteFatal = (res: Extract<TranslateMessageResponse, { ok: false }>) => {
    if (FATAL_KINDS.has(res.error.kind) && fatal === undefined) {
      fatal = `${res.error.kind}: ${res.error.message}`
      // Configuration errors would repeat: disconnect the observer and stop queuing batches.
      scheduler?.disconnect()
    }
  }

  /** Runs fallback (§6.5): split at void nodes, translate each run, then reassemble. */
  async function viaRuns(segment: Segment, sectionTitle?: string): Promise<SegmentResult> {
    if (halted()) return CANCELLED
    const layout = splitRuns(segment.protected)
    if (layout.runs.length === 0) return { fragment: joinRuns([], layout, segment.protected, doc) }
    const res = await send(layout.runs.map((text, i) => ({ id: `${segment.id}#r${i}`, text })), 'runs', sectionTitle)
    if (!res.ok) {
      noteFatal(res)
      return errorOf(res)
    }
    cached += res.cached
    const byId = new Map(res.result.segments.map(s => [s.id, s.text]))
    const texts = layout.runs.map((_, i) => byId.get(`${segment.id}#r${i}`))
    if (texts.some(t => t === undefined)) return { error: 'Translation count does not match the original' }
    try {
      return { fragment: joinRuns(texts as string[], layout, segment.protected, doc) }
    } catch {
      return MISMATCH
    }
  }

  /**
   * Placeholder validation failure: retry the block once, then fall back to runs (§6.3).
   * Bypass cache on retry: the invalid translation was cached before validation; a normal read would return it again (Codex #9).
   */
  async function retrySingle(segment: Segment, sectionTitle?: string): Promise<SegmentResult> {
    if (halted()) return CANCELLED
    const res = await send([{ id: segment.id, text: segment.text }], 'markup', sectionTitle, { bypassCache: true })
    if (res.ok) {
      cached += res.cached
      const text = res.result.segments[0]?.text
      if (text !== undefined && validate(text, segment.protected).ok) return { fragment: rehydrate(text, segment.protected, doc) }
    } else {
      noteFatal(res)
    }
    return viaRuns(segment, sectionTitle)
  }

  async function translateSegments(segments: Segment[], sectionTitle: string | undefined, out: BatchResult): Promise<void> {
    if (halted()) return
    if (!options.capabilities.preservesMarkup) {
      for (const segment of segments) out.set(segment, await viaRuns(segment, sectionTitle))
      return
    }
    const res = await send(segments.map(s => ({ id: s.id, text: s.text })), 'markup', sectionTitle)
    if (stopped) return
    if (!res.ok) {
      noteFatal(res)
      if (fatal === undefined && segments.length > 1) {
        // Batch failure: bisect and retry (§8.2).
        const mid = Math.ceil(segments.length / 2)
        await translateSegments(segments.slice(0, mid), sectionTitle, out)
        await translateSegments(segments.slice(mid), sectionTitle, out)
      } else {
        for (const segment of segments) out.set(segment, errorOf(res))
      }
      return
    }
    cached += res.cached
    const byId = new Map(res.result.segments.map(s => [s.id, s.text]))
    for (const segment of segments) {
      const text = byId.get(segment.id)
      if (text !== undefined && validate(text, segment.protected).ok) out.set(segment, { fragment: rehydrate(text, segment.protected, doc) })
      else out.set(segment, await retrySingle(segment, sectionTitle))
    }
  }

  // No layout reads when inserting translations; native browser scroll anchoring stabilizes the viewport (§10).
  async function processBatch(batch: Batch): Promise<void> {
    const targets = batch.kind === 'table' && batch.block ? [batch.block] : batch.segments.map(s => s.block)
    // Insert pending nodes before sending requests (§7.6).
    for (const block of targets) {
      outcome.set(block, 'requested')
      renderPending(block)
    }
    rendered(targets)
    report()
    const out: BatchResult = new Map()
    await translateSegments(batch.segments, batch.sectionTitle, out)
    if (stopped) return // stop() already removed pending nodes; do not report again.
    if (batch.kind === 'table' && batch.block) {
      const cells = new Map<Element, DocumentFragment>()
      let reason = 'Unknown error'
      for (const [segment, result] of out) {
        if ('fragment' in result) { if (segment.cell) cells.set(segment.cell.el, result.fragment) }
        else reason = result.error
      }
      // Any failed cell fails the table (Codex #9); show the partial clone and keep the original translated with a partial flag (Codex #30).
      if (cells.size === batch.segments.length) {
        renderTable(batch.block, cells)
        outcome.set(batch.block, 'done')
      } else {
        if (cells.size > 0) {
          renderTable(batch.block, cells)
          markPartial(batch.block)
        } else {
          renderFailed(batch.block, reason, () => { void translate([batch.block!]) })
        }
        outcome.set(batch.block, 'failed')
      }
    } else {
      for (const segment of batch.segments) {
        const result = out.get(segment)
        if (result && 'fragment' in result) {
          renderText(segment.block as TextBlock, result.fragment)
          outcome.set(segment.block, 'done')
        } else {
          // Remove pending and previous translations: after changing engine / target, failure must not leave stale text (Codex #9).
          // Insert a failure widget with reason and retry (§7.6).
          renderFailed(segment.block, result?.error ?? 'Unknown error', () => { void translate([segment.block]) })
          outcome.set(segment.block, 'failed')
        }
      }
    }
    rendered(targets)
    report()
  }

  async function translate(picked: Block[]): Promise<void> {
    if (halted()) return
    const fresh = picked.filter(block => outcome.has(block) && outcome.get(block) !== 'requested')
    if (fresh.length === 0) return
    scheduler?.claim(fresh)
    const batches = planBatches(fresh, { maxBatchChars: options.capabilities.maxBatchChars, maxBatchItems: options.capabilities.maxBatchItems }, block => sectionOf.get(block))
    // Send batches directly to the service; the ported request-queue controls in-flight requests by rate (§8.2). No worker pool here.
    await Promise.all(batches.map(processBatch))
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    scheduler?.disconnect()
    clearAllPending(doc)
  }

  const failed = () => blocks.filter(block => outcome.get(block) === 'failed')

  return { ready, translate, stop, progress, failed }
}
