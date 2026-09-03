// runs 路径（DESIGN §6.5）：以 void 节点为分隔切段，paired 文字并入所在段（样式丢失），逐段翻译后按原顺序拼回。
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
  /** 反转义后的纯文本段，按 items 里出现的顺序 */
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
      runs.push(decodeText(buffer))
    } else {
      items.push({ kind: 'raw', text: decodeText(buffer) })
    }
    buffer = ''
  }
  for (const t of tokenize(block.text)) {
    if (t.kind === 'text') buffer += t.text
    else if (t.kind === 'void') {
      flush()
      items.push({ kind: 'void', id: t.id })
    }
    // open / close：paired 标签丢弃，其文字已并入 buffer
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
    if (item.kind === 'text') fragment.append(doc.createTextNode(translatedRuns[item.run]!))
    else if (item.kind === 'raw') fragment.append(doc.createTextNode(item.text))
    else fragment.append(cloneWithoutIds(doc, block.slots.get(item.id)!, true))
  }
  return fragment
}
