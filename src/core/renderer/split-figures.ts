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
import { DOCUMENT_ROOT, FIGURE_MEDIA, isTableRoot, tableCells } from '@/core/rules/latexml'
import { ID_ATTR } from '@/core/extractor'
import { IMG_CLASS } from '@/core/marks'
import { hashText } from '@/shared/hash'
import { MIRROR_CLASS } from './mirror'
import { mirrorSentences, sentenceSignatureOf } from './sentences'
import { PENDING_CLASS } from './pending'
import { FOR_ATTR, T_CLASS } from './index'

/** 真正的译文：等待态的 pending 节点与失败态的小部件（§7.6）都不算 */

/** 原件上的标记（原节点只允许追加 data-axt-*，§7.1） */
export const SPLIT_ATTR = 'data-axt-split'
/** 克隆件的 class；它同时带 T_CLASS，所以配对规则会把它放进右栏 */
export const SPLIT_CLASS = 'axt-split'

/**
 * 真译文：与 §7.5 预设选择器同一条界线——圆环、失败小部件、**镜像、拆分克隆**都带 .axt-t 只是为了配对，不是译文。
 * 漏掉 .axt-mirror 时（issue #46 实测 2312.17141）：说明还 pending 的图被镜像了媒体，下一趟全量把镜像当成"有译文"，
 * 删掉镜像、克隆一份没有任何译文的图——右栏是一份原文副本。基线每趟全量，7 张拆图里 2 张是这种假拆
 */
const REAL_TRANSLATION = `.${T_CLASS}:not(.${PENDING_CLASS}, .axt-error, .${MIRROR_CLASS}, .${SPLIT_CLASS})`
/** 图片叠加层（§15.2）也算真译文：只有它的插图同样要拆，且它到达时签名要变、副本要重建 */
const REAL_OR_IMAGE = `${REAL_TRANSLATION}, .${IMG_CLASS}`
/** 克隆时译文内容的签名，用来判断译文有没有增加或改变、要不要重建 */
const KEY_ATTR = 'data-axt-split-key'

/**
 * 一个译文节点此刻的句子登记签名。
 *
 * 表格是唯一把登记放在**后代**上的译文：`renderTable` 按单元格回报「原格 → 克隆格」，`.axt-t` 表格
 * 本身从来没被登记过，只问它永远得到空签名，「表格从没对齐变成有对齐、正文不变」这种转换就看不见，
 * 副本原样留下、格子一格也没被镜像（Codex 在 #148 指出；实测 2312.11805v4 的 Figure 10 / 20 就是
 * 图里带表的可拆插图）。判根是一次 `matches`，非表格的译文不多走一趟子树
 */
function signatureOf(t: Element): string {
  const own = sentenceSignatureOf(t)
  return isTableRoot(t) ? `${own}/${tableCells(t).map(sentenceSignatureOf).join(',')}` : own
}

/** 译文的签名：数量相同但内容变了（换目标语言重翻）也要重建，只数个数会一直用陈旧的副本（Codex 在 #26 指出） */
function translationKey(fig: Element): string {
  // 正文之外还要看**句子登记**：正文一样但登记从「没有」变成「有」时，副本原样留下就永远不会被
  // 镜像，悬停它什么也查不到（Codex 在 #148 指出）
  const texts = Array.from(fig.querySelectorAll(REAL_OR_IMAGE), t => `${t.textContent ?? ''}\u0000${signatureOf(t)}`)
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

/**
 * 两棵刚克隆出来、还完全一样的树的节点对应表。
 *
 * `cloneNode(true)` 之后、任何删除之前调用：那一刻两边的节点按文档序一一对应，配对是数出来的
 * 而不是猜出来的。文本节点也要（译文那侧的 span 大多落在文本节点上），所以用 NodeIterator 而不是
 * `querySelectorAll`
 */
function pairNodes(from: Element, to: Element): Map<Node, Node> {
  const doc = from.ownerDocument
  const a = doc.createNodeIterator(from)
  const b = doc.createNodeIterator(to)
  const out = new Map<Node, Node>()
  for (;;) {
    const x = a.nextNode()
    const y = b.nextNode()
    if (!x || !y) break
    out.set(x, y)
  }
  return out
}

/** 元素所在的最外层 figure（嵌套分图交给最外层一起复制）；不在图里返回 null */
export function outermostFigure(el: Element): Element | null {
  let fig = el.closest('figure')
  while (fig?.parentElement) {
    const outer = fig.parentElement.closest('figure')
    if (!outer) break
    fig = outer
  }
  return fig
}

function needsSplit(fig: Element): boolean {
  if (fig.classList.contains(T_CLASS)) return false // 克隆件自己
  if (fig.parentElement?.closest('figure')) return false // 嵌套的分图交给最外层一起复制
  if (!fig.querySelector(REAL_OR_IMAGE)) return false // 内部没有译文（pending 不算）：整块没配对，交给镜像
  return hasLooseMedia(fig) // 没有游离媒体的浮动体（如表格）不必整块复制，它的表本来就有译文克隆
}

/** 克隆件里记着自己对应原件的哪个 id：页内锚点靠它找到克隆中对应的那一处（issue #44） */
export const SPLIT_OF_ATTR = 'data-axt-split-of'
/**
 * 副本里的图片叠加层记着它翻的是哪张图。
 *
 * 与 `SPLIT_OF_ATTR` 同一个手法：`data-axt-for` 会被 `stripIds` 一起抹掉，于是
 * `clearImageEverywhere` 按 `data-axt-for` 找不到副本里那一份，「不再翻这张图」之后
 * only 模式下读者看到的仍是上一轮的译文（Codex 在 #134 指出）。换个名字留下来——
 * 不是 `data-axt-for`，配对规则不会把副本里的叠加层当成另一份译文
 */
export const SPLIT_FOR_ATTR = 'data-axt-split-for'

/**
 * 克隆件不能带原件的 id 与块标记（会造成重复 id）。但**对应关系不能一起丢**：
 * only 模式下原件整个被藏，指向图内某一行的锚点（实测 2312.17141 有 21 个，
 * `#S3.Ex73`–`#S3.Ex79` 都是 Figure 6 里的公式行）只能落到克隆上，
 * 没有对应关系就只能滚到整张图的顶部，要找的那行可能还在视口外（Codex 在 #80 指出）。
 * 所以把原 id 挪进 `data-axt-split-of`——不是 id，不会重复，克隆整个被删时一起消失
 */
function stripIds(root: Element): void {
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    const id = el.getAttribute('id')
    const forId = el.classList.contains(IMG_CLASS) ? el.getAttribute(FOR_ATTR) : null
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith('data-axt-')) el.removeAttribute(name)
    if (id) el.setAttribute(SPLIT_OF_ATTR, id)
    if (forId) el.setAttribute(SPLIT_FOR_ATTR, forId)
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

    // 镜像与整块复制是两套方案，图里留着镜像会重复一份（都是我们自己的节点，可以删）。
    // 没有图注的插图在会话开始时会被整张镜像（figure 级的下一个兄弟），叠加层到达后拆图时一并删掉，否则右栏三份
    for (const stale of Array.from(fig.querySelectorAll(`.${MIRROR_CLASS}`))) stale.remove()
    const figureMirror = fig.nextElementSibling
    if (figureMirror?.classList.contains(MIRROR_CLASS)) figureMirror.remove()

    const clone = fig.cloneNode(true) as Element
    // **趁两棵树还完全一样的这一刻**把每个节点的对应件记下来。下面几步会从克隆里删掉每对的原文成员，
    // 之后两棵树就不同构了，再想配对只能靠猜。悬停对照高亮要靠这张表把译文那侧的 span 挪到
    // 屏幕上真正显示的那一份上（issue #139）
    const twins = pairNodes(fig, clone)
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
    // 图注的译文在右栏是这一份克隆件，原件那份被 side 模式藏起来了；不登记的话悬停时
    // 译文侧算出来的矩形是空的，一条底都画不出来（issue #139，用户 2026-09-10 反馈）
    // **每一个元素都试一遍，不只是 `.axt-t`。** 表格的句子是按**单元格**登记的（`renderTable` 回报
    // 「原格 → 克隆格」），那些格子在 `.axt-t` 表格里面，只扫 `.axt-t` 就漏掉了（Codex 在 #148 指出）。
    // 没登记过的元素在 `mirrorSentences` 里直接返回，代价是一次 WeakMap 查询
    for (const original of [fig, ...Array.from(fig.querySelectorAll('*'))]) {
      const copy = twins.get(original)
      if (copy?.nodeType === 1 && copy.isConnected) mirrorSentences(original, copy as Element, node => twins.get(node))
    }
    made++
  }
  return made
}

/**
 * 非 side 模式下丢掉签名过期的副本（§15.2）：side → only 之后 OCR 才到，叠加层进了被隐藏的原件，
 * 副本里没有它；只在 side 才重建的话叠加层要等回到 side 才可见。删掉副本、摘掉原件的标记，
 * 只显示原件（stack 本来就显示原件；only 下原件的译文照常可见），回 side 时全量整理再重建。
 * 返回丢掉的副本数
 */
export function dropStaleSplits(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  let dropped = 0
  for (const fig of Array.from(scope.querySelectorAll(`[${SPLIT_ATTR}]`))) {
    const sibling = fig.nextElementSibling
    const existing = sibling?.classList.contains(SPLIT_CLASS) ? sibling : null
    if (existing && existing.getAttribute(KEY_ATTR) === translationKey(fig)) continue
    existing?.remove()
    fig.removeAttribute(SPLIT_ATTR)
    dropped++
  }
  return dropped
}
