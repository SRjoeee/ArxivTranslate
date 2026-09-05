// side 模式下让表格与行间公式装进自己那一栏（DESIGN §7.2）。
// 论文里的数值表最小内容宽度普遍超过半栏（实测同一页三张表 509 / 551 / 613px，栏宽 484px），
// 行间公式同样不能换行（实测 2609.04056v1：栏宽 436px 时 (1.8) 宽 800px、(1.15) 宽 900px，
// 左栏的式子横到右栏、公式编号跑到镜像的开头上）。两者都压不到 min-content 以下，所以按比例缩小：
// 量出需要的比例，落到一档离散的 zoom 上（写成 data-axt-fit，样式在 modes.css）。
// 缩到 MIN_FIT 还装不下的极端内容退化为栏内横向滚动（ar5iv 自己在 .ltx_td / .ltx_inline-block 里也这么处理公式表）。
//
// **量法只读，不克隆、不写 DOM**。早先每张表克隆一份插进 body 量 min-content，那是"写一次、读一次"的循环，
// 每张都强制整页重排：目标扩到公式后 2312.17141 有 392 张，实测一趟 45 秒的长任务、页面无响应、
// 134 秒只翻出 6 块（用户反馈）；同一页只读量法 1 毫秒。
import { DOCUMENT_ROOT, EQUATION_PAD_CELL, EQUATION_TABLE, FIT_TARGETS } from '@/core/rules/latexml'
import { FOR_ATTR, T_CLASS } from './index'

/** 原节点只允许追加 data-axt-*（§7.1），所以比例用属性而不是内联样式表达 */
export const FIT_ATTR = 'data-axt-fit'
/** 离散档位：少数几条 CSS 规则就能覆盖，也避免每次改窗口都写新值 */
export const FIT_BUCKETS = [95, 90, 85, 80, 75, 70] as const
/** 低于这个比例字就太小了，改用栏内滚动 */
export const MIN_FIT = 0.7
export const FIT_SCROLL = 'scroll'
/**
 * 放松缩放（去掉标记或换更大的档）要求的富余。公式表装得下时自然宽度只能估算（见 measureNatural），
 * 估算值比真实值小 1–2%（实测 145 张最大差 28px），没有余量的话会在"放松 → 溢出 → 收紧"之间来回跳
 */
export const LOOSEN_SLACK = 0.05

export interface NaturalWidth {
  width: number
  /** 精确值可以用来收紧；估算值只用来放松，且要留 LOOSEN_SLACK 的余量 */
  exact: boolean
}

export interface FitDeps {
  /** 表格不受栏宽约束时的自然宽度；返回数字视为精确值 */
  naturalWidth?: (table: Element) => number | NaturalWidth
  /** 表格所在容器一栏的宽度 */
  columnWidth?: (table: Element) => number
}

function currentZoom(table: Element): number {
  const fit = table.getAttribute(FIT_ATTR)
  return fit && fit !== FIT_SCROLL ? Number(fit) / 100 : 1
}

/**
 * 只读地量自然宽度，按当前状态分三种：
 * - 栏内横滑（scroll）：盒子被 max-width 压在栏宽，scrollWidth 就是内容宽度，精确
 * - 盒子比栏宽（已含当前缩放）：表格压不到 min-content 以下，盒宽 ÷ zoom 就是自然宽度，精确
 * - 装得下且有富余：.ltx_tabular 按内容定宽，盒宽仍是自然宽度，精确；
 *   公式表是 width: 100%，盒宽说明不了内容，改用各行非填充单元格之和（填充格按它的 min-width 计，
 *   ar5iv 给了 2em），取最宽的一行——这是估算
 */
function measureNatural(table: Element, column: number): NaturalWidth {
  const zoom = currentZoom(table)
  if (table.getAttribute(FIT_ATTR) === FIT_SCROLL) return { width: table.scrollWidth, exact: true }
  const visible = table.getBoundingClientRect().width
  if (visible > column + 1 || !table.matches(EQUATION_TABLE)) return { width: visible / zoom, exact: true }
  const view = table.ownerDocument.defaultView
  let widest = 0
  for (const row of Array.from(table.querySelectorAll('tr'))) {
    let width = 0
    for (const cell of Array.from(row.children)) {
      if (cell.matches(EQUATION_PAD_CELL)) {
        const style = view?.getComputedStyle(cell)
        width += (Number.parseFloat(style?.minWidth ?? '') || 0)
          + (Number.parseFloat(style?.paddingLeft ?? '') || 0)
          + (Number.parseFloat(style?.paddingRight ?? '') || 0)
      } else {
        width += cell.getBoundingClientRect().width
      }
    }
    widest = Math.max(widest, width)
  }
  return { width: widest / zoom, exact: false }
}

/**
 * 栏宽以翻译根的第一条网格轨道为准：所有容器都是它的 subgrid，栏宽处处相同（§7.2）。
 * 直接读轨道比"父容器宽度减间距再除二"更可靠——表格的父级不一定是我们设的网格容器。
 */
function measureColumn(table: Element): number {
  const view = table.ownerDocument.defaultView
  const root = table.closest(DOCUMENT_ROOT)
  if (view && root) {
    const first = Number.parseFloat(view.getComputedStyle(root).gridTemplateColumns.split(' ')[0] ?? '')
    if (Number.isFinite(first) && first > 0) return first
  }
  // 退路：还没进 side 或读不到轨道时，按父容器折半估算
  const holder = table.parentElement
  if (!holder || !view) return 0
  const gap = Number.parseFloat(view.getComputedStyle(holder).columnGap) || 0
  return (holder.getBoundingClientRect().width - gap) / 2
}

const paired = (table: Element): boolean =>
  table.nextElementSibling?.classList.contains(T_CLASS) === true
  && table.nextElementSibling?.getAttribute(FOR_ATTR) !== null

/** 松紧序：无标记最松，scroll 最紧 */
function tightness(value: string | null): number {
  if (value === null) return 0
  if (value === FIT_SCROLL) return FIT_BUCKETS.length + 1
  return FIT_BUCKETS.indexOf(Number(value) as (typeof FIT_BUCKETS)[number]) + 1
}

function decide(natural: number, column: number): string | null {
  if (natural <= column) return null
  const needed = column / natural
  const bucket = FIT_BUCKETS.find(value => value / 100 <= needed)
  return bucket === undefined || needed < MIN_FIT ? FIT_SCROLL : String(bucket)
}

/**
 * 给每对表格 / 行间公式标上合适的缩放档；重复调用会重新量（窗口变化后要重算）。
 * 配对 = 后面紧跟译文克隆或镜像（都是带 data-axt-for 的 .axt-t）。
 * 没有布局信息的环境（测试、display:none）直接跳过。
 */
export function fitTables(root: Document | Element, deps: FitDeps = {}): { fitted: number; scrolled: number } {
  const columnWidth = deps.columnWidth ?? measureColumn
  let fitted = 0
  let scrolled = 0
  // 默认量法一次调用里栏宽处处相同，只读一次轨道
  let cachedColumn: number | null = null

  for (const table of Array.from(root.querySelectorAll(FIT_TARGETS))) {
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

    if (deps.columnWidth) cachedColumn = null
    if (cachedColumn === null) cachedColumn = columnWidth(table)
    const column = cachedColumn
    if (!(column > 0)) { mark(null); continue }
    const measured = deps.naturalWidth ? deps.naturalWidth(table) : measureNatural(table, column)
    const { width: natural, exact } = typeof measured === 'number' ? { width: measured, exact: true } : measured
    if (!(natural > 0)) { mark(null); continue }

    const current = table.getAttribute(FIT_ATTR)
    let next = decide(natural, column)
    // 估算值永远不用来收紧（它量的是"装得下"的状态，收紧没有依据）；放松要按加了余量的宽度重新判
    if (!exact && tightness(next) !== tightness(current)) {
      next = tightness(next) < tightness(current) ? decide(natural * (1 + LOOSEN_SLACK), column) : current
      if (tightness(next) > tightness(current)) next = current
    }
    mark(next)
    if (next === FIT_SCROLL) scrolled++
    else if (next !== null) fitted++
  }
  return { fitted, scrolled }
}
