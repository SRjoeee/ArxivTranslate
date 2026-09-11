// 边注在右侧沟槽里依次下排（DESIGN §7.2）。
//
// arXiv 把脚注浮到页面右缘，靠 `float: inline-end` + `clear: both` 让它们一条接一条往下排；
// 排得下是因为整页的浮动同在一个格式化上下文里，彼此看得见。side 模式下每个块都是网格项、
// 也就是各自独立的格式化上下文：浮动被块兜住，**框有多高，网格行就有多高**
//（#154 实测一条长脚注把网格行撑到 1321px，两栏一起空着）。所以样式表把框的高度归零
//（`height: 0; overflow: visible`，ar5iv 自己给列表项里的脚注就是这么写的）。
//
// 高度这一个数同时决定「撑不撑网格行」与「让不让后面的浮动」，CSS 给不出第二个旋钮：
// 归零就不再互相避让，同一块里的几条脚注会按行距叠在一起（用户 2026-09-11 在 2509.10652v3
// 上反馈：六条 URL 脚注间距 32px、每条 50px 高）；而「同块有兄弟脚注就还它高度」这版
// 当天就在 2609.10326v1 上把网格行从 162px 顶到 1442px，空白又回来了（用户当天反馈）。
//
// 所以高度一律归零（网格行不受任何影响），**位置由这里量出来再写**：按文档序排，压到上一条
// 就往下推 `transform: translateY()`。transform 不参与布局——推多远都不会撑高任何东西、
// 不会让正文重排，只是把画出来的那一块挪个位置，结果与 arXiv 原版的浮动下排一致。
//
// 读与写分成两个函数，好让整理层（renderer/prep.ts）把「读」排在这一趟所有写之前（§10）。
import { T_CLASS } from '@/core/marks'
import { NOTE } from '@/core/rules/latexml'

/** 两条边注之间的留白：ar5iv 给 `.ltx_note_outer` 的 padding-bottom 正是 2rem，沿用同一个节奏 */
const GAP_REM = 2

/** 量出来的一条边注：它自然落在哪、画出来多高、是不是我们能动的那份 */
export interface NoteBox {
  /** 没有我们这一下推移时，它画出来的顶边（视口坐标；同一趟里只用差值，不用换算成文档坐标） */
  top: number
  /** 画出来的高度。框被样式归零了，所以量的是里面的内容 */
  height: number
  /** 译文里那份副本是我们自己的节点，可以写样式；原件那份不是（§7.1），只能当障碍绕开 */
  ours: boolean
}

export interface MarginNotePlan {
  shifts: Array<{ outer: HTMLElement; shift: number }>
}

/** 每条边注已经写下去的位移。量的时候要减掉它才是「自然位置」 */
const applied = new WeakMap<HTMLElement, number>()

/**
 * 纯算：按文档序给每条边注一个向下的位移，谁都不压谁。
 * 原件那份推不动（`ours: false`），它照旧待在原地，只当成后面几条要让开的障碍。
 */
export function stackShifts(boxes: readonly NoteBox[], gap: number): number[] {
  const out: number[] = []
  let floor = Number.NEGATIVE_INFINITY
  for (const box of boxes) {
    const shift = box.ours ? Math.max(0, floor - box.top) : 0
    out.push(shift)
    // 底线只会往下走，不会回头（Codex 在 #163 指出）：推不动的原件若自然落得比当前底线还高，
    // 直接赋值会把底线**拉回去**，下一条副本于是只躲开了这个原件、又压回前面那条被推下去的副本上。
    // 浮动要躲开的是它前面**所有**条，所以取最大值——正常情况（原件在下一行、本来就更低）这一步是个空操作
    floor = Math.max(floor, box.top + shift + box.height + gap)
  }
  return out
}

/** 一条边注真正画出来的竖直范围。框是 `height: 0`，量它没用，要量里面的内容 */
function paintedSpan(outer: Element): { top: number; height: number } | null {
  let top = Number.POSITIVE_INFINITY
  let bottom = Number.NEGATIVE_INFINITY
  for (const child of Array.from(outer.children)) {
    const r = child.getBoundingClientRect()
    // 折叠的（站点在 96rem 以下把整框 display:none）与被我们藏起来的原件都是 0×0
    if (r.width === 0 && r.height === 0) continue
    top = Math.min(top, r.top)
    bottom = Math.max(bottom, r.bottom)
  }
  return bottom > top ? { top, height: bottom - top } : null
}

/** 只读：量出这一趟每条边注该往下推多少。要整篇一起量——一条推多少取决于它前面所有条 */
export function planMarginNotes(root: Document | Element): MarginNotePlan {
  const doc = root.nodeType === 9 ? (root as Document) : (root as Element).ownerDocument
  const view = doc?.defaultView
  if (!doc || !view) return { shifts: [] }
  const rem = Number.parseFloat(view.getComputedStyle(doc.documentElement).fontSize) || 16
  const outers: HTMLElement[] = []
  const boxes: NoteBox[] = []
  for (const outer of Array.from(doc.querySelectorAll<HTMLElement>(NOTE.marginOuter))) {
    const span = paintedSpan(outer)
    if (!span) continue
    outers.push(outer)
    boxes.push({ top: span.top - (applied.get(outer) ?? 0), height: span.height, ours: !!outer.closest(`.${T_CLASS}`) })
  }
  const shifts = stackShifts(boxes, GAP_REM * rem)
  return { shifts: outers.map((outer, i) => ({ outer, shift: shifts[i]! })).filter((_, i) => boxes[i]!.ours) }
}

/** 只写：把位移写下去，返回这一趟真的挪动了几条（稳定后为 0） */
export function applyMarginNotes(plan: MarginNotePlan): number {
  let moved = 0
  for (const { outer, shift } of plan.shifts) {
    if (Math.abs((applied.get(outer) ?? 0) - shift) < 0.5) continue
    applied.set(outer, shift)
    outer.style.transform = shift > 0.5 ? `translateY(${Math.round(shift)}px)` : ''
    moved += 1
  }
  return moved
}

/** 擦掉写下去的位移（离开 side 模式时用：其他模式下浮动本来就按自己的高度互相避让） */
export function clearMarginNotes(root: Document | Element): void {
  for (const outer of Array.from(root.querySelectorAll<HTMLElement>(NOTE.marginOuter))) {
    if (!outer.style.transform) continue
    applied.set(outer, 0)
    outer.style.removeProperty('transform')
  }
}
