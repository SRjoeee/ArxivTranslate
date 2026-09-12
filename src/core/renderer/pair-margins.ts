// side 模式下同一行左右顶端对齐（DESIGN §7.2）。
//
// 译文只能作为原块的下一个兄弟插入（§7.1），插进去就改写了站点 CSS 里**相邻兄弟选择器**的匹配结果。
// 实测 2501.00077v1 的作者区：ar5iv 有一条形如 `.ltx_role_affiliation + .ltx_role_affiliation`
// 的上边距规则（对照实验：去掉自身该类、去掉前一个兄弟的该类、或在中间插一个节点，8px 都会归零）。
// 译文节点复制原块的 class，于是原文的前一个兄弟是上一条**译文**（角色不同 → 0px），
// 而译文的前一个兄弟是自己的**原文**（角色相同 → 8px），同一行两栏顶端就差了 8px。
//
// 网格里每个格子的顶端 = 行顶 + 自身 margin-top，两边上边距不等就必然错位；
// CSS 没有"取兄弟的计算值"的写法，所以把原文的上边距抄到译文上——只写我们自己的节点。
import { T_CLASS } from '@/core/marks'
import { SIDE_DENY_SUBTREE } from './side-layout'

function translations(root: Document | Element): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(`.${T_CLASS}`))
}

function viewOf(root: Document | Element): (Window & typeof globalThis) | null {
  const doc = root.nodeType === 9 ? (root as Document) : (root as Element).ownerDocument
  return doc?.defaultView ?? null
}

/** 擦掉我们写的内联上边距，让计算值回到站点样式（离开 side 模式时用） */
export function clearPairMargins(root: Document | Element): void {
  for (const t of translations(root)) if (t.style.marginTop) t.style.removeProperty('margin-top')
}

/** 一趟里读到的配对与各自该写的值；读与写分开两个函数，好让整理层把"读"排在任何写之前 */
export interface PairMarginPlan {
  pairs: Array<[Element, HTMLElement, string]>
  wanted: Array<string | null>
}

/**
 * 读：收集配对、擦掉上一轮写的值、量两边的计算边距。**不写**（擦内联值只影响自己那个元素的样式，
 * 不牵动选择器匹配）。整理层在写任何东西之前调它——那一刻样式是干净的，getComputedStyle 不必付
 * 整篇重算的钱；放在插节点之后再读，`:has()` 的失效会让这一次读花掉上百毫秒（issue #46 实测 2312.17141
 * 一趟 90 ms，31 趟累计 818 ms——正是把 fitTables 的强制布局挪走之后露出来的那一层）
 */
export function readPairMargins(root: Document | Element): PairMarginPlan {
  const view = viewOf(root)
  const pairs: PairMarginPlan['pairs'] = []
  if (!view) return { pairs, wanted: [] }
  for (const t of translations(root)) {
    const original = t.previousElementSibling
    if (!original || original.classList.contains(T_CLASS)) continue
    // 拆分克隆与脚注里"前一个兄弟"不是原文（克隆件里原文成员已被摘掉），不能当配对处理
    //（实测 2312.17141 有 14 处说明译文会抄到插图的边距，Codex 在 #26 指出）
    if (t.closest(SIDE_DENY_SUBTREE)) continue
    // 先擦掉上一轮的值，否则量到的是我们自己写进去的，栏宽或站点样式变了就再也修不回来
    const previous = t.style.marginTop
    if (previous) t.style.removeProperty('margin-top')
    pairs.push([original, t, previous])
  }
  // 没有声明边距时浏览器给 "0px"，happy-dom 给空串，统一成 "0px" 再比
  const marginTop = (el: Element) => view.getComputedStyle(el).marginTop || '0px'
  const wanted = pairs.map(([original, t]) => {
    const want = marginTop(original)
    return want === marginTop(t) ? null : want
  })
  return { pairs, wanted }
}

/** 写：只写不一致的那几个；返回本轮改变了几个译文（稳定后为 0） */
export function writePairMargins({ pairs, wanted }: PairMarginPlan): number {
  let changed = 0
  wanted.forEach((want, i) => {
    const [, t, previous] = pairs[i]!
    const next = want ?? ''
    if (next) t.style.marginTop = next // 读的时候擦过，一致的那些也要写回来
    if (next !== previous) changed += 1
  })
  return changed
}

/** 让每一对原文 / 译文的上边距一致，返回本轮改变了几个译文（稳定后为 0） */
export function alignPairMargins(root: Document | Element): number {
  return writePairMargins(readPairMargins(root))
}
