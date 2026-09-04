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
import { T_CLASS } from './index'

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

/** 让每一对原文 / 译文的上边距一致，返回本轮改变了几个译文（稳定后为 0） */
export function alignPairMargins(root: Document | Element): number {
  const view = viewOf(root)
  if (!view) return 0

  // 第三项是上一轮我们写进去的值，用来判断这一轮到底改没改
  const pairs: Array<[Element, HTMLElement, string]> = []
  for (const t of translations(root)) {
    const original = t.previousElementSibling
    if (!original || original.classList.contains(T_CLASS)) continue
    // 先擦掉上一轮的值，否则量到的是我们自己写进去的，栏宽或站点样式变了就再也修不回来
    const previous = t.style.marginTop
    if (previous) t.style.removeProperty('margin-top')
    pairs.push([original, t, previous])
  }

  // 读写分开：先一次读完（只触发一次样式重算），再只写不一致的那几个。
  // 没有声明边距时浏览器给 "0px"，happy-dom 给空串，统一成 "0px" 再比。
  const marginTop = (el: Element) => view.getComputedStyle(el).marginTop || '0px'
  const wanted = pairs.map(([original, t]) => {
    const want = marginTop(original)
    return want === marginTop(t) ? null : want
  })

  let changed = 0
  wanted.forEach((want, i) => {
    const [, t, previous] = pairs[i]!
    const next = want ?? ''
    if (next) t.style.marginTop = next // 上面擦过，一致的那些也要写回来
    if (next !== previous) changed += 1
  })
  return changed
}
