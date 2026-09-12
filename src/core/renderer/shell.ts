// A block's translation container (ADR-0003): the element that carries a translation, a skeleton
// or a failure widget as the block's next sibling. Shared by translation.ts, pending.ts and
// failed.ts so the three never disagree about what a translation node looks like.
import type { Block, TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { eqnProseCell, isInlineTitleCandidate, visibleText } from '@/core/rules/latexml'

/** 原标题可见文本不超过这个长度才与译文同行 */
export const INLINE_TITLE_MAX_CHARS = 60

/** 译文节点的 class：原块的 class 加 axt-t，沿用站点样式（§7.1） */
export function translationClass(el: Element): string {
  const own = Array.from(el.classList).filter(c => c !== T_CLASS)
  return [...own, T_CLASS].join(' ')
}

/** 短标题与译文同行（§7.3）：pending 节点也按此放，译文到达时版式不跳 */
export function shouldInline(block: TextBlock): boolean {
  return isInlineTitleCandidate(block.el) && visibleText(block.el).trim().length <= INLINE_TITLE_MAX_CHARS
}

/**
 * 一个块的译文外壳：多数块就是「与原块同名的标签」，**说明行例外**——`<tr>` 里的内容必须装在
 * 单元格里，直接挂在行下表格布局根本不排它。返回 `node`（要插进页面的那个）与 `slot`（内容该
 * 放进去的那个），两者在非说明行时是同一个。
 *
 * 译文、骨架屏、失败小部件**三条路都走这里**：只给译文开特例的话，等待中的圆环会直接挂在
 * `<tr>` 下、失败小部件会变成 `<tbody>` 的 `<span>` 子节点，两者都不合表格的内容模型
 *（Codex 在 #168 指出）
 */
export function translationShell(block: Block, tagName?: string): { node: Element; slot: Element } {
  const doc = block.el.ownerDocument
  const node = doc.createElement(tagName ?? block.el.tagName)
  const cell = eqnProseCell(block.el)
  if (!cell) return { node, slot: node }
  const shell = cell.cloneNode(false) as Element
  // 壳里不留原格的 id 与块标记（§6.4 的理由相同：重复 id 会毁掉锚点）
  shell.removeAttribute('id')
  node.append(shell)
  return { node, slot: shell }
}
