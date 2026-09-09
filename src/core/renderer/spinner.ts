// Ported from reference/read-frog/src/utils/host/translate/ui/spinner.ts@9b44f82 (GPL-3.0), 2026-09-05; modified:
// class → axt-spinner, color → --axt-muted (defined on html[data-axt-on] in modes.css; no ensurePresetStyles needed);
// removed getTranslatedTextAndRemoveSpinner (upstream request glue with React errors; ours lives in pipeline/run.ts);
// added cancelSpinnersIn to cancel animations before removing any spinner-containing node (DESIGN §7.6).

export const SPINNER_CLASS = 'axt-spinner'

/**
 * Cap simultaneously animated spinners. Thousands of WAAPI animations trigger page-wide style recalculation every frame,
 * saturating the main thread on long pages (Read Frog #1881 measured over 2,400 concurrent spinners). Excess spinners stay gray and static.
 */
export const MAX_ANIMATED_SPINNERS = 60

/**
 * Animation handles per spinner. Element.getAnimations() is costly with thousands of animations
 * (10% CPU in #1881 samples); stored handles allow O(1) cancellation.
 */
const spinnerAnimations = new WeakMap<HTMLElement, Animation>()
let activeSpinnerAnimationCount = 0

/**
 * Cancel rotation before every removal path. Active animations retain detached targets in the renderer,
 * leaking one node per translated paragraph (#1831).
 */
export function cancelSpinnerAnimation(spinner: HTMLElement): void {
  const animation = spinnerAnimations.get(spinner)
  if (animation) {
    spinnerAnimations.delete(spinner)
    activeSpinnerAnimationCount = Math.max(0, activeSpinnerAnimationCount - 1)
    animation.cancel()
    return
  }
  // Fallback for unregistered animations; happy-dom / jsdom lack getAnimations, hence optional chaining.
  for (const live of spinner.getAnimations?.() ?? []) live.cancel()
}

/**
 * Lightweight spinner: native DOM, no React / Shadow DOM. Use WAAPI instead of CSS keyframes; inject no stylesheets.
 * Inline !important prevents site overrides. A thin gray arc with transparent remaining borders stays unobtrusive even in hundreds.
 */
export function createLightweightSpinner(ownerDoc: Document): HTMLElement {
  const spinner = ownerDoc.createElement('span')
  spinner.className = SPINNER_CLASS
  // Decorative only: popup progress announces pending state; do not read every block's spinner aloud.
  spinner.setAttribute('aria-hidden', 'true')
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

  // Respect reduced-motion preferences.
  const prefersReducedMotion = ownerDoc.defaultView?.matchMedia
    ? ownerDoc.defaultView.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false
  if (!prefersReducedMotion && typeof spinner.animate === 'function' && activeSpinnerAnimationCount < MAX_ANIMATED_SPINNERS) {
    const animation = spinner.animate(
      [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }],
      { duration: 600, iterations: Infinity, easing: 'linear' },
    )
    // Cancellation rejects finished with AbortError. The spec marks it handled; happy-dom does not, causing unhandled-rejection reports.
    animation.finished?.catch(() => undefined)
    spinnerAnimations.set(spinner, animation)
    activeSpinnerAnimationCount++
  } else {
    // Reduced motion / missing WAAPI / cap exceeded: keep a static gray arc so pending state remains visible.
    spinner.style.borderTopColor = 'var(--axt-muted)'
  }

  return spinner
}

/** Append a spinner to the host. */
export function createSpinnerInside(host: HTMLElement): HTMLElement {
  const spinner = createLightweightSpinner(host.ownerDocument)
  host.appendChild(spinner)
  return spinner
}

/** Before removing a subtree, cancel every spinner animation in it, including the root. */
export function cancelSpinnersIn(root: Element): void {
  if (root.classList.contains(SPINNER_CLASS)) cancelSpinnerAnimation(root as HTMLElement)
  for (const spinner of Array.from(root.querySelectorAll<HTMLElement>(`.${SPINNER_CLASS}`))) cancelSpinnerAnimation(spinner)
}

/** Number of currently animated spinners (tests). */
export function activeSpinnerAnimations(): number {
  return activeSpinnerAnimationCount
}
