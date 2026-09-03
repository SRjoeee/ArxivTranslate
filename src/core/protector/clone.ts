/** 把槽位节点克隆到目标文档，并剥掉克隆子树内所有 id（避免重复锚点，§6.4）；href 等其他属性保留 */
export function cloneWithoutIds(doc: Document, node: Node, deep: boolean): Node {
  const clone = doc.importNode(node, deep)
  if (clone.nodeType === 1) {
    const el = clone as Element
    el.removeAttribute('id')
    for (const d of Array.from(el.querySelectorAll('[id]'))) d.removeAttribute('id')
  }
  return clone
}
