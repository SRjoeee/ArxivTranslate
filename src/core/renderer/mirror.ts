// side 模式的镜像节点（DESIGN §7.2）：左栏里没有译文的内容，在右栏放一份副本，
// 否则右栏空着、左栏内容横跨两栏，对照就断了。
//
// 判定按结构而不是按类名清单：容器里**没有配对、内部也不含译文**的直接子元素就是镜像目标。
// 早期版本列举 .ltx_equation / .ltx_graphics 之类，于是参考文献的序号、作者姓名、
// 列表编号这些同样没有译文的内容都漏在外面（实测 2609.00097）。
//
// 只在第一次进入 side 模式时生成，之后留在 DOM 里由 CSS 控制显隐，
// 所以模式切换仍然只改 <html> 上的一个属性。
import { DOCUMENT_ROOT, MARGIN_ASIDE } from '@/core/rules/latexml'
import { ID_ATTR } from '@/core/extractor'
import { FOR_ATTR, T_CLASS } from './index'
import { SIDE_CONTAINER, SIDE_STACK, isSideContainer } from './side-layout'

export const MIRROR_CLASS = 'axt-mirror'
/** 镜像用的 data-axt-for 前缀，避免与真实块 id 撞车 */
const MIRROR_ID_PREFIX = 'mirror:'
/** 没有文字也没有这些内容的元素不值得镜像（纯装饰、空白） */
const MEDIA = 'img, svg, object, math, table, canvas, video'

/** 克隆进镜像的内容不能带 id 与块标记，也不能带上别人的译文 */
function strip(root: Element): void {
  for (const stale of Array.from(root.querySelectorAll(`.${T_CLASS}`))) stale.remove()
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith('data-axt-')) el.removeAttribute(name)
  }
}

function needsMirror(child: Element): boolean {
  if (child.classList.contains(T_CLASS)) return false
  // ar5iv 浮到页面外缘的边注与出版元数据：镜像只会多一份重复（§7.2）
  if (child.matches(MARGIN_ASIDE)) return false
  // 翻译单元：已经有译文，或译文还在路上，都不该再来一份副本
  if (child.hasAttribute(ID_ATTR)) return false
  if (child.nextElementSibling?.classList.contains(T_CLASS)) return false
  // 内部含译文的元素本身是容器，它的子元素各自处理
  if (child.querySelector(`.${T_CLASS}`)) return false
  // 内部还有等待翻译的块：整块复制过去，译文到达后就会既有副本又有译文
  if (child.querySelector(`[${ID_ATTR}]`)) return false
  return /\S/.test(child.textContent ?? '') || child.querySelector(MEDIA) !== null || child.matches(MEDIA)
}

/**
 * 为容器内还没有配对的内容生成镜像；幂等，重复调用不会叠加。
 * 返回新建的镜像数量。
 */
export function createMirrors(root: Document | Element): number {
  const scope = root.querySelector(DOCUMENT_ROOT) ?? ('body' in root ? null : (root as Element))
  if (!scope) return 0
  // 翻译根也要满足"内部含有译文"才算容器。少了这一条，翻译开始前调用会把摘要、章节
  // 这些顶层元素整块复制到右栏——它们那时既没有译文也没有块标记（实测：整页内容重复一遍）
  if (!isSideContainer(scope)) return 0
  const containers = [scope, ...Array.from(scope.querySelectorAll(SIDE_CONTAINER))].filter(isSideContainer)
  let made = 0
  for (const container of containers) {
    if (container.classList.contains(MIRROR_CLASS)) continue
    // 堆叠区里没有右栏，镜像只会在同一列里多出一份重复（实测 2312.17141 的多面板插图）
    if (container.closest(SIDE_STACK)) continue
    for (const child of Array.from(container.children)) {
      if (!needsMirror(child)) continue
      const clone = child.cloneNode(true) as Element
      strip(clone)
      clone.classList.add(T_CLASS, MIRROR_CLASS)
      clone.setAttribute(FOR_ATTR, `${MIRROR_ID_PREFIX}${made}`)
      child.after(clone)
      made++
    }
  }
  return made
}
