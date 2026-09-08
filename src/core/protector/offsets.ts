// 线上文本的字符偏移 ↔ DOM Range（DESIGN §6.2 的配套）。
//
// 句子对齐的坐标系是**线上文本**——微软的 `sentLen` 就是在我们发出去的那串上量的（issue #105）。
// 要把它变成可高亮的 `Range`，需要「线上偏移 → 文本节点 + 节点内偏移」的映射。
//
// 难点在于线上文本与节点内容不是逐字符对应的：`escapeText` 会把 `&` 变成 `&amp;`、`@` 变成 `@@`，
// `serialize` 出口还会折叠 HTML 空白（#119）。两种变换都是**逐字符、上下文无关**的，
// 所以不必存逐字符表，只在「输入一个字符、输出不是一个字符」的地方记一个锚点，
// 锚点之间是严格 1:1，中间靠加法算。

/** 线上文本的一段与它来自的文本节点 */
export interface TextSpan {
  node: Text
  /** 在线上文本里的区间 `[from, to)` */
  from: number
  to: number
  /**
   * 分叉点：`[线上偏移, 节点内偏移]`，两个锚点之间严格 1:1。
   * 第一个锚点总是 `[from, 0]`（节点开头可能被折叠吃掉前导空白，所以节点侧未必是 0——见构造处）
   */
  anchors: readonly (readonly [number, number])[]
}

/** 线上偏移 → 节点内偏移。锚点之间 1:1，所以取最后一个不超过它的锚点再加差值 */
export function nodeOffsetAt(span: TextSpan, wireOffset: number): number {
  const clamped = Math.max(span.from, Math.min(wireOffset, span.to))
  let lo = 0
  let hi = span.anchors.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (span.anchors[mid]![0] <= clamped) lo = mid
    else hi = mid - 1
  }
  const [wire, node] = span.anchors[lo]!
  return Math.min(node + (clamped - wire), span.node.data.length)
}

/** 落在这个线上偏移上的段；偏移正好在两段之间时取后一段（`side: 'end'` 取前一段） */
export function spanAt(spans: readonly TextSpan[], wireOffset: number, side: 'start' | 'end' = 'start'): TextSpan | undefined {
  if (spans.length === 0) return undefined
  if (side === 'end') {
    for (let i = spans.length - 1; i >= 0; i--) if (spans[i]!.from < wireOffset) return spans[i]
    return spans[0]
  }
  for (const span of spans) if (wireOffset < span.to) return span
  return spans[spans.length - 1]
}

/**
 * 线上区间 `[from, to)` → `Range`。区间跨占位符时，Range 从第一段的起点跨到最后一段的终点，
 * 中间的受保护节点自然被包进去——高亮一句话时公式也该亮，这是想要的行为。
 *
 * 落不到任何文本段上（整段都是占位符）时返回 `undefined`，调用方按「这一句没有高亮」处理。
 */
export function rangeOf(spans: readonly TextSpan[], from: number, to: number): Range | undefined {
  if (spans.length === 0 || to <= from) return undefined
  const startSpan = spanAt(spans, from, 'start')
  const endSpan = spanAt(spans, to, 'end')
  if (!startSpan || !endSpan) return undefined
  // Range 必须由节点自己的 document 创建，否则跨文档、`toString()` 返回空串（写这个模块时踩到）
  const range = startSpan.node.ownerDocument.createRange()
  range.setStart(startSpan.node, nodeOffsetAt(startSpan, from))
  range.setEnd(endSpan.node, nodeOffsetAt(endSpan, to))
  return range
}
