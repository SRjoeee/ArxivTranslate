// 注入节点的共同标记：译文、镜像、拆分副本都带 axt-t（CLAUDE.md 硬规则 5 的前缀）。
// 放在 core 顶层：extractor 与 protector 要把这些节点当空气（再次翻译时它们已经在原块内部），
// 但它们不能反过来依赖 renderer。
export const T_CLASS = 'axt-t'

/** 是不是我们注入的节点（译文 / 镜像 / 拆分副本）——提取与序列化都要跳过它们 */
export function isInjected(el: Element): boolean {
  return el.classList.contains(T_CLASS)
}

/** 所有注入属性的前缀（CLAUDE.md 硬规则 5） */
export const AXT_ATTR_PREFIX = 'data-axt-'

/**
 * 克隆件入页之前的清理：删掉克隆里已有的注入节点（别人的译文 / 镜像会被整块复制进来），
 * 再剥掉 id（避免重复锚点，DESIGN §6.4）与全部 data-axt-* 标记（原块、占位符回填的脚注都可能带着块标记）。
 * 镜像、译文表、占位符回填、拆图以前各有一份几乎一样的实现，漂移过（issue #46）；现在只有这一份。
 * `includeRoot=false` 用于根节点是新建的译文壳、只清理被搬进来的子树
 */
export function stripInjected(root: Element, includeRoot = true): void {
  for (const stale of Array.from(root.querySelectorAll(`.${T_CLASS}`))) stale.remove()
  const targets = Array.from(root.querySelectorAll('*'))
  if (includeRoot) targets.unshift(root)
  for (const el of targets) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) if (name.startsWith(AXT_ATTR_PREFIX)) el.removeAttribute(name)
  }
}
