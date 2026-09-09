// 图片叠加层（DESIGN §15.2）：<img> 的下一个兄弟 `.axt-img`，里面每个译文标签一个 span，
// 位置与尺寸按归一化坐标写成百分比、字号写成容器查询单位——全部在 JS 里算成字符串写一次，**不读任何几何**。
// 叠加层不带 .axt-t（理由见 marks.ts 的 IMG_CLASS），只在成功时插；等待 / 失败没有 DOM 节点。
// 与 §7.1 一致：<img> 本身一个属性都不加；恢复原文时 restore 按 INJECTED_SELECTOR 整层删掉。
import { IMG_CLASS } from '@/core/marks'
import { FOR_ATTR, LANG_ATTR } from './index'
import { MIRROR_CLASS } from './mirror'
import { SPLIT_FOR_ATTR } from './split-figures'

/** <html> 上的模式闸：用户勾选的模式集合，空格分隔，CSS 用 ~= 匹配当前模式（§15 的设置项） */
export const IMG_MODES_ATTR = 'data-axt-img-modes'

export interface ImageTarget {
  id: string
  el: Element
  /**
   * 位图走「取字节 → OCR」，SVG 图直接读 `contentDocument` 里的字形（§15.5）。
   * 两条路在 `linesToBoxes` 汇合，之后的叠加层、缓存、调度完全一样
   */
  kind: 'raster' | 'svg'
}

/** 一个译文标签：位置与尺寸是图的归一化坐标（0–1，左上原点），lines 是 OCR 合并进来的行数 */
export interface ImageLabel {
  x: number
  y: number
  w: number
  h: number
  lines: number
  /** OCR 原文，hover 显示 */
  source: string
  /** 译文 */
  text: string
  /** 文字方向，弧度；不在表示横排。语料里只有 -π/2 一种（§15.5） */
  angle?: number
}

export function setImageModes(doc: Document, modes: readonly string[]): void {
  if (modes.length > 0) doc.documentElement.setAttribute(IMG_MODES_ATTR, modes.join(' '))
  else doc.documentElement.removeAttribute(IMG_MODES_ATTR)
}

/** 目标已有的叠加层（同一父元素里、data-axt-for 指向它的） */
export function overlayOf(target: ImageTarget): Element | null {
  const parent = target.el.parentElement
  if (!parent) return null
  for (const child of Array.from(parent.children)) {
    if (child.classList.contains(IMG_CLASS) && child.getAttribute(FOR_ATTR) === target.id) return child
  }
  return null
}

export function clearImage(target: ImageTarget): boolean {
  const existing = overlayOf(target)
  if (!existing) return false
  existing.remove()
  return true
}

/**
 * 这张图在**整个文档里**的叠加层，包括 side 模式拆图副本里的那一份。
 *
 * `clearImage` 只看图自己的兄弟位置，够用于「换一份新的」——副本会在整理时按签名重建。
 * 但「不再翻这张图了」的场合不够：副本里那份还挂着，而 only 模式下**原件是藏起来的**，
 * 读者看到的正是副本里那份上一轮、甚至上一种目标语言的译文（Codex 在 #134 指出）
 */
export function clearImageEverywhere(target: ImageTarget): number {
  const doc = target.el.ownerDocument
  // 副本里那份认的是 `data-axt-split-for`：`stripIds` 会把克隆件上的每个 `data-axt-*` 抹掉，
  // 只按 `data-axt-for` 找的话副本里那份永远留着（Codex 在 #134 指出）
  const id = CSS.escape(target.id)
  const stale = Array.from(doc.querySelectorAll(`.${IMG_CLASS}[${FOR_ATTR}="${id}"], .${IMG_CLASS}[${SPLIT_FOR_ATTR}="${id}"]`))
  for (const node of stale) node.remove()
  return stale.length
}

/**
 * 一段文字大约占多少 em 宽：CJK 一字一 em，其余按 0.55 em 估（西文平均字宽），空格 0.3 em。
 * 只用来给字号一个宽度上限，不求精确——译文多半是中文，通常比原文短，字号由框高决定
 */
export function emWidth(text: string): number {
  let width = 0
  for (const ch of text) {
    if (/\s/.test(ch)) width += 0.3
    else if (/[⺀-鿿가-힯豈-﫿＀-￯]/.test(ch)) width += 1
    else width += 0.55
  }
  return Math.max(width, 0.55)
}

/**
 * 标签的内联样式：位置与尺寸都是图的百分比，字号 = min(按框高, 按框宽)，单位是容器查询单位
 * （叠加层是 size 容器，1cqh = 图高的 1%，1cqw = 图宽的 1%）。行高 1.15，一行占框高的 72% 左右；
 * 多行框按行数均摊。**不读任何几何**，整串在 JS 里算成字符串写一次。
 *
 * **竖排标签（`angle`）不能用百分比。** 绕中心转 90° 之后，框的 width 变成屏幕上的竖向长度、
 * height 变成横向厚度；而 `width: X%` 是容器**宽**的百分比，容器不是正方形时长度就错了。
 * 所以竖排的 width 写成 `cqh`（图高的百分比，文字真正延伸的那根轴）、height 写成 `cqw`，
 * left / top 用 `calc()` 从中心减去一半 —— 两种单位在 calc 里可以相减，都是同一个容器的百分比。
 */
export function labelStyle(label: ImageLabel): string {
  const pct = (v: number) => `${(v * 100).toFixed(3)}%`
  const cq = (v: number, unit: 'cqw' | 'cqh') => `${(v * 100).toFixed(3)}${unit}`
  const lines = Math.max(1, label.lines)
  if (label.angle) {
    // 轴对齐外接框就是竖排文字自己的框（转 90° 没有斜边）：h 是文字长度、w 是行厚度
    const cx = label.x + label.w / 2
    const cy = label.y + label.h / 2
    const byThickness = (72 * label.w) / lines
    const byLength = (92 * label.h * lines) / emWidth(label.text)
    return `left:calc(${cq(cx, 'cqw')} - ${cq(label.h / 2, 'cqh')});top:calc(${cq(cy, 'cqh')} - ${cq(label.w / 2, 'cqw')});`
      + `width:${cq(label.h, 'cqh')};height:${cq(label.w, 'cqw')};`
      + `transform:rotate(${((label.angle * 180) / Math.PI).toFixed(2)}deg);`
      + `font-size:min(${byThickness.toFixed(2)}cqw,${byLength.toFixed(2)}cqh)`
  }
  const byHeight = (72 * label.h) / lines
  // 宽度上限：整段文字分成 lines 行，每行大约 emWidth / lines 个 em；留 8% 边距
  const byWidth = (92 * label.w * lines) / emWidth(label.text)
  return `left:${pct(label.x)};top:${pct(label.y)};width:${pct(label.w)};height:${pct(label.h)};font-size:min(${byHeight.toFixed(2)}cqh,${byWidth.toFixed(2)}cqw)`
}

/**
 * 给一张图插叠加层；幂等，重复渲染替换不叠加。返回叠加层节点。
 * 紧跟在图后面的镜像先删掉：镜像每会话只跑一次、跑在 OCR 之前，会插在图与叠加层之间——
 * 叠加层必须是图的**下一个**兄弟（锚点按"前面最近的同名锚点"解析，`img:has(+ .axt-img)` 也只认相邻）
 */
export function renderImage(target: ImageTarget, labels: readonly ImageLabel[]): Element {
  clearImage(target)
  const next = target.el.nextElementSibling
  if (next?.classList.contains(MIRROR_CLASS)) next.remove()
  const doc = target.el.ownerDocument
  const node = doc.createElement('div')
  node.className = IMG_CLASS
  node.setAttribute(FOR_ATTR, target.id)
  const lang = doc.documentElement.getAttribute(LANG_ATTR)
  for (const label of labels) {
    const span = doc.createElement('span')
    span.textContent = label.text
    span.title = label.source
    if (lang) span.setAttribute('lang', lang)
    span.setAttribute('style', labelStyle(label))
    node.append(span)
  }
  target.el.after(node)
  return node
}
