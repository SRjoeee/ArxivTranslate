// 等待态的译文节点（DESIGN §7.6，照 Read Frog 的做法）：请求发出之前先插在原块后面，里面只有一个圆环；
// 译文到达后被真译文替换——renderText / renderTable 开头的 clearTranslation 会删掉同 data-axt-for 的兄弟。
// 与 §7.1 一致：它只是原块的下一个兄弟，原节点不动。
import type { Block, TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR, INLINE_ATTR, shouldInline, translationClass } from './index'
import { cancelSpinnersIn, createSpinnerInside } from './spinner'

export const PENDING_CLASS = 'axt-pending'

function pendingOf(block: Block): Element | null {
  const next = block.el.nextElementSibling
  return next?.classList.contains(PENDING_CLASS) && next.getAttribute(FOR_ATTR) === block.id ? next : null
}

/**
 * 插 pending 节点：与原块同标签（表格块用 div——整表克隆到了才是 table）、沿用原块 class 加 axt-t axt-pending。
 * 幂等：已有就返回它。短标题按 §7.3 同行，圆环跟在标题后面，译文到达时版式不跳
 */
export function renderPending(block: Block): Element {
  const existing = pendingOf(block)
  if (existing) return existing
  const doc = block.el.ownerDocument
  const node = doc.createElement(block.kind === 'table' ? 'div' : block.el.tagName)
  node.className = `${translationClass(block.el)} ${PENDING_CLASS}`
  node.setAttribute(FOR_ATTR, block.id)
  if (block.kind === 'text' && shouldInline(block as TextBlock)) {
    block.el.setAttribute(INLINE_ATTR, '')
    node.setAttribute(INLINE_ATTR, '')
  }
  createSpinnerInside(node as HTMLElement)
  block.el.after(node)
  return node
}

/** 删掉块的 pending 节点（失败 / 停止时）；译文到达走 renderText，不用调这个 */
export function clearPending(block: Block): boolean {
  const node = pendingOf(block)
  if (!node) return false
  cancelSpinnersIn(node)
  node.remove()
  return true
}

/** 停止会话：页面上所有 pending 节点一起删，返回删掉的数量 */
export function clearAllPending(doc: Document): number {
  const nodes = Array.from(doc.querySelectorAll(`.${PENDING_CLASS}`))
  for (const node of nodes) {
    cancelSpinnersIn(node)
    node.remove()
  }
  return nodes.length
}
