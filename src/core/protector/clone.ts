// 译文节点的标记；写死一份常量避免 protector 依赖 renderer（保持单向依赖）
const TRANSLATION_CLASS = 'axt-t'
const AXT_ATTR_PREFIX = 'data-axt-'

/**
 * 把槽位节点克隆到目标文档，剥掉克隆子树内所有 id（避免重复锚点，§6.4）与 data-axt-* 标记；
 * 克隆里已有的译文节点整个删掉——脚注容器是 void 槽位，而它内部的 .ltx_note_content 是独立的块，
 * 先翻脚注、后翻外层段落时，外层译文会把脚注的译文一起复制进来（2026-09-04 实测）。
 * href 等其他属性保留。
 */
export function cloneWithoutIds(doc: Document, node: Node, deep: boolean): Node {
  const clone = doc.importNode(node, deep)
  if (clone.nodeType === 1) {
    const el = clone as Element
    for (const stale of Array.from(el.querySelectorAll(`.${TRANSLATION_CLASS}`))) stale.remove()
    for (const target of [el, ...Array.from(el.querySelectorAll('*'))]) {
      target.removeAttribute('id')
      for (const name of target.getAttributeNames()) if (name.startsWith(AXT_ATTR_PREFIX)) target.removeAttribute(name)
    }
  }
  return clone
}
