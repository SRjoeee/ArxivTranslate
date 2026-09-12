// 翻译运行（DESIGN §4 数据流、§10 调度、§6.3 / §8.2 降级链）。content 侧的纯逻辑，通过 transport 与翻译服务通信。
// 会话式（照 Read Frog 的加载模式）：开始只打标记、把块交给一次性观察器；块进入视口（加预翻译距离）
// 才攒批发请求，请求前先插带圆环的 pending 节点（§7.6）。没有"整篇翻完"的终点，滚到哪翻到哪。
import { toBcp47 } from '@/config/languages'
import { ID_ATTR, type Block, type TextBlock } from '@/core/extractor'
import type { SentenceAlignment } from '@/providers/alignment'
import { isPermanentErrorKind, type TranslateContext } from '@/providers/types'
import { joinRuns, rehydrate, splitRuns, validate, type WireSpan } from '@/core/protector'
import {
  clearAllPending, enable, markPartial, registerSentences, renderFailed, renderPending, renderTable, renderText, setState, type Look, type Mode,
} from '@/core/renderer'
import { createLazyScheduler, type LazyScheduler, type PreloadOptions } from '@/core/scheduler/lazy'
import { createWorkPacer, pauseIfBudgetSpent } from '@/core/scheduler/pacer'
import type { RenderPath } from '@/cache/key'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import { planBatches, sectionTitles, type Batch, type Segment } from './batches'
import { cutsOf } from './sentences'

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
  /** The reader's active appearance (§7.5); without it the page keeps whatever attributes it has */
  appearance?: Look
  paper: string
  capabilities: { maxBatchChars: number; maxBatchItems: number; renderPath: RenderPath }
  transport: Transport
  onProgress?: (progress: Progress) => void
  /**
   * 这一批块刚在 DOM 上动过（插了圆环 / 译文 / 失败小部件），每批两次、与 onProgress 同步（issue #46）。
   * 单独一个回调而不塞进 Progress：Progress 要发给 popup，必须可序列化，Block 带着 DOM 节点
   */
  onRendered?: (blocks: Block[]) => void
  /**
   * The service that actually served a batch, reported when it changes (the first batch, then
   * every hand-over down the chain). The caller decides what a hand-over means for the page
   */
  onProvider?: (id: string) => void
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
  /** 翻失败的块（文档序）；popup 的"重试失败"把它们再交给 translate */
  failed(): Block[]
}

type Outcome = 'waiting' | 'requested' | 'done' | 'failed'
/**
 * 一段的结果：译文，或失败原因（给失败态小部件看，§7.6）。
 *
 * `alignment` 只有引擎报了句边界、且两边都能重建时才在（`alignment.ts`），用来登记悬停高亮。
 * `fragment.offsets` 同理只有 `rehydrate` 那条路有：runs 兜底拼出来的 fragment 没有线上偏移，
 * 那样的块登记不了，悬停无反应——比把高亮打在错的句子上好（issue #105）。
 */
type SegmentResult = { fragment: DocumentFragment & { offsets?: WireSpan[] }; alignment?: SentenceAlignment } | { error: string }
type BatchResult = Map<Segment, SegmentResult>
/**
 * 失败原因一律写成 `kind: 诊断`，与 provider 的错误同一个形状（`parseFatal` 读的就是它）：
 * 读者看到的是按界面语言写的那一句，`kind` 之后那半句是给诊断用的，不进界面（Codex 在 #161 指出）
 */
const CANCELLED: SegmentResult = { error: 'aborted: 已取消' }
const MISMATCH: SegmentResult = { error: 'invalid-response: 译文的占位符与原文对不上' }
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
  // 不另设 stopped 守卫：第一次调用在 translate() 的 halted() 检查与本批之间没有让出主线程，
  // 第二次在 `if (stopped) return` 之后——那条 return 就是守卫，这里再判一次是测不到的死代码
  const rendered = (blocks: Block[]) => options.onRendered?.(blocks)
  const halted = () => stopped || fatal !== undefined
  let lastProvider: string | undefined
  const served = (id: string) => {
    if (id === lastProvider) return
    lastProvider = id
    options.onProvider?.(id)
  }

  // 译文语言进 <html>，renderText 逐个写到译文节点上：页面的 lang 说的是原文（arXiv 上是 en），
  // 不标的话屏幕阅读器会用英文语音念中文
  enable(doc, options.mode, options.appearance, toBcp47(options.target))
  const sectionOf = sectionTitles(blocks)

  // 块标记一次性写完，不切片（issue #67）：side prep 的两道闸都看 data-axt-id——
  // 一个"内部还有未标记块"的容器会被当成静态内容**整块克隆**到右栏，等里面的块翻译出来，
  // 右栏就多出一整段英文。实测（标记切片进行时跑三趟 prep）2312.17141 36 处、
  // 2609.00245 87 处，都是 .ltx_para / .ltx_proof / .ltx_theorem 这样的大块。
  // 切片当初是防"几百个属性写入冻住页面"（Read Frog 的 #1881），但那笔账不成立：
  // 循环里全是属性写入、不读布局，Chromium 实测 979 块写满 1.2 ms、随后强制布局 0 ms。
  // 同步写完还顺带解决了 halted() 的竞态——中间没有 await，restore 插不进来
  for (const block of blocks) block.el.setAttribute(ID_ATTR, block.id)

  // 状态属性仍然切片：它带样式（pending 的骨架屏），且不影响 side prep 的判定
  const ready = (async () => {
    const pacer = createWorkPacer()
    for (const block of blocks) {
      // 每写一个块之前都要看会话还在不在：让出主线程期间用户可能已经"恢复原文"，
      // 循环外才检查的话，restore 清干净之后这里会继续往 DOM 上写状态，
      // 页面留下孤儿 data-axt-*（§7.1 的不变量被破坏，issue #45 的实验 1）
      if (halted()) return
      setState(block, 'pending')
      await pauseIfBudgetSpent(pacer)
    }
    if (halted()) return
    scheduler = createLazyScheduler(blocks, { ...options.preload, onEnter: entered => { void translate(entered) } })
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
   * 句子边界随请求一起送下去（§8.6）。选切点要看块本身——占位符是注解还是公式、这一块是不是
   * 参考文献——而服务层只有线上文本，所以决定在这里做，服务层只按位置插标记
   */
  const cutsFor = (segment: Segment): { cuts?: number[] } => {
    const cuts = cutsOf(segment, options.capabilities.renderPath)
    // 空数组要照样送：它说的是「这一块只有一句，整段对整段」，与「这一块不该对齐」不同
    return cuts === undefined ? {} : { cuts }
  }

  const noteFatal = (res: Extract<TranslateMessageResponse, { ok: false }>) => {
    if (isPermanentErrorKind(res.error.kind) && fatal === undefined) {
      fatal = `${res.error.kind}: ${res.error.message}`
      // 配置错了继续也只会重复失败：断开观察器，不再排新批次
      scheduler?.disconnect()
    }
  }

  /** runs 兜底（§6.5）：按 void 切段逐段翻译再拼回 */
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
    if (texts.some(t => t === undefined)) return { error: 'invalid-response: 译文条数与原文对不上' }
    try {
      return { fragment: joinRuns(texts as string[], layout, segment.protected, doc) }
    } catch {
      return MISMATCH
    }
  }

  /**
   * 占位符校验失败：单块重发一次，再失败走 runs（§6.3）。
   * 重发不读缓存：那份坏译文在校验之前就已经写进缓存，照常读只会原样拿回来（Codex 在 #9 指出）
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
    if (stopped) return
    if (!res.ok) {
      noteFatal(res)
      // 一次调用可能被拆到多个批次，一批失败不代表另一批没成：成功的那些随失败一起送回来，
      // 先把它们渲染掉（它们已经在缓存里，不渲染的话读者看到"全失败"，重试时又秒回）。
      // 余下的才进下面的判断（Codex 在 #163 指出）
      const done = new Map((res.partial ?? []).map(s => [s.id, s]))
      const left = segments.filter(segment => {
        const hit = done.get(segment.id)
        if (hit === undefined || !validate(hit.text, segment.protected).ok) return true
        out.set(segment, { fragment: rehydrate(hit.text, segment.protected, doc, hit.alignment), alignment: hit.alignment })
        return false
      })
      if (left.length === 0) return
      // 批次失败：**某一段引起的**才对半拆分重试（§8.2）。系统性失败拆了也是同一个结果，
      // 只是把它乘以段数——实测 4 段的 `bad-request` 会变成 7 次调用（`4,2,1,1,2,1,1`），
      // 限额类失败更是反效果。判据由 service 侧随错误一起送过来（providers/types.ts 的
      // `ISOLATABLE_BY_KIND`，provider 可以覆盖），content 这一层不再自己猜
      if (fatal === undefined && left.length > 1 && res.error.isolatable) {
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

  // 插入译文时不做任何布局读取：视口不跳由浏览器原生 scroll anchoring 负责（§10）
  async function processBatch(batch: Batch): Promise<void> {
    const targets = batch.kind === 'table' && batch.block ? [batch.block] : batch.segments.map(s => s.block)
    // 请求发出前先插 pending 节点（§7.6）
    for (const block of targets) {
      outcome.set(block, 'requested')
      renderPending(block)
    }
    rendered(targets)
    report()
    const out: BatchResult = new Map()
    await translateSegments(batch.segments, batch.sectionTitle, out)
    if (stopped) return // stop() 已经把 pending 清掉、不再上报
    if (batch.kind === 'table' && batch.block) {
      const cells = new Map<Element, DocumentFragment>()
      // 一格的原文侧偏移与对齐，等 renderTable 建出克隆格之后才登记得了（§7.7）
      const pairs = new Map<Element, { spans: readonly WireSpan[]; offsets?: WireSpan[]; alignment?: SentenceAlignment }>()
      let reason = 'unknown: 整批没有结果'
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
      // 有一格没翻出来就算失败（Codex 在 #9 指出）；半份克隆照常显示，原表保持 translated 另加 partial 标记（Codex 在 #30 指出）
      if (cells.size === batch.segments.length) {
        renderTable(batch.block, cells, renderedCells)
        registerCells()
        outcome.set(batch.block, 'done')
      } else {
        if (cells.size > 0) {
          renderTable(batch.block, cells, renderedCells)
          registerCells()
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
          const spans = result.fragment.offsets
          const node = renderText(segment.block as TextBlock, result.fragment)
          registerSentences(segment.block.el, node, segment.protected.offsets, spans, result.alignment)
          outcome.set(segment.block, 'done')
        } else {
          // 删掉 pending 与上一轮的译文（换了引擎 / 目标语言后再翻失败，页面不能还挂着旧译文，Codex 在 #9 指出），
          // 插失败态小部件：原因 + 重试（§7.6）
          renderFailed(segment.block, result?.error ?? 'unknown: 没有这一段的结果', () => { void translate([segment.block]) })
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
    const batches = planBatches(fresh, { maxBatchChars: options.capabilities.maxBatchChars, maxBatchItems: options.capabilities.maxBatchItems, renderPath: options.capabilities.renderPath }, block => sectionOf.get(block))
    // 批次直接交给服务：在飞数量由移植的 request-queue 按速率兜住（§8.2），这里不再有 worker 池
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
