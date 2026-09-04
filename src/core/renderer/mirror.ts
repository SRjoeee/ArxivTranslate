// side 模式的镜像节点（DESIGN §7.2）：公式、图表这类没有译文的块，在右栏放一份副本，
// 否则它们会横跨两栏、把左右对照打断。副本标成 .axt-t.axt-mirror，
// 于是恢复原文、去重、配对样式全都复用译文节点那套，不需要另一套机制。
//
// 只在第一次进入 side 模式时生成（实测一篇论文要复制约三分之一的正文节点），
// 之后留在 DOM 里由 CSS 控制显隐——所以模式切换仍然只改 <html> 上的一个属性。
import { MIRROR_SELECTORS } from '@/core/rules/latexml'
import { FOR_ATTR, T_CLASS } from './index'

export const MIRROR_CLASS = 'axt-mirror'
/** 镜像用的 data-axt-for 前缀，避免与真实块 id 撞车 */
const MIRROR_ID_PREFIX = 'mirror:'

/** 克隆进镜像的内容不能带 id 与块标记，否则会有重复锚点、重复统计 */
function strip(root: Element): void {
  for (const stale of Array.from(root.querySelectorAll(`.${T_CLASS}`))) stale.remove()
  for (const el of [root, ...Array.from(root.querySelectorAll('*'))]) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith('data-axt-')) el.removeAttribute(name)
  }
}

const alreadyPaired = (el: Element): boolean => el.nextElementSibling?.classList.contains(T_CLASS) === true

/**
 * 为容器内还没有配对的块级内容生成镜像；幂等，重复调用不会叠加。
 * 返回新建的镜像数量。
 */
export function createMirrors(root: Document | Element): number {
  const scope = 'querySelectorAll' in root ? root : root
  let made = 0
  const targets = Array.from(scope.querySelectorAll(MIRROR_SELECTORS))
  for (const el of targets) {
    if (el.classList.contains(MIRROR_CLASS) || el.closest(`.${MIRROR_CLASS}`)) continue
    // 嵌套的（如 figure 里的 picture）只镜像最外层，避免右栏出现两份
    if (el.parentElement?.closest(MIRROR_SELECTORS)) continue
    if (alreadyPaired(el)) continue
    const clone = el.cloneNode(true) as Element
    strip(clone)
    clone.classList.add(T_CLASS, MIRROR_CLASS)
    clone.setAttribute(FOR_ATTR, `${MIRROR_ID_PREFIX}${made}`)
    el.after(clone)
    made++
  }
  return made
}
