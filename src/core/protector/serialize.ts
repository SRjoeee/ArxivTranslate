// 序列化（DESIGN §6.2）：块 → 带占位符的文本 + 槽位表。纯读，不改 DOM。
// void / paired 的判定完全复用规则模块：classify() 命中任何类别（skip / protect / unit / table）即 void——
// 这同时覆盖了嵌套单元（脚注容器、段内 .ltx_p）；未命中且含文本的元素是 paired，未命中且无文本的也作 void。
// 唯一例外是表格单元格（§5.3）：extractor 不下钻表格，格里的 .ltx_p / 标题不会另成块，
// 序列化时要当普通 paired 走进去，否则整格只剩一个占位符、文字全丢（实测 2410.00260 表 1；Codex 在 #5 指出）。
import { isInjected } from '@/core/marks'
import { FUNCTIONAL_INLINE, classify, isTableCell } from '@/core/rules/latexml'
import { escapeText } from './text'
import { type WireFormat, writeVoid } from './tokens'

export interface ProtectedBlock {
  /** 这个块是按哪种线上格式序列化的；validate / rehydrate / splitRuns 据此分词 */
  format: WireFormat
  /** 带占位符的文本；文本节点按 format 转义过（tags 转 & < >，markers 转会引起歧义的 @） */
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

export function serialize(root: Element, format: WireFormat = 'tags'): ProtectedBlock {
  const slots = new Map<number, Node>()
  const paired = new Set<number>()
  const parts: string[] = []
  let voidCount = 0
  let next = 1
  const inCell = isTableCell(root)

  const walk = (node: Element) => {
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === TEXT_NODE) {
        parts.push(escapeText((child as Text).data, format))
      } else if (child.nodeType === ELEMENT_NODE) {
        const el = child as Element
        // 我们自己插的译文 / 镜像不是原文：再次翻译时它们已经在原块内部（Codex 在 #8 指出）
        if (isInjected(el)) continue
        const c = classify(el)
        const isVoid = c ? !(inCell && c.kind === 'unit' && hasText(el)) : !hasText(el)
        // markers 没有成对记号（实测 Google 只有 70.6%，见 tokens.ts）：除了「带功能的元素」按 void
        // 整块保留以保住可点击（issue #44 在 runs 路径上的同一条判断），其余成对元素拍平成纯文本，
        // 丢的是内联包装的样式，不是内容
        const flatten = format === 'markers' && !isVoid && !el.matches(FUNCTIONAL_INLINE)
        if (flatten) {
          walk(el)
          continue
        }
        const id = next++
        slots.set(id, el)
        if (isVoid || format === 'markers') {
          voidCount++
          parts.push(writeVoid(id, format))
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
  return { format, text: parts.join(''), slots, paired, voidCount }
}
