// runs 路径（DESIGN §6.5）：以 void 节点为分隔切段，paired 文字并入所在段（样式丢失），逐段翻译后按原顺序拼回。
//
// **带功能的元素不能只留文字**（issue #44）：样式丢了还能读，链接丢了就点不动了。
// 这类元素在这条路径上按 void 处理——整块原样保留、内部文字不翻。降级本来就是有损的，
// 保住行为比多翻几个词重要。实测 12 篇 fixture 的 4221 个翻译块里这种链接有 0 个
//（arXiv 正文的链接都是 .ltx_ref 或 mailto，规则层已当受保护节点），所以这条是结构保证与 v2 其他站点的兜底。
import { FUNCTIONAL_INLINE } from '@/core/rules/latexml'
import { cloneWithoutIds } from './clone'
import type { ProtectedBlock } from './serialize'
import { decodeText } from './text'
import { tokenize } from './tokens'

export type RunItem =
  | { kind: 'text'; run: number }
  | { kind: 'void'; id: number }
  /** 纯空白段：不送翻译，原样保留 */
  | { kind: 'raw'; text: string }

export interface RunLayout {
  items: RunItem[]
  /**
   * 送翻译的文本段，按 items 里出现的顺序，**保持线上形态（`& < >` 仍是实体）**。
   *
   * 曾经在这里就反转义，于是 `a &lt; b` 变成 `a < b` 发出去——而 `google-web` 的端点是
   * `translateHtml`，会把请求体当 HTML 解析；回来的 `&amp;` 又被 `joinRuns` 原样塞进文本节点，
   * 读者看到的就是实体本身（issue #111）。收发要对称：这里保持转义，`joinRuns` 那头解回来。
   */
  runs: string[]
}

export function splitRuns(block: ProtectedBlock): RunLayout {
  const items: RunItem[] = []
  const runs: string[] = []
  let buffer = ''
  const flush = () => {
    if (!buffer) return
    if (/\S/.test(buffer)) {
      items.push({ kind: 'text', run: runs.length })
      runs.push(buffer)
    } else {
      // raw 段不送翻译，直接进文本节点，所以在这里就解回来
      items.push({ kind: 'raw', text: decodeText(buffer) })
    }
    buffer = ''
  }
  const isFunctional = (id: number) => {
    const node = block.slots.get(id)
    return node?.nodeType === 1 && (node as Element).matches(FUNCTIONAL_INLINE)
  }
  // 跳过某个 paired 元素的整棵子树时要数嵌套深度，否则内层的 </t> 会提前收尾
  let skipDepth = 0
  for (const t of tokenize(block.text, block.format)) {
    if (skipDepth > 0) {
      if (t.kind === 'open') skipDepth++
      else if (t.kind === 'close') skipDepth--
      continue
    }
    if (t.kind === 'text') buffer += t.text
    else if (t.kind === 'void') {
      flush()
      items.push({ kind: 'void', id: t.id })
    } else if (t.kind === 'open' && isFunctional(t.id)) {
      // 带功能的元素整块保留：与 void 同样处理，内部内容一并跳过
      flush()
      items.push({ kind: 'void', id: t.id })
      skipDepth = 1
    }
    // 其余 open / close：paired 标签丢弃，其文字已并入 buffer
  }
  flush()
  return { items, runs }
}

export function joinRuns(translatedRuns: string[], layout: RunLayout, block: ProtectedBlock, doc: Document): DocumentFragment {
  if (translatedRuns.length !== layout.runs.length) {
    throw new Error(`runs 数量不符：期望 ${layout.runs.length}，得到 ${translatedRuns.length}`)
  }
  const fragment = doc.createDocumentFragment()
  for (const item of layout.items) {
    // 译文来自线上，实体在这一步解回来（见 RunLayout.runs 上的说明）
    if (item.kind === 'text') fragment.append(doc.createTextNode(decodeText(translatedRuns[item.run]!)))
    else if (item.kind === 'raw') fragment.append(doc.createTextNode(item.text))
    else fragment.append(cloneWithoutIds(doc, block.slots.get(item.id)!, true))
  }
  return fragment
}
