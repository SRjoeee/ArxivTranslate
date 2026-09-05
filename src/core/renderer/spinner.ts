// 移植自 reference/read-frog/src/utils/host/translate/ui/spinner.ts@9b44f82（GPL-3.0），2026-09-05 移植、有修改：
// class 改 axt-spinner、颜色变量改 --axt-muted（由 modes.css 在 html[data-axt-on] 上定义，不需要它的 ensurePresetStyles）；
// 去掉 getTranslatedTextAndRemoveSpinner——那是它的请求胶水（含 React 错误组件），我们的请求胶水在 pipeline/run.ts；
// 加 cancelSpinnersIn：删任何含圆环的节点前先取消动画（DESIGN §7.6）。

export const SPINNER_CLASS = 'axt-spinner'

/**
 * 同时转动的圆环上限。几千个 WAAPI 动画每帧都触发整页样式重算，长页面会把主线程吃满
 *（它的 #1881：实测 2400 多个并发圆环）。超出上限的段落用静止的灰环。
 */
export const MAX_ANIMATED_SPINNERS = 60

/**
 * 每个圆环的动画句柄。文档里有几千个动画时 Element.getAnimations() 很贵
 *（#1881 的采样里占 10% CPU），存下来取消就是 O(1)。
 */
const spinnerAnimations = new WeakMap<HTMLElement, Animation>()
let activeSpinnerAnimationCount = 0

/**
 * 取消圆环的旋转动画。跑着的动画会把已脱离文档的目标钉在渲染器里，每个翻译过的段落漏一个节点（#1831），
 * 所以每条删节点的路径都要先调这个。
 */
export function cancelSpinnerAnimation(spinner: HTMLElement): void {
  const animation = spinnerAnimations.get(spinner)
  if (animation) {
    spinnerAnimations.delete(spinner)
    activeSpinnerAnimationCount = Math.max(0, activeSpinnerAnimationCount - 1)
    animation.cancel()
    return
  }
  // 兜底：注册表里没有的（happy-dom / jsdom 没有 getAnimations，所以 ?.）
  spinner.getAnimations?.().forEach(live => live.cancel())
}

/**
 * 轻量圆环：不用 React / Shadow DOM，用 Web Animations API 而不是 CSS keyframes，不往页面注入样式。
 * 内联 !important 样式，站点 CSS 盖不掉。细的灰色弧线加透明的其余边，整页几百个也不会刺眼。
 */
export function createLightweightSpinner(ownerDoc: Document): HTMLElement {
  const spinner = ownerDoc.createElement('span')
  spinner.className = SPINNER_CLASS
  spinner.style.cssText = `
    display: inline-block !important;
    width: 6px !important;
    height: 6px !important;
    min-width: 6px !important;
    min-height: 6px !important;
    max-width: 6px !important;
    max-height: 6px !important;
    aspect-ratio: 1 / 1 !important;
    margin: 0 4px !important;
    padding: 0 !important;
    vertical-align: middle !important;
    border: 1.5px solid transparent !important;
    border-top: 1.5px solid var(--axt-muted) !important;
    border-radius: 50% !important;
    box-sizing: content-box !important;
    flex-shrink: 0 !important;
    flex-grow: 0 !important;
    align-self: center !important;
  `

  // 尊重用户的减少动效设置
  const prefersReducedMotion = ownerDoc.defaultView?.matchMedia
    ? ownerDoc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
  if (!prefersReducedMotion && typeof spinner.animate === 'function' && activeSpinnerAnimationCount < MAX_ANIMATED_SPINNERS) {
    const animation = spinner.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 600, iterations: Infinity, easing: 'linear' },
    )
    // 取消时 finished 会以 AbortError 拒绝：规范把它标成已处理，happy-dom 没有，会当未处理的拒绝报出来
    animation.finished?.catch(() => undefined)
    spinnerAnimations.set(spinner, animation)
    activeSpinnerAnimationCount++
  } else {
    // 减少动效 / 没有 WAAPI / 超过上限：保留一段静止的灰弧，等待态仍可见
    spinner.style.borderTopColor = 'var(--axt-muted)'
  }

  return spinner
}

/** 在宿主节点末尾放一个圆环 */
export function createSpinnerInside(host: HTMLElement): HTMLElement {
  const spinner = createLightweightSpinner(host.ownerDocument)
  host.appendChild(spinner)
  return spinner
}

/** 删掉一棵子树之前调用：把里面（含根自己）所有圆环的动画取消 */
export function cancelSpinnersIn(root: Element): void {
  if (root.classList.contains(SPINNER_CLASS)) cancelSpinnerAnimation(root as HTMLElement)
  for (const spinner of Array.from(root.querySelectorAll<HTMLElement>(`.${SPINNER_CLASS}`))) cancelSpinnerAnimation(spinner)
}

/** 当前在转的圆环数（测试用） */
export function activeSpinnerAnimations(): number {
  return activeSpinnerAnimationCount
}
