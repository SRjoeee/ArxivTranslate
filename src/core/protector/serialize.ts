// 序列化（DESIGN §6.2）：块 → 带占位符的文本 + 槽位表。纯读，不改 DOM。
// void / paired 的判定完全复用规则模块：classify() 命中任何类别（skip / protect / unit / table）即 void——
// 这同时覆盖了嵌套单元（脚注容器、段内 .ltx_p）；未命中且含文本的元素是 paired，未命中且无文本的也作 void。
import { classify } from '@/core/rules/latexml'
import { escapeText } from './text'

export interface ProtectedBlock {
  /** 带占位符的文本；文本节点里的 & < > 已转义 */
  text: string
  /** id → 原节点：void 为整个节点，paired 为元素本身（回填时浅克隆） */
  slots: Map<number, Node>
  paired: Set<number>
  /** 超过 VOID_DENSE_THRESHOLD 的块视为公式密集，由 pipeline 单独成批 */
  voidCount: number
}

export const VOID_DENSE_THRESHOLD = 40

const ELEMENT_NODE = 1
const TEXT_NODE = 3

const hasText = (el: Element) => /\S/.test(el.textContent ?? '')

export function serialize(root: Element): ProtectedBlock {
  const slots = new Map<number, Node>()
  const paired = new Set<number>()
  const parts: string[] = []
  let voidCount = 0
  let next = 1

  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        parts.push(escapeText((child as Text).data))
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element
        const id = next++
        slots.set(id, el)
        if (classify(el) || !hasText(el)) {
          voidCount++
          parts.push(`<x id="${id}"/>`)
        } else {
          paired.add(id)
          parts.push(`<t id="${id}">`)
          walk(el)
          parts.push('</t>')
        }
      }
      // 注释等其他节点忽略
    }
  }
  walk(root)
  return { text: parts.join(''), slots, paired, voidCount }
}
