// side 模式下让表格装进自己那一栏（DESIGN §7.2）。
// 论文里的数值表最小内容宽度普遍超过半栏（实测同一页三张表 509 / 551 / 613px，栏宽 484px），
// 塞进一栏会溢出到隔壁与译文表重叠。表格无法被压到 min-content 以下，所以按比例缩小：
// 量出需要的比例，落到一档离散的 zoom 上（写成 data-axt-fit，样式在 modes.css）。
// 缩到 MIN_FIT 还装不下的极端表格退化为栏内横向滚动。
import { TABLE_RULES } from '@/core/rules/latexml'
import { FOR_ATTR, T_CLASS } from './index'

/** 原节点只允许追加 data-axt-*（§7.1），所以比例用属性而不是内联样式表达 */
export const FIT_ATTR = 'data-axt-fit'
/** 离散档位：少数几条 CSS 规则就能覆盖，也避免每次改窗口都写新值 */
export const FIT_BUCKETS = [95, 90, 85, 80, 75, 70] as const
/** 低于这个比例字就太小了，改用栏内滚动 */
export const MIN_FIT = 0.7
export const FIT_SCROLL = 'scroll'

export interface FitDeps {
  /** 表格在不换行时的最小宽度 */
  minContentWidth?: (table: Element) => number
  /** 表格所在容器一栏的宽度 */
  columnWidth?: (table: Element) => number
}

/**
 * 量尺寸用的离屏克隆。**必须剥掉 data-axt-***：克隆件带着上一轮的 data-axt-fit 就会命中
 * modes.css 里的 zoom 规则，量到的是已经缩过的宽度，于是判定"装得下"→ 去掉缩放 →
 * 下一轮又量到原始宽度 → 再缩，窗口停在某些尺寸时表格会不停闪（实测）。
 * 同时显式写 zoom: 1，挡住任何来自祖先或其他规则的缩放。
 */
export function createFitProbe(table: Element): HTMLElement {
  const probe = table.cloneNode(true) as HTMLElement
  for (const el of [probe, ...Array.from(probe.querySelectorAll('*'))]) {
    for (const name of el.getAttributeNames()) if (name.startsWith('data-axt-')) el.removeAttribute(name)
  }
  probe.setAttribute('style', 'width:min-content;max-width:none;zoom:1;position:absolute;visibility:hidden;left:-9999px;top:0')
  return probe
}

/** 离屏克隆量 min-content：不碰原节点的 style（§7.1） */
function measureMinContent(table: Element): number {
  const probe = createFitProbe(table)
  table.ownerDocument.body.append(probe)
  const width = probe.getBoundingClientRect().width
  probe.remove()
  return width
}

/** 容器是两列网格，一栏是（容器宽 - 间距）/ 2 */
function measureColumn(table: Element): number {
  const holder = table.parentElement
  if (!holder) return 0
  const style = holder.ownerDocument.defaultView?.getComputedStyle(holder)
  const gap = style ? Number.parseFloat(style.columnGap) || 0 : 0
  return (holder.getBoundingClientRect().width - gap) / 2
}

const paired = (table: Element): boolean =>
  table.nextElementSibling?.classList.contains(T_CLASS) === true
  && table.nextElementSibling?.getAttribute(FOR_ATTR) !== null

/**
 * 给每对表格标上合适的缩放档；重复调用会重新量（窗口变化后要重算）。
 * 没有布局信息的环境（测试、display:none）直接跳过。
 */
export function fitTables(root: Document | Element, deps: FitDeps = {}): { fitted: number; scrolled: number } {
  const minContentWidth = deps.minContentWidth ?? measureMinContent
  const columnWidth = deps.columnWidth ?? measureColumn
  let fitted = 0
  let scrolled = 0

  for (const table of Array.from(root.querySelectorAll(TABLE_RULES.root))) {
    if (table.classList.contains(T_CLASS)) continue
    const translation = paired(table) ? table.nextElementSibling : null
    const mark = (value: string | null) => {
      for (const el of [table, translation]) {
        if (!el) continue
        if (value === null) el.removeAttribute(FIT_ATTR)
        else el.setAttribute(FIT_ATTR, value)
      }
    }
    if (!translation) { mark(null); continue }

    const column = columnWidth(table)
    const natural = minContentWidth(table)
    if (!(column > 0) || !(natural > 0)) { mark(null); continue }
    if (natural <= column) { mark(null); continue }

    const needed = column / natural
    const bucket = FIT_BUCKETS.find(value => value / 100 <= needed)
    if (bucket === undefined || needed < MIN_FIT) {
      mark(FIT_SCROLL)
      scrolled++
    } else {
      mark(String(bucket))
      fitted++
    }
  }
  return { fitted, scrolled }
}
