// side 模式下把整张插图拆成两份（DESIGN §7.2）：左栏原文说明、右栏译文说明。
//
// 插图里的图与公式没有译文，按块配对的话右栏就空着；让整张图跨两栏又等于放弃对照。
// 所以整块克隆：克隆件删掉每对的原文成员、只留译文，原件在 side 模式下隐藏内部译文。
// 两份结构完全相同，行天然对齐。表格浮动体不走这条路——它的表本来就有译文克隆。
//
// **不缩放**（用户决定，2026-09-05）：栏窄了让 ar5iv 自己重排——`.ltx_flex_figure` 本身就是
// `flex-flow: wrap`，面板会自己竖排（实测 2312.17141：满栏 342px 高、半栏 546px，不溢出）。
// 实在不能重排的（宽公式、宽 SVG，实测 8 张图里有 3 张溢出 78 / 102 / 209px）退化为栏内横滑，
// 字号一律不动。试过把栏宽喂给 ar5iv 的 `--main-width`（它按 .33/.5 的比例算面板宽），
// 实测更糟：面板缩成 160px 还溢出 555px，所以那个变量保持不动。
import { DOCUMENT_ROOT } from '@/core/rules/latexml'
import { MIRROR_CLASS } from './mirror'
import { FOR_ATTR, T_CLASS } from './index'

/** 原件上的标记（原节点只允许追加 data-axt-*，§7.1） */
export const SPLIT_ATTR = 'data-axt-split'
/** 克隆件的 class；它同时带 T_CLASS，所以配对规则会把它放进右栏 */
export const SPLIT_CLASS = 'axt-split'
/** 克隆时的配对数，用来判断译文有没有增加、要不要重建 */
const PAIRS_ATTR = 'data-axt-split-pairs'
/** 没有译文、也翻不了的媒体：两栏各需要一份的正是这些 */
const MEDIA = 'img, svg, object, math, canvas, video, .ltx_picture'

function pairCount(fig: Element): number {
  return fig.querySelectorAll(`.${T_CLASS}`).length
}

function needsSplit(fig: Element): boolean {
  if (fig.classList.contains(T_CLASS)) return false // 克隆件自己
  if (fig.parentElement?.closest('figure')) return false // 嵌套的分图交给最外层一起复制
  if (!fig.querySelector(`.${T_CLASS}`)) return false // 内部没有译文：整块没配对，交给镜像
  return fig.querySelector(MEDIA) !== null // 没有媒体的浮动体（如表格）不必整块复制
}

/** 克隆件不能带原件的 id 与块标记 */
function stripIds(root: Element): void {
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith('data-axt-')) el.removeAttribute(name)
  }
}

/**
 * 给内含配对的插图生成"只有译文"的副本；幂等，译文变多了会重建。
 * 返回新建的副本数量。
 */
export function splitFigures(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let made = 0
  for (const fig of Array.from(scope.querySelectorAll('figure'))) {
    if (!needsSplit(fig)) continue
    const pairs = pairCount(fig)
    const sibling = fig.nextElementSibling
    const existing = sibling?.classList.contains(SPLIT_CLASS) ? sibling : null
    if (existing && Number(existing.getAttribute(PAIRS_ATTR)) === pairs) continue
    existing?.remove()

    // 镜像与整块复制是两套方案，图里留着镜像会重复一份（都是我们自己的节点，可以删）
    for (const stale of Array.from(fig.querySelectorAll(`.${MIRROR_CLASS}`))) stale.remove()

    const clone = fig.cloneNode(true) as Element
    // 克隆件只留译文：每对里把原文成员摘掉（译文自己不会被摘）
    for (const original of Array.from(clone.querySelectorAll('*'))) {
      if (original.classList.contains(T_CLASS)) continue
      if (original.nextElementSibling?.classList.contains(T_CLASS)) original.remove()
    }
    stripIds(clone)
    clone.classList.add(T_CLASS, SPLIT_CLASS)
    clone.setAttribute(FOR_ATTR, `split:${made}`)
    clone.setAttribute(PAIRS_ATTR, String(pairs))

    fig.setAttribute(SPLIT_ATTR, '')
    fig.after(clone)
    made++
  }
  return made
}
