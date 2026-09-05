// 翻译运行（DESIGN §4 数据流、§10 调度、§6.3 / §8.2 降级链）。content 侧的纯逻辑，通过 transport 与翻译服务通信。
// 会话式（照 Read Frog 的加载模式）：开始只打标记、把块交给一次性观察器；块进入视口（加预翻译距离）
// 才攒批发请求，请求前先插带圆环的 pending 节点（§7.6）。没有"整篇翻完"的终点，滚到哪翻到哪。
import { ID_ATTR, type Block, type TextBlock } from '@/core/extractor'
import type { TranslateContext } from '@/providers/types'
import { joinRuns, rehydrate, splitRuns, validate } from '@/core/protector'
import {
  clearAllPending, clearTranslation, enable, markPartial, renderPending, renderTable, renderText, setState, type Mode,
} from '@/core/renderer'
import { createLazyScheduler, type LazyScheduler, type PreloadOptions } from '@/core/scheduler/lazy'
import { createWorkPacer, pauseIfBudgetSpent } from '@/core/scheduler/pacer'
import type { RenderPath } from '@/cache/key'
import type { TranslateMessageResponse } from '@/entrypoints/background/translate-handler'
import type { TranslateCall } from '@/providers/translate-service'
import { planBatches, sectionTitles, type Batch, type Segment } from './batches'

export interface Progress {
  /** on：会话开着，滚动会继续触发；stopped：用户恢复原文或致命错误后停下 */
  state: 'idle' | 'on' | 'stopped'
  total: number
  /** 已进入视口、发出过请求的块 */
  requested: number
  done: number
  failed: number
  cached: number
  /** 请求中的块 */
  inFlight: number
  /** no-key / auth 之类继续也只会重复失败的错误；设置后不再发新批次 */
  fatal?: string
}

export type Transport = (request: TranslateCall) => Promise<TranslateMessageResponse>

export interface RunOptions {
  doc: Document
  blocks: Block[]
  target: string
  mode: Mode
  paper: string
  capabilities: { maxBatchChars: number; maxBatchItems: number; preservesMarkup: boolean }
  transport: Transport
  onProgress?: (progress: Progress) => void
  /** 论文级上下文（标题、摘要、术语表），每批都带；章节标题由批次自己补 */
  context?: TranslateContext
  /** 取消范围 = 会话 id：每次调用都带，stop 时由调用方撤销排队与在飞的请求（§10） */
  scope?: string
  /** 视口触发的距离与阈值（§10） */
  preload: PreloadOptions
}

export interface TranslationRun {
  /** 标记与观察器就绪（标记是切片进行的，让出主线程） */
  ready: Promise<void>
  /** 把这些块排进去翻：观察器进入、重试、测试都走这里；请求中的块跳过 */
  translate(blocks: Block[]): Promise<void>
  /** 结束会话：断开观察器、删掉 pending 节点，之后不再渲染也不再上报 */
  stop(): void
  progress(): Progress
}

const FATAL_KINDS = new Set(['no-key', 'auth'])

type Outcome = 'waiting' | 'requested' | 'done' | 'failed'
type BatchResult = Map<Segment, DocumentFragment | null>

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
  const halted = () => stopped || fatal !== undefined

  enable(doc, options.mode)
  const sectionOf = sectionTitles(blocks)

  // 标记切片进行：几百个块的属性写入一口气做会冻住页面（Read Frog 的 #1881）
  const ready = (async () => {
    const pacer = createWorkPacer()
    for (const block of blocks) {
      block.el.setAttribute(ID_ATTR, block.id)
      setState(block, 'pending')
      await pauseIfBudgetSpent(pacer)
    }
    if (halted()) return
    scheduler = createLazyScheduler(blocks, { ...options.preload, onEnter: entered => { void translate(entered) } })
  })()

  const send = (items: { id: string; text: string }[], renderPath: RenderPath, sectionTitle?: string, opts: { bypassCache?: boolean; accept?: TranslateCall['accept'] } = {}) => {
    const context: TranslateContext = { ...options.context, ...(sectionTitle ? { sectionTitle } : {}) }
    return transport({
      request: { segments: items, source: 'en', target: options.target, context: Object.keys(context).length ? context : undefined },
      cache: { paper: options.paper, renderPath, ...(opts.bypassCache ? { bypass: true } : {}) },
      ...(opts.accept ? { accept: opts.accept } : {}),
      ...(options.scope ? { scope: options.scope } : {}),
    })
  }

  /** markup 路径的译文只有通过占位符校验才写缓存：坏译文入了库，每次都要先读到它再花一次请求（Codex 在 #30 指出） */
  const acceptFor = (segments: Segment[]): NonNullable<TranslateCall['accept']> => {
    const byId = new Map(segments.map(s => [s.id, s]))
    return (id, text) => {
      const segment = byId.get(id)
      return !segment || validate(text, segment.protected).ok
    }
  }

  const noteFatal = (res: Extract<TranslateMessageResponse, { ok: false }>) => {
    if (FATAL_KINDS.has(res.error.kind) && fatal === undefined) {
      fatal = `${res.error.kind}: ${res.error.message}`
      // 配置错了继续也只会重复失败：断开观察器，不再排新批次
      scheduler?.disconnect()
    }
  }

  /** runs 兜底（§6.5）：按 void 切段逐段翻译再拼回 */
  async function viaRuns(segment: Segment, sectionTitle?: string): Promise<DocumentFragment | null> {
    if (halted()) return null
    const layout = splitRuns(segment.protected)
    if (layout.runs.length === 0) return joinRuns([], layout, segment.protected, doc)
    const res = await send(layout.runs.map((text, i) => ({ id: `${segment.id}#r${i}`, text })), 'runs', sectionTitle)
    if (!res.ok) {
      noteFatal(res)
      return null
    }
    cached += res.cached
    const byId = new Map(res.result.segments.map(s => [s.id, s.text]))
    const texts = layout.runs.map((_, i) => byId.get(`${segment.id}#r${i}`))
    if (texts.some(t => t === undefined)) return null
    try {
      return joinRuns(texts as string[], layout, segment.protected, doc)
    } catch {
      return null
    }
  }

  /**
   * 占位符校验失败：单块重发一次，再失败走 runs（§6.3）。
   * 重发不读缓存：那份坏译文在校验之前就已经写进缓存，照常读只会原样拿回来（Codex 在 #9 指出）
   */
  async function retrySingle(segment: Segment, sectionTitle?: string): Promise<DocumentFragment | null> {
    if (halted()) return null
    const res = await send([{ id: segment.id, text: segment.text }], 'markup', sectionTitle, { bypassCache: true, accept: acceptFor([segment]) })
    if (res.ok) {
      cached += res.cached
      const text = res.result.segments[0]?.text
      if (text !== undefined && validate(text, segment.protected).ok) return rehydrate(text, segment.protected, doc)
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
    const res = await send(segments.map(s => ({ id: s.id, text: s.text })), 'markup', sectionTitle, { accept: acceptFor(segments) })
    if (stopped) return
    if (!res.ok) {
      noteFatal(res)
      if (fatal === undefined && segments.length > 1) {
        // 批次失败：对半拆分重试（§8.2）
        const mid = Math.ceil(segments.length / 2)
        await translateSegments(segments.slice(0, mid), sectionTitle, out)
        await translateSegments(segments.slice(mid), sectionTitle, out)
      } else {
        for (const segment of segments) out.set(segment, null)
      }
      return
    }
    cached += res.cached
    const byId = new Map(res.result.segments.map(s => [s.id, s.text]))
    for (const segment of segments) {
      const text = byId.get(segment.id)
      if (text !== undefined && validate(text, segment.protected).ok) out.set(segment, rehydrate(text, segment.protected, doc))
      else out.set(segment, await retrySingle(segment, sectionTitle))
    }
  }

  // 插入译文时不做任何布局读取：视口不跳由浏览器原生 scroll anchoring 负责（§10）
  async function processBatch(batch: Batch): Promise<void> {
    const targets = batch.kind === 'table' && batch.block ? [batch.block] : batch.segments.map(s => s.block)
    // 请求发出前先插 pending 节点（§7.6）
    for (const block of targets) {
      outcome.set(block, 'requested')
      renderPending(block)
    }
    report()
    const out: BatchResult = new Map()
    await translateSegments(batch.segments, batch.sectionTitle, out)
    if (stopped) return // stop() 已经把 pending 清掉、不再上报
    if (batch.kind === 'table' && batch.block) {
      const cells = new Map<Element, DocumentFragment>()
      for (const [segment, fragment] of out) if (fragment && segment.cell) cells.set(segment.cell.el, fragment)
      // 有一格没翻出来就算失败（Codex 在 #9 指出）；半份克隆照常显示，原表保持 translated 另加 partial 标记（Codex 在 #30 指出）
      if (cells.size === batch.segments.length) {
        renderTable(batch.block, cells)
        outcome.set(batch.block, 'done')
      } else {
        if (cells.size > 0) {
          renderTable(batch.block, cells)
          markPartial(batch.block)
        } else {
          clearTranslation(batch.block)
          setState(batch.block, 'failed')
        }
        outcome.set(batch.block, 'failed')
      }
    } else {
      for (const segment of batch.segments) {
        const fragment = out.get(segment)
        if (fragment) {
          renderText(segment.block as TextBlock, fragment)
          outcome.set(segment.block, 'done')
        } else {
          // 删掉 pending 与上一轮的译文：换了引擎 / 目标语言后再翻失败，页面不能还挂着旧译文（Codex 在 #9 指出）
          clearTranslation(segment.block)
          setState(segment.block, 'failed')
          outcome.set(segment.block, 'failed')
        }
      }
    }
    report()
  }

  async function translate(picked: Block[]): Promise<void> {
    if (halted()) return
    const fresh = picked.filter(block => outcome.has(block) && outcome.get(block) !== 'requested')
    if (fresh.length === 0) return
    scheduler?.claim(fresh)
    const batches = planBatches(fresh, { maxBatchChars: options.capabilities.maxBatchChars, maxBatchItems: options.capabilities.maxBatchItems }, block => sectionOf.get(block))
    // 批次直接交给服务：在飞数量由移植的 request-queue 按速率兜住（§8.2），这里不再有 worker 池
    await Promise.all(batches.map(processBatch))
  }

  function stop(): void {
    if (stopped) return
    stopped = true
    scheduler?.disconnect()
    clearAllPending(doc)
  }

  return { ready, translate, stop, progress }
}
