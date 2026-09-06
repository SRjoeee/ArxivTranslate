// 等待态的译文节点（DESIGN §7.6，照 Read Frog 的做法）：请求发出之前先插在原块后面，里面只有一个圆环；
// 译文到达后被真译文替换——renderText / renderTable 开头的 clearTranslation 会删掉同 data-axt-for 的兄弟。
// 与 §7.1 一致：它只是原块的下一个兄弟，原节点不动。
import type { Block, TextBlock } from '@/core/extractor'
import { FOR_ATTR, INLINE_ATTR, clearTranslation, setState, shouldInline, translationClass } from './index'
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
  // 重试路径要**整块回到等待态**，上一轮留下的东西一样不能剩：
  //   - 失败小部件（`.axt-error`）：`pendingOf` 认不出它，圆环会插在原块与它之间，
  //     读者同时看到"正在翻"和"！重试"，side 模式下右栏还多一项（Codex 在 #36 指出）；
  //   - `data-axt-state="failed"`：modes.css 按它画红线，不清的话重试期间圆环在转、红线还在（#76）；
  //   - **半翻的表格**：`cells.size > 0` 那条路走的是 `renderTable` + `markPartial`，
  //     **不建小部件**却把块记成 failed（run.ts:240-246）。所以重置不能挂在"删掉了小部件"上——
  //     那种块 `clearFailed` 返回 false，旧克隆、`data-axt-partial` 与 translated 状态会原样留着（#81）。
  // `clearTranslation` 把同 id 的译文 / 半成品 / 小部件一并清掉，`setState` 顺带清掉 partial 标记
  clearTranslation(block)
  setState(block, 'pending')
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
