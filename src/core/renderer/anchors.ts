// 页内锚点的兜底（issue #44）：only 模式把有译文的原块 `display: none`（§7.4），
// 指向那些块的交叉引用就此失效——目标没有布局盒，浏览器不知道往哪滚。
//
// 实测 2609.00246（Chromium，only 模式，整篇翻完）：61 个页内锚点的目标不可见，
// 点其中的「§7」（`#S7.p3.1`，目标是 `p.ltx_p`，`display: none`，`data-axt-state="translated"`）
// 后 `scrollY` 从 0 到 0——**一动没动**，而它的译文就在旁边。12 篇 fixture 里
// 3374 个页内锚点有 118 个（3.5%）的目标落在翻译块内，几乎全是 `.ltx_p`。
//
// 做法是把导航落到译文上，而不是把原文放出来：读者在 only 模式下点「见 §7」，
// 想看的是 §7 的中文。§7.4 也明确禁止用 `display: revert` 撤销隐藏（会连站点自己的 display 一起撤）。
// 与 §7.1 一致：不改 DOM，只挂事件；side / stack 下目标本来就可见，这里一次都不介入。
import type { Block } from '@/core/extractor'
import { ID_ATTR } from '@/core/extractor'
import { FOR_ATTR, T_CLASS } from './index'
import { MIRROR_CLASS } from './mirror'
import { PENDING_CLASS } from './pending'
import { ERROR_CLASS } from './failed'

/** 有布局盒才谈得上滚过去；`display: none` 的元素 `getClientRects()` 是空的 */
function visible(el: Element): boolean {
  return el.getClientRects().length > 0
}

/** `#S7.p3.1` → 元素。id 里的点不影响 getElementById，但 href 可能是转义过的 */
function targetOf(doc: Document, href: string): Element | null {
  if (!href.startsWith('#') || href.length < 2) return null
  const raw = href.slice(1)
  let id = raw
  try { id = decodeURIComponent(raw) } catch { /* 非法转义就按原样查 */ }
  return doc.getElementById(id) ?? doc.getElementById(raw)
}

/**
 * 目标不可见时的替身：目标自身或最近的祖先块，取它那条译文。
 * 挑的是**真译文**——镜像是右栏的配平副本、pending 是圆环、error 是失败小部件，
 * 滚到它们等于滚到一个空盒子
 */
function standIn(doc: Document, target: Element): Element | null {
  const block = target.closest(`[${ID_ATTR}]`)
  const id = block?.getAttribute(ID_ATTR)
  if (!id) return null
  for (const node of Array.from(doc.querySelectorAll(`.${T_CLASS}[${FOR_ATTR}="${CSS.escape(id)}"]`))) {
    if (node.classList.contains(MIRROR_CLASS) || node.classList.contains(PENDING_CLASS) || node.classList.contains(ERROR_CLASS)) continue
    if (visible(node)) return node
  }
  return null
}

/** 这个 href 该由我们接管吗？接管的话给出滚动目标 */
function resolve(doc: Document, href: string): Element | null {
  const target = targetOf(doc, href)
  // 目标不存在（外链、空 hash）或本来就看得见：交给浏览器，我们不掺和
  if (!target || visible(target)) return null
  return standIn(doc, target)
}

/**
 * 挂上兜底，返回卸载函数。content script 在会话开始时装、恢复原文时拆。
 * 三种入口都要管：点链接、地址栏改 hash / 站点脚本跳转（hashchange）、前进后退（popstate）
 */
export function installAnchorFallback(doc: Document): () => void {
  const view = doc.defaultView
  if (!view) return () => {}

  const scrollTo = (node: Element) => node.scrollIntoView({ block: 'start' })

  /**
   * 自己刚写进去的 hash：`location.hash = …` 派发的 `hashchange` 是**异步**的，
   * 同步的布尔守卫在事件到达前就被重置了，所以记住值而不是记一个标志
   */
  let selfNavHash: string | null = null

  /**
   * 换 hash 并滚过去。用 `location.hash` 而不是 `pushState`（Codex 在 #80 指出）：
   * 原生的锚点跳转会派发 `hashchange`，`pushState` 不会，页面脚本或别的扩展就观察不到
   * 「点了隐藏目标」这件事——而它们对地址栏改动、前进后退都收得到通知，行为不一致。
   * arXiv 自己眼下没有监听（实测 2609.00246：`hashchange` / `popstate` 注册数为 0，
   * `window.onhashchange` 为 null），所以这条是保住语义，不是修一个正在发生的 bug。
   * hash 没变时不写，避免多一条历史记录；无论写没写都要滚——原生行为就是点同一个锚点也照样跳
   */
  const navigate = (href: string, node: Element) => {
    const next = href.slice(1)
    if (view.location.hash.slice(1) !== next) {
      selfNavHash = `#${next}`
      try { view.location.hash = next } catch { selfNavHash = null }
    }
    scrollTo(node)
  }

  const onClick = (event: Event) => {
    if (event.defaultPrevented) return
    const mouse = event as MouseEvent
    // 中键、Ctrl/Cmd 点击是「在新标签打开」，不该被接管
    if (mouse.button !== 0 || mouse.metaKey || mouse.ctrlKey || mouse.shiftKey || mouse.altKey) return
    const anchor = (event.target as Element | null)?.closest?.('a[href]')
    if (!anchor) return
    // target 指向别的浏览上下文时，普通左键点击同样是「在新标签 / 别的框架里打开」——
    // 拦下来再 preventDefault 就把它变成了当前页跳转（Codex 在 #80 指出）。
    // arXiv 上一个都没有（12 篇 fixture 的 3386 个页内锚点全部不带 target），这是结构保证
    const target = anchor.getAttribute('target')
    if (target && target !== '_self') return
    const href = anchor.getAttribute('href') ?? ''
    const node = resolve(doc, href)
    if (!node) return
    event.preventDefault()
    navigate(href, node)
  }

  const onHashChange = () => {
    // 自己写的那次已经滚过了，再滚一遍是白做
    if (selfNavHash !== null && view.location.hash === selfNavHash) { selfNavHash = null; return }
    selfNavHash = null
    const node = resolve(doc, view.location.hash)
    if (node) scrollTo(node)
  }

  doc.addEventListener('click', onClick, true)
  view.addEventListener('hashchange', onHashChange)
  view.addEventListener('popstate', onHashChange)
  return () => {
    doc.removeEventListener('click', onClick, true)
    view.removeEventListener('hashchange', onHashChange)
    view.removeEventListener('popstate', onHashChange)
  }
}

/** 供测试与调试：这个块的锚点在当前模式下会不会失效 */
export function anchorWouldBreak(doc: Document, block: Block): boolean {
  return !visible(block.el) && standIn(doc, block.el) !== null
}
