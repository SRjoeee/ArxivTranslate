// 注入节点的共同标记：译文、镜像、拆分副本都带 axt-t（CLAUDE.md 硬规则 5 的前缀）。
// 放在 core 顶层：extractor 与 protector 要把这些节点当空气（再次翻译时它们已经在原块内部），
// 但它们不能反过来依赖 renderer。
export const T_CLASS = 'axt-t'

/** 是不是我们注入的节点（译文 / 镜像 / 拆分副本）——提取与序列化都要跳过它们 */
export function isInjected(el: Element): boolean {
  return el.classList.contains(T_CLASS)
}
