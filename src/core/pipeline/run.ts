// 翻译运行循环（DESIGN §4 数据流、§6.3 / §8.2 降级链）。content 侧的纯逻辑，通过 transport 与 background 通信。
import { markBlocks, type TextBlock } from '@/core/extractor'
import type { TranslateContext } from '@/providers/types'
import { joinRuns, rehydrate, splitRuns, validate } from '@/core/protector'
import { clearTranslation, enable, markPartial, renderTable, renderText, setState, type Mode } from '@/core/renderer'
import type { RenderPath } from '@/cache/key'
import type { TranslateMessageResponse } from '@/entrypoints/background/translate-handler'
import type { TranslateCall } from '@/providers/translate-service'
import { planBatches, type Batch, type Segment } from './batches'
import type { Block } from '@/core/extractor'

export interface Progress {
  state: 'idle' | 'running' | 'done' | 'cancelled'
  total: number
  done: number
  failed: number
  cached: number
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
  signal?: AbortSignal
  /** content 侧同时在飞的批次数；translate-service 里移植的 request-queue 再按 provider 的速率限流（§8.2） */
  concurrency?: number
  /** 视口优先（§10）：取下一批时优先取含此谓词为真的块的批次 */
  isPriority?: (block: Block) => boolean
  /** 论文级上下文（标题、摘要、术语表），每批都带；章节标题由批次自己补 */
  context?: TranslateContext
  /** 取消范围：每次运行一个 id，恢复原文时 translate-service 按它撤掉排队与在飞的请求（§10） */
  scope?: string
}

const FATAL_KINDS = new Set(['no-key', 'auth'])

type Outcome = Map<Segment, DocumentFragment | null>

export async function runTranslation(options: RunOptions): Promise<Progress> {
  const { doc, blocks, transport } = options
  const progress: Progress = { state: 'running', total: blocks.length, done: 0, failed: 0, cached: 0 }
  const report = () => options.onProgress?.({ ...progress })
  const aborted = () => options.signal?.aborted === true
  const stopped = () => aborted() || progress.fatal !== undefined

  enable(doc, options.mode)
  markBlocks(blocks)
  for (const block of blocks) setState(block, 'pending')

  type SendOptions = { bypassCache?: boolean; accept?: TranslateCall['accept'] }
  const send = (items: { id: string; text: string }[], renderPath: RenderPath, sectionTitle?: string, opts: SendOptions = {}) => {
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
    if (FATAL_KINDS.has(res.error.kind)) progress.fatal = `${res.error.kind}: ${res.error.message}`
  }

  /** runs 兜底（§6.5）：按 void 切段逐段翻译再拼回 */
  async function viaRuns(segment: Segment, sectionTitle?: string): Promise<DocumentFragment | null> {
    if (stopped()) return null
    const layout = splitRuns(segment.protected)
    if (layout.runs.length === 0) return joinRuns([], layout, segment.protected, doc)
    const res = await send(layout.runs.map((text, i) => ({ id: `${segment.id}#r${i}`, text })), 'runs', sectionTitle)
    if (!res.ok) {
      noteFatal(res)
      return null
    }
    progress.cached += res.cached
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
    if (stopped()) return null
    const res = await send([{ id: segment.id, text: segment.text }], 'markup', sectionTitle, { bypassCache: true, accept: acceptFor([segment]) })
    if (res.ok) {
      progress.cached += res.cached
      const text = res.result.segments[0]?.text
      if (text !== undefined && validate(text, segment.protected).ok) return rehydrate(text, segment.protected, doc)
    } else {
      noteFatal(res)
    }
    return viaRuns(segment, sectionTitle)
  }

  async function translateSegments(segments: Segment[], sectionTitle: string | undefined, out: Outcome): Promise<void> {
    if (stopped()) return
    if (!options.capabilities.preservesMarkup) {
      for (const segment of segments) out.set(segment, await viaRuns(segment, sectionTitle))
      return
    }
    const res = await send(segments.map(s => ({ id: s.id, text: s.text })), 'markup', sectionTitle, { accept: acceptFor(segments) })
    if (aborted()) return
    if (!res.ok) {
      noteFatal(res)
      if (progress.fatal === undefined && segments.length > 1) {
        // 批次失败：对半拆分重试（§8.2）
        const mid = Math.ceil(segments.length / 2)
        await translateSegments(segments.slice(0, mid), sectionTitle, out)
        await translateSegments(segments.slice(mid), sectionTitle, out)
      } else {
        for (const segment of segments) out.set(segment, null)
      }
      return
    }
    progress.cached += res.cached
    const byId = new Map(res.result.segments.map(s => [s.id, s.text]))
    for (const segment of segments) {
      const text = byId.get(segment.id)
      if (text !== undefined && validate(text, segment.protected).ok) out.set(segment, rehydrate(text, segment.protected, doc))
      else out.set(segment, await retrySingle(segment, sectionTitle))
    }
  }

  // 插入译文时不做任何布局读取：视口不跳由浏览器原生 scroll anchoring 负责（§10）。
  // 每批强制一次布局在 side 模式下要 130–150ms，8 个 worker 一百多批就是十几秒的主线程时间
  async function processBatch(batch: Batch): Promise<void> {
    const out: Outcome = new Map()
    await translateSegments(batch.segments, batch.sectionTitle, out)
    if (aborted()) return
    if (batch.kind === 'table' && batch.block) {
      const cells = new Map<Element, DocumentFragment>()
      for (const [segment, fragment] of out) if (fragment && segment.cell) cells.set(segment.cell.el, fragment)
      // 有一格没翻出来就算失败，用户能分辨"翻了一半"与"翻完了"（Codex 在 #9 指出）。
      // 半份克隆照常显示：原表保持 translated（only 模式仍只显示克隆），另加 partial 标记；
      // 直接标 failed 会让 only 模式把原表与半份克隆一起露出来（Codex 在 #30 指出）
      if (cells.size === batch.segments.length) {
        renderTable(batch.block, cells)
        progress.done++
      } else {
        if (cells.size > 0) {
          renderTable(batch.block, cells)
          markPartial(batch.block)
        } else {
          clearTranslation(batch.block)
          setState(batch.block, 'failed')
        }
        progress.failed++
      }
    } else {
      for (const segment of batch.segments) {
        const fragment = out.get(segment)
        if (fragment) {
          renderText(segment.block as TextBlock, fragment)
          progress.done++
        } else {
          clearTranslation(segment.block)
          setState(segment.block, 'failed')
          progress.failed++
        }
      }
    }
    // 两种批次都要上报：表格批次曾经 return 得太早，popup 计数与 side prep 都收不到（Codex 在 #26 指出）
    report()
  }

  const queue = planBatches(blocks, { maxBatchChars: options.capabilities.maxBatchChars, maxBatchItems: options.capabilities.maxBatchItems })
  // 视口优先：每次取批都重新评估，滚动后自然生效；没有优先批次就按文档序
  const pickNext = (): Batch | undefined => {
    const isPriority = options.isPriority
    if (isPriority) {
      const index = queue.findIndex(batch => batch.segments.some(segment => isPriority(segment.block)))
      if (index > 0) return queue.splice(index, 1)[0]
    }
    return queue.shift()
  }
  const workers = Array.from({ length: Math.max(1, options.concurrency ?? 8) }, async () => {
    for (;;) {
      const batch = pickNext()
      if (!batch || stopped()) return
      await processBatch(batch)
    }
  })
  await Promise.all(workers)

  progress.state = aborted() ? 'cancelled' : 'done'
  report()
  return { ...progress }
}
