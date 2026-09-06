// 拖动分栏（实验，issue #83）：side 模式下中缝上的一条手柄，拖它改两栏比例。
//
// 机制上没有新东西——列线本来就只在 `.ltx_document` 上定义一次，其余容器 `subgrid` 继承
// （§7.2 的决定，为的是分界线不错开），所以改那一处，几百个容器自动跟随。
//
// 没有引 split-grid / react-resizable-panels：前者假设自己管理容器与 gutter 元素，
// 后者要求内容装进它的组件里，而我们是在 arXiv 原有 DOM 上原地做网格，§7.1 禁止包裹或替换原节点。
// 真正的难点是性能（拖一下就是整篇重排），那两个库都不解决——见 modes.css 里 data-axt-dragging 那段。
//
// 与 §7.1 一致：手柄是我们自己的节点，恢复原文时删掉就干净了；原节点一个属性都没动。
import { DOCUMENT_ROOT } from '@/core/rules/latexml'

export const HANDLE_CLASS = 'axt-split-handle'
/** 拖动进行中：`<html>` 上的这个属性同时开启中缝高亮与视口外跳过布局 */
export const DRAGGING_ATTR = 'data-axt-dragging'
/** 左栏占比（百分数）。CSS 里 `--axt-split-pct` 定位手柄，`--axt-split-l/r` 给网格轨道 */
export const SPLIT_PCT_VAR = '--axt-split-pct'

/** 两栏都要留得住内容：压到 15% 以下已经没法读了 */
const MIN_PCT = 15
const MAX_PCT = 85
export const DEFAULT_PCT = 50

const clamp = (pct: number) => Math.min(MAX_PCT, Math.max(MIN_PCT, pct))

/** 把比例写到 `.ltx_document` 上。两个 fr 之和恒为 100，gap 由 column-gap 单独占位 */
export function applySplit(root: Element, pct: number): number {
  const value = clamp(Math.round(pct * 10) / 10)
  const style = (root as HTMLElement).style
  style.setProperty(SPLIT_PCT_VAR, String(value))
  style.setProperty('--axt-split-l', `${value}fr`)
  // 右栏同样取整：100 - 68.2 在浮点里是 31.799999999999997，直接写进 CSS 很难看
  style.setProperty('--axt-split-r', `${Math.round((100 - value) * 10) / 10}fr`)
  return value
}

export function readSplit(root: Element): number {
  const raw = (root as HTMLElement).style.getPropertyValue(SPLIT_PCT_VAR)
  const value = Number.parseFloat(raw)
  return Number.isFinite(value) ? value : DEFAULT_PCT
}

export interface SplitHandleOptions {
  /** 松手时回调，用来存配置；拖动过程中不调用 */
  onCommit?: (pct: number) => void
  /** 初始比例（从配置读来的） */
  initial?: number
}

/**
 * 装上手柄，返回卸载函数。幂等：已经装过就只更新比例。
 * side 之外的模式由 CSS 隐藏手柄，不必在这里判模式——模式切换只改 `<html>` 上一个属性（§7.1）。
 */
export function installSplitHandle(doc: Document, options: SplitHandleOptions = {}): () => void {
  const root = doc.querySelector(DOCUMENT_ROOT)
  if (!root) return () => {}
  applySplit(root, options.initial ?? DEFAULT_PCT)

  const existing = root.querySelector(`:scope > .${HANDLE_CLASS}`)
  if (existing) return () => { existing.remove() }

  const handle = doc.createElement('div')
  handle.className = HANDLE_CLASS
  handle.setAttribute('role', 'separator')
  handle.setAttribute('aria-orientation', 'vertical')
  handle.setAttribute('aria-label', '拖动改变原文与译文的宽度')
  handle.tabIndex = 0
  // 插在最前面：配对规则里有 `> :last-child` 与 `:nth-last-child(2)`（摘要底部那条），
  // 都从尾部数，放在开头就不会把它们错开
  root.prepend(handle)

  const html = doc.documentElement
  let pointerId: number | null = null

  const pctFromClientX = (clientX: number) => {
    const box = root.getBoundingClientRect()
    if (box.width === 0) return readSplit(root)
    const ltr = doc.defaultView?.getComputedStyle(root).direction !== 'rtl'
    const offset = ltr ? clientX - box.left : box.right - clientX
    return (offset / box.width) * 100
  }

  const onPointerDown = (event: Event) => {
    const pointer = event as PointerEvent
    if (pointer.button !== 0) return
    pointerId = pointer.pointerId
    handle.setPointerCapture(pointerId)
    html.setAttribute(DRAGGING_ATTR, '')
    event.preventDefault()
  }

  const onPointerMove = (event: Event) => {
    const pointer = event as PointerEvent
    if (pointerId === null || pointer.pointerId !== pointerId) return
    applySplit(root, pctFromClientX(pointer.clientX))
  }

  const endDrag = (event: Event) => {
    const pointer = event as PointerEvent
    if (pointerId === null || pointer.pointerId !== pointerId) return
    handle.releasePointerCapture(pointerId)
    pointerId = null
    html.removeAttribute(DRAGGING_ATTR)
    options.onCommit?.(readSplit(root))
  }

  /** 双击复位，键盘也能调——手柄是 separator，读屏软件会念出来 */
  const onDoubleClick = () => {
    applySplit(root, DEFAULT_PCT)
    options.onCommit?.(DEFAULT_PCT)
  }

  const onKeyDown = (event: Event) => {
    const key = (event as KeyboardEvent).key
    const step = (event as KeyboardEvent).shiftKey ? 5 : 1
    const delta = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : key === 'Home' ? 0 : null
    if (delta === null) return
    event.preventDefault()
    applySplit(root, key === 'Home' ? DEFAULT_PCT : readSplit(root) + delta)
    options.onCommit?.(readSplit(root))
  }

  handle.addEventListener('pointerdown', onPointerDown)
  handle.addEventListener('pointermove', onPointerMove)
  handle.addEventListener('pointerup', endDrag)
  handle.addEventListener('pointercancel', endDrag)
  handle.addEventListener('dblclick', onDoubleClick)
  handle.addEventListener('keydown', onKeyDown)

  return () => {
    html.removeAttribute(DRAGGING_ATTR)
    handle.remove()
    const style = (root as HTMLElement).style
    for (const name of [SPLIT_PCT_VAR, '--axt-split-l', '--axt-split-r']) style.removeProperty(name)
    if ((root as HTMLElement).getAttribute('style') === '') root.removeAttribute('style')
  }
}
