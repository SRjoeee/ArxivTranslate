// 译文到达后的整理（DESIGN §7.2 / §10，issue #46）：脚注归位、拆图、镜像、缩表、对齐边距。
//
// 以前每一趟都对整个 document 跑一遍五个步骤。实测 2312.17141：一次会话 31 趟、累计 1.9 秒，
// 而单独一趟只要 34 ms——代价全在重复，尤其两处：
//   - `createMirrors` 每趟用裸 `:has()` 扫 5 万节点，可译文到达根本不改变任何镜像判定
//     （块标记在会话开始就写完了，§7.3），第一趟之后全是白扫；
//   - `fitTables` 里 `measureColumn` 读 `gridTemplateColumns` 的解析值要强制布局，而它是三个写 DOM
//     的步骤之后第一个读几何的，整篇的强制布局都算在它头上（上游有写的趟 130–158 ms）。
//
// 现在：pipeline 每批把刚动过 DOM 的块交出来（`onRendered`），合并器攒成脏集合，每趟只整理这些块
// 所在的那几个容器；镜像整个会话只跑一次；栏宽在每趟**开头、写任何东西之前**读，且只在标记为
// 陈旧时读——prep 是 setTimeout 任务，开头那一刻浏览器刚渲染过，布局是干净的。
//
// 五个整理步骤的签名本来就收 `Document | Element`，这里只是终于给了它们一个更窄的根。
import { ID_ATTR } from '@/core/extractor'
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { createCoalescer, type Coalescer } from '@/core/scheduler/coalesce'
import { createMirrors } from './mirror'
import { localizeNotes } from './notes'
import { readPairMargins, writePairMargins, type PairMarginPlan } from './pair-margins'
import { dropStaleSplits, outermostFigure, splitFigures } from './split-figures'
import { fitTables, measureColumn, resetFitCache, watchFontLoads } from './table-fit'

export interface Prep {
  /** 这些块（或图片目标，§15）刚动过 DOM：排一趟只碰它们所在容器的整理 */
  touch(items: ReadonlyArray<{ el: Element }>): void
  /** 排一趟全量（进 side、栏宽变化、会话开始） */
  touchAll(): void
  /** 撤掉排着的那一趟（离开 side） */
  cancel(): void
  /** 新会话：镜像重新允许跑一次、量宽缓存清空、栏宽重读 */
  reset(): void
  /** 栏宽可能变了（窗口宽度变化）：下一趟开头重读 */
  refreshColumn(): void
}

export interface PrepOptions {
  isSide: () => boolean
  /** 每趟结束报一行（有变化时）；e2e 与手测靠它 */
  trace?: (line: string) => void
  /** 测试注入：栏宽 */
  columnWidth?: (root: Element) => number
  delay?: number
  maxWait?: number
}

/**
 * 一个脏块要整理的根：它的父元素（同容器里的配对，含相邻兄弟边距的那一对）、
 * 它所有祖先块各自的父元素（内层脚注先于外层块到达时外层的副本要能补上），
 * 以及它所在最外层 figure 的父元素（`splitFigures` 只扫后代，根得比 figure 高一层）。
 * 被别的根包含的根去掉——整理步骤都幂等，重复只是白做
 */
export function rootsOf(blocks: Iterable<Element>): Element[] {
  const roots = new Set<Element>()
  for (const el of blocks) {
    if (el.parentElement) roots.add(el.parentElement)
    for (let outer = el.parentElement?.closest(`[${ID_ATTR}]`); outer; outer = outer.parentElement?.closest(`[${ID_ATTR}]`)) {
      if (outer.parentElement) roots.add(outer.parentElement)
    }
    const fig = outermostFigure(el)
    if (fig?.parentElement) roots.add(fig.parentElement)
  }
  const list = Array.from(roots)
  return list.filter(r => !list.some(other => other !== r && other.contains(r)))
}

export function createPrep(doc: Document, options: PrepOptions): Prep {
  const columnWidth = options.columnWidth ?? measureColumn
  let mirrorsDone = false
  let columnStale = true
  let column = 0

  const run = (scope: Element[] | null) => {
    const t0 = performance.now()
    // 栏宽：写任何东西之前读。这一刻布局是干净的（上一帧刚渲染完），不会付整篇强制布局的钱。
    // 要拿**翻译根**去量，不是 <html>：measureColumn 靠 closest(DOCUMENT_ROOT) 找网格轨道，
    // 从 <html> 出发找不到、退路的 parentElement 又是 null，结果栏宽 0、整趟一张表都不缩
    //（e2e 抓到：1440px 下 0 张缩放、3 张超栏）
    if (options.isSide() && columnStale) {
      const root = doc.querySelector(DOCUMENT_ROOT) ?? doc.documentElement
      column = columnWidth(root)
      columnStale = false
    }
    const roots: Array<Document | Element> = scope === null ? [doc] : rootsOf(scope)
    // 边距先**读**：这一刻还没写任何东西，样式是干净的（上一帧刚渲染完，pipeline 插的译文早就算过了）。
    // 放到插节点之后再读，`:has()` 的失效会让这一次 getComputedStyle 花掉整篇重算的钱
    let margins: PairMarginPlan[] = options.isSide() ? roots.map(r => readPairMargins(r)) : []
    let notes = 0
    for (const r of roots) notes += localizeNotes(r)
    const t1 = performance.now()
    // 签名过期的拆图副本先丢掉：非 side 下叠加层进了被隐藏的原件那种（§15.2），回 side 全量再重建；
    // side 下也要——插图唯一的译文（叠加层）被摘掉后 needsSplit 为假、splitFigures 会跳过它，旧副本就一直挂着（Codex 在 #89 指出）
    for (const r of roots) dropStaleSplits(r)
    if (!options.isSide()) return

    // 先整块拆插图，再补镜像：拆过的插图不再参与镜像（两套方案会重复一份）
    let split = 0
    for (const r of roots) split += splitFigures(r)
    const t2 = performance.now()
    // 镜像整个会话只跑一次，而且要等块标记写完（否则整块克隆，issue #67）：
    // 判定全看 data-axt-id 与 .axt-t 兄弟，译文到达不会改变任何一处
    let made = 0
    if (scope === null && !mirrorsDone && doc.querySelector(`[${ID_ATTR}]`)) {
      made = createMirrors(doc)
      mirrorsDone = true
      // 镜像也是译文节点，同样受站点相邻兄弟规则影响，得在它们插进来之后再读一次——整个会话只有这一趟
      if (made) margins = [readPairMargins(doc)]
    }
    const t3 = performance.now()
    let fitted = 0
    let scrolled = 0
    for (const r of roots) {
      const fit = fitTables(r, { columnWidth: () => column })
      fitted += fit.fitted
      scrolled += fit.scrolled
    }
    const t4 = performance.now()
    // 边距最后**写**：读是趟开头做的
    let aligned = 0
    for (const plan of margins) aligned += writePairMargins(plan)
    const t5 = performance.now()

    // 每趟都报（包括什么都没做的）：累计耗时要把"白跑"的趟也算进去，e2e 的整理成本断言靠它
    options.trace?.(
      `side prep${scope === null ? ' (full)' : ` (${scope.length} blocks, ${roots.length} roots)`}: `
      + `+${split} figures split, +${made} mirrors, ${fitted} tables scaled, ${scrolled} scrollable, ${aligned} margins aligned, ${notes} notes localized; `
      + `notes=${(t1 - t0).toFixed(1)} split=${(t2 - t1).toFixed(1)} mirrors=${(t3 - t2).toFixed(1)} tables=${(t4 - t3).toFixed(1)} margins=${(t5 - t4).toFixed(1)} total=${(t5 - t0).toFixed(1)}ms`,
    )
  }

  const coalescer: Coalescer<Element> = createCoalescer(run, { delay: options.delay ?? 150, maxWait: options.maxWait ?? 1000 })
  // 字体加载完成：自然宽度变了（缓存由 watchFontLoads 清），栏宽也顺手重读一次，然后全量整理一趟
  watchFontLoads(doc, () => {
    columnStale = true
    coalescer.schedule()
  })

  return {
    touch(items) {
      for (const item of items) coalescer.schedule(item.el)
    },
    touchAll() {
      coalescer.schedule()
    },
    cancel() {
      coalescer.cancel()
    },
    reset() {
      coalescer.cancel()
      mirrorsDone = false
      columnStale = true
      resetFitCache()
    },
    refreshColumn() {
      columnStale = true
    },
  }
}
