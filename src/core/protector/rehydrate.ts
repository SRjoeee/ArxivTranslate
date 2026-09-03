// 回填（DESIGN §6.4）：译文 → DocumentFragment。占位符换成原节点的克隆，按译文顺序放置；原节点不动。
import { cloneWithoutIds } from './clone'
import type { ProtectedBlock } from './serialize'
import { decodeText } from './text'
import { tokenize } from './tokens'
import { PlaceholderIntegrityError, validate } from './validate'

export function rehydrate(translated: string, block: ProtectedBlock, doc: Document): DocumentFragment {
  const v = validate(translated, block)
  if (!v.ok) throw new PlaceholderIntegrityError(v.reason, v.detail)

  const fragment = doc.createDocumentFragment()
  const stack: (DocumentFragment | Element)[] = [fragment]
  const top = () => stack[stack.length - 1]!

  for (const t of tokenize(translated)) {
    if (t.kind === 'text') {
      top().append(doc.createTextNode(decodeText(t.text)))
    } else if (t.kind === 'void') {
      top().append(cloneWithoutIds(doc, block.slots.get(t.id)!, true))
    } else if (t.kind === 'open') {
      const el = cloneWithoutIds(doc, block.slots.get(t.id)!, false) as Element
      top().append(el)
      stack.push(el)
    } else {
      stack.pop()
    }
  }
  return fragment
}
