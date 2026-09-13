// The translation run (DESIGN §4 data flow, §10 scheduling, §6.3 / §8.2 fallback chain). Pure logic on the content
// side, talking to the translation service through the transport. Session-style (after Read Frog's loading model):
// the start only marks the blocks and hands them to one-shot observers; a block entering the viewport (plus the
// preload distance) is batched and requested, with a pending node carrying a ring inserted first (§7.6). There is no
// “whole paper done” end: what is scrolled to is translated.
import { toBcp47 } from '@/config/languages'
import { ID_ATTR, type Block, type TextBlock } from '@/core/extractor'
import type { SentenceAlignment } from '@/providers/alignment'
import { isPermanentErrorKind, type TranslateContext } from '@/providers/types'
import { joinRuns, rehydrate, splitRuns, validate, type WireSpan } from '@/core/protector'
import {
  clearAllPending, enable, markPartial, registerSentences, renderFailed, renderPending, renderTable, renderText, setState, type Look, type Mode,
} from '@/core/renderer'
import { createRunLedger } from '@/core/run/ledger'
import type { PreloadOptions } from '@/core/scheduler/lazy'
import { createWorkPacer, pauseIfBudgetSpent } from '@/core/scheduler/pacer'
import type { RenderPath } from '@/cache/key'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import { planBatches, sectionTitles, type Batch, type Segment } from './batches'
import { cutsOf } from './sentences'

export interface Progress {
  /** on: the session is open and scrolling keeps triggering; stopped: the reader restored the original, or a fatal error stopped it */
  state: 'idle' | 'on' | 'stopped'
  total: number
  /** Blocks that entered the viewport and were requested */
  requested: number
  done: number
  failed: number
  cached: number
  /** Blocks in flight */
  inFlight: number
  /** An error like no-key / auth that would only fail again; once set, no new batch goes out */
  fatal?: string
}

export type Transport = (request: TranslateCall) => Promise<TranslateMessageResponse>

export interface RunOptions {
  doc: Document
  blocks: Block[]
  target: string
  mode: Mode
  /** The reader's active appearance (§7.5); without it the page keeps whatever attributes it has */
  appearance?: Look
  paper: string
  capabilities: { maxBatchChars: number; maxBatchItems: number; renderPath: RenderPath }
  transport: Transport
  onProgress?: (progress: Progress) => void
  /**
   * These blocks just touched the DOM (a ring / a translation / a failure widget inserted), twice per batch and in
   * step with onProgress (issue #46). A callback of its own rather than a field of Progress: Progress goes to the
   * popup and must be serialisable, and a Block carries DOM nodes
   */
  onRendered?: (blocks: Block[]) => void
  /**
   * The service that actually served a batch, reported when it changes (the first batch, then
   * every hand-over down the chain). The caller decides what a hand-over means for the page
   */
  onProvider?: (id: string) => void
  /** The paper-level context (title, abstract, glossary), carried by every batch; the section heading is filled in by the batch itself */
  context?: TranslateContext
  /** The cancellation scope = the session id: carried by every call, and on stop the caller withdraws the queued and in-flight requests (§10) */
  scope?: string
  /** The viewport trigger distance and threshold (§10) */
  preload: PreloadOptions
}

export interface TranslationRun {
  /** The marks and the observers are ready (marking is sliced, yielding the main thread) */
  ready: Promise<void>
  /** Queue these blocks for translation: observer entry, retries and tests all come through here; blocks in flight are skipped */
  translate(blocks: Block[]): Promise<void>
  /** End the session: disconnect the observers, remove the pending nodes; nothing is rendered or reported after */
  stop(): void
  progress(): Progress
  /** The blocks whose translation failed (document order); the popup's “retry failed” hands them to translate again */
  failed(): Block[]
}

/**
 * A segment's result: the translation, or the reason it failed (for the failure widget, §7.6).
 *
 * `alignment` is present only when the engine reported sentence boundaries and both sides could be rebuilt
 * (`alignment.ts`), to register the hover highlight. `fragment.offsets` likewise exists on the `rehydrate` path only:
 * a fragment the runs fallback assembled has no wire offsets, such a block cannot be registered, and hovering does
 * nothing — better than a highlight on the wrong sentence (issue #105).
 */
type SegmentResult = { fragment: DocumentFragment & { offsets?: WireSpan[] }; alignment?: SentenceAlignment } | { error: string }
type BatchResult = Map<Segment, SegmentResult>
/**
 * A failure reason is always written as `kind: diagnostic`, the shape of a provider error (`parseFatal` reads it):
 * the reader sees the sentence in the interface's language, and the half after `kind` is for diagnosis and never
 * reaches the interface (Codex on #161)
 */
const CANCELLED: SegmentResult = { error: 'aborted: cancelled' }
const MISMATCH: SegmentResult = { error: 'invalid-response: the translation placeholders do not match the source' }
const errorOf = (res: Extract<TranslateMessageResponse, { ok: false }>): SegmentResult => ({ error: `${res.error.kind}: ${res.error.message}` })

export function startTranslation(options: RunOptions): TranslationRun {
  const { doc, blocks, transport } = options
  // The bookkeeping shared with the image run (ADR-0006): outcomes, the permanent-error record, stop, the scheduler
  const ledger = createRunLedger(blocks, {
    preload: options.preload,
    onEnter: entered => { void translate(entered) },
    onStop: () => clearAllPending(doc),
  })
  let cached = 0

  const progress = (): Progress => {
    const counts = ledger.progress()
    return { state: ledger.halted() ? 'stopped' : 'on', ...counts, cached, inFlight: counts.requested - counts.done - counts.failed }
  }
  const report = () => {
    if (!ledger.stopped()) options.onProgress?.(progress())
  }
  // No separate stopped guard: on the first call nothing yields the main thread between translate()'s halted() check
  // and this batch, and on the second the `if (stopped) return` above is the guard — a second check here would be dead code no test could reach
  const rendered = (blocks: Block[]) => options.onRendered?.(blocks)
  const halted = () => ledger.halted()
  let lastProvider: string | undefined
  const served = (id: string) => {
    if (id === lastProvider) return
    lastProvider = id
    options.onProvider?.(id)
  }

  // The translation's language goes on <html>, and renderText writes it onto each translation node: the page's lang
  // names the original (en on arXiv), and unmarked, a screen reader would read Chinese in an English voice
  enable(doc, options.mode, options.appearance, toBcp47(options.target))
  const sectionOf = sectionTitles(blocks)

  // The block marks are written at once, unsliced (issue #67): both gates of side prep read data-axt-id — a
  // container “with unmarked blocks still inside” would be taken for static content and **cloned whole** into the
  // right column, and once the blocks inside were translated the right column would hold a whole extra passage of
  // English. Measured (three prep passes while marking was sliced): 36 places on 2312.17141, 87 on 2609.00245, all
  // large blocks like .ltx_para / .ltx_proof / .ltx_theorem. The slicing was meant to prevent “hundreds of attribute
  // writes freezing the page” (Read Frog's #1881), but the sum does not add up: the loop is attribute writes only with
  // no layout read, and Chromium measured 979 blocks written in 1.2 ms with a forced layout of 0 ms afterwards.
  // Writing synchronously also settles the halted() race along the way — no await in between, restore cannot get in
  for (const block of blocks) block.el.setAttribute(ID_ATTR, block.id)

  // The state attribute is still sliced: it carries styling (the pending skeleton) and does not affect side prep's decisions
  const ready = (async () => {
    const pacer = createWorkPacer()
    for (const block of blocks) {
      // Before each block is written the session has to be checked: while the main thread was yielded the reader may
      // have “restored the original”; checked outside the loop only, this would keep writing states onto the DOM after
      // restore cleaned it, leaving orphan data-axt-* on the page (the invariant of §7.1 broken, experiment 1 of issue #45)
      if (halted()) return
      setState(block, 'pending')
      await pauseIfBudgetSpent(pacer)
    }
    if (halted()) return
    ledger.observe()
  })()

  const send = (items: { id: string; text: string; cuts?: number[] }[], renderPath: RenderPath, sectionTitle?: string, opts: { bypassCache?: boolean } = {}) => {
    const context: TranslateContext = { ...options.context, ...(sectionTitle ? { sectionTitle } : {}) }
    return transport({
      request: { segments: items, source: 'en', target: options.target, context: Object.keys(context).length ? context : undefined },
      cache: { paper: options.paper, renderPath, ...(opts.bypassCache ? { bypass: true } : {}) },
      ...(options.scope ? { scope: options.scope } : {}),
    })
  }

  /**
   * The sentence boundaries travel with the request (§8.6). Choosing the cut points needs the block itself — is a
   * placeholder an annotation or a formula, is this block a reference — and the service has only the wire text, so
   * the decision is made here and the service only inserts markers by position
   */
  const cutsFor = (segment: Segment): { cuts?: number[] } => {
    const cuts = cutsOf(segment, options.capabilities.renderPath)
    // An empty array is sent all the same: it says “this block is one sentence, whole to whole”, unlike “this block is not aligned”
    return cuts === undefined ? {} : { cuts }
  }

  // A wrong configuration would only fail again: recorded, the observers disconnected, no new batch queued; the batches in flight finish as usual
  const noteFatal = (res: Extract<TranslateMessageResponse, { ok: false }>) => {
    if (isPermanentErrorKind(res.error.kind)) ledger.fatal(res.error.kind, res.error.message)
  }

  /** The runs fallback (§6.5): cut into runs at voids, translated run by run and joined back */
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
    served(res.result.provider)
    const byId = new Map(res.result.segments.map(s => [s.id, s.text]))
    const texts = layout.runs.map((_, i) => byId.get(`${segment.id}#r${i}`))
    if (texts.some(t => t === undefined)) return { error: 'invalid-response: the translation count does not match the source' }
    try {
      return { fragment: joinRuns(texts as string[], layout, segment.protected, doc) }
    } catch {
      return MISMATCH
    }
  }

  /**
   * Placeholder validation failed: the block alone is sent once more, and a second failure takes the runs path (§6.3).
   * The resend does not read the cache: the bad translation went into the cache before validation, and a normal read
   * would only bring it back as it is (Codex on #9)
   */
  async function retrySingle(segment: Segment, sectionTitle?: string): Promise<SegmentResult> {
    if (halted()) return CANCELLED
    const res = await send([{ id: segment.id, text: segment.text, ...cutsFor(segment) }], options.capabilities.renderPath, sectionTitle, { bypassCache: true })
    if (res.ok) {
      cached += res.cached
      served(res.result.provider)
      const hit = res.result.segments[0]
      if (hit !== undefined && validate(hit.text, segment.protected).ok) return { fragment: rehydrate(hit.text, segment.protected, doc, hit.alignment), alignment: hit.alignment }
    } else {
      noteFatal(res)
    }
    return viaRuns(segment, sectionTitle)
  }

  async function translateSegments(segments: Segment[], sectionTitle: string | undefined, out: BatchResult): Promise<void> {
    if (halted()) return
    if (options.capabilities.renderPath === 'runs') {
      for (const segment of segments) out.set(segment, await viaRuns(segment, sectionTitle))
      return
    }
    const res = await send(segments.map(s => ({ id: s.id, text: s.text, ...cutsFor(s) })), options.capabilities.renderPath, sectionTitle)
    if (ledger.stopped()) return
    if (!res.ok) {
      noteFatal(res)
      // One call may be cut into several batches, and one batch failing does not mean another did not succeed: the
      // successful ones come back with the failure and are rendered first (they are in the cache already; unrendered
      // the reader would see “all failed” and a retry would answer instantly). Only the rest goes into the judgement
      // below (Codex on #163)
      const done = new Map((res.partial ?? []).map(s => [s.id, s]))
      const left = segments.filter(segment => {
        const hit = done.get(segment.id)
        if (hit === undefined || !validate(hit.text, segment.protected).ok) return true
        out.set(segment, { fragment: rehydrate(hit.text, segment.protected, doc, hit.alignment), alignment: hit.alignment })
        return false
      })
      if (left.length === 0) return
      // A batch failure: only one **caused by some segment** is split in half and retried (§8.2). A systemic failure
      // gives the same result split, only multiplied by the segment count — measured: a `bad-request` over 4 segments
      // became 7 calls (`4,2,1,1,2,1,1`), and a quota failure is worse than useless. The criterion comes from the
      // service side with the error (`ISOLATABLE_BY_KIND` of providers/types.ts, a provider may override it); the
      // content layer no longer guesses for itself
      if (ledger.fatalReason() === undefined && left.length > 1 && res.error.isolatable) {
        const mid = Math.ceil(left.length / 2)
        await translateSegments(left.slice(0, mid), sectionTitle, out)
        await translateSegments(left.slice(mid), sectionTitle, out)
      } else {
        for (const segment of left) out.set(segment, errorOf(res))
      }
      return
    }
    cached += res.cached
    served(res.result.provider)
    const byId = new Map(res.result.segments.map(s => [s.id, s]))
    for (const segment of segments) {
      const hit = byId.get(segment.id)
      if (hit !== undefined && validate(hit.text, segment.protected).ok) out.set(segment, { fragment: rehydrate(hit.text, segment.protected, doc, hit.alignment), alignment: hit.alignment })
      else out.set(segment, await retrySingle(segment, sectionTitle))
    }
  }

  // No layout is read when translations are inserted: the browser's native scroll anchoring keeps the viewport from jumping (§10)
  async function processBatch(batch: Batch): Promise<void> {
    const targets = batch.kind === 'table' && batch.block ? [batch.block] : batch.segments.map(s => s.block)
    // The pending nodes go in before the request goes out (§7.6)
    ledger.request(targets)
    for (const block of targets) renderPending(block)
    rendered(targets)
    report()
    const out: BatchResult = new Map()
    await translateSegments(batch.segments, batch.sectionTitle, out)
    if (ledger.stopped()) return // stop() has cleared the pending nodes already and reports no more
    if (batch.kind === 'table' && batch.block) {
      const cells = new Map<Element, DocumentFragment>()
      // A cell's source-side offsets and alignment can only be registered once renderTable has built the clone cell (§7.7)
      const pairs = new Map<Element, { spans: readonly WireSpan[]; offsets?: WireSpan[]; alignment?: SentenceAlignment }>()
      let reason = 'unknown: no result for the whole batch'
      for (const [segment, result] of out) {
        if ('fragment' in result) {
          if (!segment.cell) continue
          cells.set(segment.cell.el, result.fragment)
          pairs.set(segment.cell.el, { spans: segment.protected.offsets, offsets: result.fragment.offsets, alignment: result.alignment })
        } else reason = result.error
      }
      const renderedCells = new Map<Element, Element>()
      const registerCells = () => {
        for (const [cell, node] of renderedCells) {
          const p = pairs.get(cell)
          if (p) registerSentences(cell, node, p.spans, p.offsets, p.alignment)
        }
      }
      // One cell untranslated counts as a failure (Codex on #9); the half clone shows as usual, and the original table stays translated with a partial mark on top (Codex on #30)
      if (cells.size === batch.segments.length) {
        renderTable(batch.block, cells, renderedCells)
        registerCells()
        ledger.settle(batch.block, 'done')
      } else {
        if (cells.size > 0) {
          renderTable(batch.block, cells, renderedCells)
          registerCells()
          markPartial(batch.block)
        } else {
          renderFailed(batch.block, reason, () => { void translate([batch.block!]) })
        }
        ledger.settle(batch.block, 'failed', reason)
      }
    } else {
      for (const segment of batch.segments) {
        const result = out.get(segment)
        if (result && 'fragment' in result) {
          const spans = result.fragment.offsets
          const node = renderText(segment.block as TextBlock, result.fragment)
          registerSentences(segment.block.el, node, segment.protected.offsets, spans, result.alignment)
          ledger.settle(segment.block, 'done')
        } else {
          // The pending node and the previous round's translation are removed (after an engine / target-language change a
          // failed retranslation must not leave the old translation hanging; Codex on #9), and the failure widget goes in:
          // the reason + retry (§7.6)
          const reason = result?.error ?? 'unknown: no result for this segment'
          renderFailed(segment.block, reason, () => { void translate([segment.block]) })
          ledger.settle(segment.block, 'failed', reason)
        }
      }
    }
    rendered(targets)
    report()
  }

  async function translate(picked: Block[]): Promise<void> {
    const { taken } = ledger.intake(picked)
    if (taken.length === 0) return
    const batches = planBatches(taken, { maxBatchChars: options.capabilities.maxBatchChars, maxBatchItems: options.capabilities.maxBatchItems, renderPath: options.capabilities.renderPath }, block => sectionOf.get(block))
    // The batch goes straight to the service: the number in flight is held by the ported request-queue's rate limit (§8.2); no worker pool here any more
    await Promise.all(batches.map(processBatch))
  }

  return { ready, translate, stop: () => ledger.stop(), progress, failed: () => ledger.failed() }
}
