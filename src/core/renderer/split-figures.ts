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
import { DOCUMENT_ROOT, FIGURE_MEDIA } from '@/core/rules/latexml'
import { ID_ATTR } from '@/core/extractor'
import { hashText } from '@/shared/hash'
import { MIRROR_CLASS } from './mirror'
import { PENDING_CLASS } from './pending'
import { FOR_ATTR, T_CLASS } from './index'

/** 真正的译文：等待态的 pending 节点与失败态的小部件（§7.6）都不算 */
const REAL_TRANSLATION = `.${T_CLASS}:not(.${PENDING_CLASS}):not(.axt-error)`

/** 原件上的标记（原节点只允许追加 data-axt-*，§7.1） */
export const SPLIT_ATTR = 'data-axt-split'
/** 克隆件的 class；它同时带 T_CLASS，所以配对规则会把它放进右栏 */
export const SPLIT_CLASS = 'axt-split'
/** 克隆时译文内容的签名，用来判断译文有没有增加或改变、要不要重建 */
const KEY_ATTR = 'data-axt-split-key'

/** 译文的签名：数量相同但内容变了（换目标语言重翻）也要重建，只数个数会一直用陈旧的副本（Codex 在 #26 指出） */
function translationKey(fig: Element): string {
  const texts = Array.from(fig.querySelectorAll(REAL_TRANSLATION), t => t.textContent ?? '')
  return `${texts.length}:${hashText(JSON.stringify(texts))}`
}

/**
 * 有没有"游离"的媒体：不在任何翻译块、也不在译文里。
 * 说明文字里的行内公式也是 `math`，只看"有没有媒体"会把表格浮动体误判成插图
 * （实测 2312.17527 两个表格浮动体全被拆了，Codex 在 #26 指出）
 */
function hasLooseMedia(fig: Element): boolean {
  return Array.from(fig.querySelectorAll(FIGURE_MEDIA)).some(m => m.closest(`[${ID_ATTR}], .${T_CLASS}`) === null)
}

function needsSplit(fig: Element): boolean {
  if (fig.classList.contains(T_CLASS)) return false // 克隆件自己
  if (fig.parentElement?.closest('figure')) return false // 嵌套的分图交给最外层一起复制
  if (!fig.querySelector(REAL_TRANSLATION)) return false // 内部没有译文（pending 不算）：整块没配对，交给镜像
  return hasLooseMedia(fig) // 没有游离媒体的浮动体（如表格）不必整块复制，它的表本来就有译文克隆
}

/** 克隆件不能带原件的 id 与块标记 */
function stripIds(root: Element): void {
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith('data-axt-')) el.removeAttribute(name)
  }
}

/**
 * 给内含配对的插图生成"只有译文"的副本；幂等，译文变多或变了会重建。
 * 返回新建的副本数量。
 */
export function splitFigures(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let made = 0
  for (const fig of Array.from(scope.querySelectorAll('figure'))) {
    if (!needsSplit(fig)) continue
    const key = translationKey(fig)
    const sibling = fig.nextElementSibling
    const existing = sibling?.classList.contains(SPLIT_CLASS) ? sibling : null
    if (existing && existing.getAttribute(KEY_ATTR) === key) continue
    existing?.remove()

    // 镜像与整块复制是两套方案，图里留着镜像会重复一份（都是我们自己的节点，可以删）
    for (const stale of Array.from(fig.querySelectorAll(`.${MIRROR_CLASS}`))) stale.remove()

    const clone = fig.cloneNode(true) as Element
    // 还在等译文 / 翻失败的对：副本里去掉圆环与小部件、留原文，译文到了 key 变化会重建
    for (const pending of Array.from(clone.querySelectorAll(`.${PENDING_CLASS}, .axt-error`))) pending.remove()
    // 克隆件只留译文：每对里把原文成员摘掉（译文自己不会被摘）
    for (const original of Array.from(clone.querySelectorAll('*'))) {
      if (original.classList.contains(T_CLASS)) continue
      if (original.nextElementSibling?.classList.contains(T_CLASS)) original.remove()
    }
    stripIds(clone)
    clone.classList.add(T_CLASS, SPLIT_CLASS)
    clone.setAttribute(FOR_ATTR, `split:${made}`)
    clone.setAttribute(KEY_ATTR, key)

    fig.setAttribute(SPLIT_ATTR, '')
    fig.after(clone)
    made++
  }
  return made
}
