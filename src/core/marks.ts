// 注入节点的共同标记：译文、镜像、拆分副本都带 axt-t（CLAUDE.md 硬规则 5 的前缀）。
// 放在 core 顶层：extractor 与 protector 要把这些节点当空气（再次翻译时它们已经在原块内部），
// 但它们不能反过来依赖 renderer。
export const T_CLASS = 'axt-t'
/**
 * 图片叠加层（DESIGN §15.2）：第三种注入标记，**不带** axt-t——带了会被 side 的配对网格排到右栏、
 * 拆图时把 <img> 当配对原件删掉、抑制镜像、被二十个样式预设装饰。它只是"我们的节点"，不是"译文节点"
 */
export const IMG_CLASS = 'axt-img'
/**
 * 悬停对照高亮的底色层（DESIGN §7.7）：第四种注入标记。**挂在 `<body>` 上、不在正文树里**——
 * 它是按行画出来的绝对定位矩形，不参与配对、不参与拆图、不被样式预设装饰；
 * 放进正文树会被当成译文节点处理。恢复原文时随 INJECTED_SELECTOR 一起删掉
 */
export const HL_CLASS = 'axt-hl'
/**
 * 只译文下悬浮出来的原文面板（DESIGN §7.7，issue #141）：第五种注入标记。与色带层一样挂在 `<body>` 上、
 * 不在正文树里；里面是原文那一句的克隆（不带 id 与 data-axt-*）。恢复原文时随 INJECTED_SELECTOR 一起删掉
 */
export const PEEK_CLASS = 'axt-peek'
/** 所有注入节点：提取、序列化、克隆清理、恢复原文都用这一个选择器 */
export const INJECTED_SELECTOR = `.${T_CLASS}, .${IMG_CLASS}, .${HL_CLASS}, .${PEEK_CLASS}`

/** 是不是我们注入的节点（译文 / 镜像 / 拆分副本 / 图片叠加层 / 色带层 / 原文面板）——提取与序列化都要跳过它们 */
export function isInjected(el: Element): boolean {
  return el.classList.contains(T_CLASS) || el.classList.contains(IMG_CLASS) || el.classList.contains(HL_CLASS) || el.classList.contains(PEEK_CLASS)
}

/** 所有注入属性的前缀（CLAUDE.md 硬规则 5） */
export const AXT_ATTR_PREFIX = 'data-axt-'

/**
 * 会执行脚本的 URL。克隆件里**不留这种**：链接的行为归原件，克隆只是拿来读的副本。
 * 只挡这两种，不做通用 URL 清洗——`data:image/...` 是论文里真实存在的内联图
 */
const UNSAFE_URL = /^\s*(?:javascript:|data:text\/html)/i
const URL_ATTRS = ['href', 'xlink:href', 'src', 'action', 'formaction', 'data']

/**
 * 克隆件入页之前的清理：删掉克隆里已有的注入节点（别人的译文 / 镜像会被整块复制进来），
 * 再剥掉 id（避免重复锚点，DESIGN §6.4）与全部 data-axt-* 标记（原块、占位符回填的脚注都可能带着块标记）。
 * 镜像、译文表、占位符回填、拆图以前各有一份几乎一样的实现，漂移过（issue #46）；现在只有这一份。
 * `includeRoot=false` 用于根节点是新建的译文壳、只清理被搬进来的子树。
 *
 * **行为属性一并去掉**（2026-09-11，独立审计 B17 实测）：回填出来的克隆带着原节点的 `onclick`，
 * 点下去真的会执行——译文里的副本是给人读的，不该是第二个可触发的控件，而且同一段行为在页面上
 * 出现两次本身就不对。arXiv 的 LaTeXML 不产出事件属性，所以今天没有暴露面；这是把不变量写死，
 * 不是修一个已知故障。Read Frog 的 `sanitizeInlineAtomClone` 做的是同一件事
 */
export function stripInjected(root: Element, includeRoot = true): void {
  for (const stale of Array.from(root.querySelectorAll(INJECTED_SELECTOR))) stale.remove()
  const targets = Array.from(root.querySelectorAll('*'))
  if (includeRoot) targets.unshift(root)
  for (const el of targets) {
    el.removeAttribute('id')
    for (const name of el.getAttributeNames()) {
      if (name.startsWith(AXT_ATTR_PREFIX) || name.toLowerCase().startsWith('on')) el.removeAttribute(name)
      else if (URL_ATTRS.includes(name.toLowerCase()) && UNSAFE_URL.test(el.getAttribute(name) ?? '')) el.removeAttribute(name)
    }
  }
}
