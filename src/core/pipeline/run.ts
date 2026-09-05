// 翻译运行循环（DESIGN §4 数据流、§6.3 / §8.2 降级链）。content 侧的纯逻辑，通过 transport 与 background 通信。
import { markBlocks, type TextBlock } from '@/core/extractor'
import type { TranslateContext } from '@/providers/types'
import { joinRuns, rehydrate, splitRuns, validate } from '@/core/protector'
import { enable, renderTable, renderText, setState, type Mode } from '@/core/renderer'
import type { RenderPath } from '@/cache/key'
import type { TranslateMessageRequest, TranslateMessageResponse } from '@/entrypoints/background/translate-handler'
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

export type Transport = (request: TranslateMessageRequest) => Promise<TranslateMessageResponse>

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
  /** content 侧同时在飞的批次数；background 的 p-queue 再按 provider 限流 */
  concurrency?: number
  /** 视口优先（§10）：取下一批时优先取含此谓词为真的块的批次 */
  isPriority?: (block: Block) => boolean
  /** 论文级上下文（标题、摘要、术语表），每批都带；章节标题由批次自己补 */
  context?: TranslateContext
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

  const send = (items: { id: string; text: string }[], renderPath: RenderPath, sectionTitle?: string) => {
    const context: TranslateContext = { ...options.context, ...(sectionTitle ? { sectionTitle } : {}) }
    return transport({
      request: { segments: items, source: 'en', target: options.target, context: Object.keys(context).length ? context : undefined },
      cache: { paper: options.paper, renderPath },
    })
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

  /** 占位符校验失败：单块重发一次，再失败走 runs（§6.3） */
  async function retrySingle(segment: Segment, sectionTitle?: string): Promise<DocumentFragment | null> {
    if (stopped()) return null
    const res = await send([{ id: segment.id, text: segment.text }], 'markup', sectionTitle)
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
    const res = await send(segments.map(s => ({ id: s.id, text: s.text })), 'markup', sectionTitle)
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
      if (cells.size > 0) {
        renderTable(batch.block!, cells)
        progress.done++
      } else {
        setState(batch.block, 'failed')
        progress.failed++
      }
    } else {
      for (const segment of batch.segments) {
        const fragment = out.get(segment)
        if (fragment) {
          renderText(segment.block as TextBlock, fragment)
          progress.done++
        } else {
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
