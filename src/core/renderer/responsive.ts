// Automatic mode fallback (DESIGN §7.2): side needs a wide viewport; use stack when narrow and restore side when wide again.
// Preserve the user's preferred mode; automatic fallback never overwrites it.
import { setMode, type Mode } from './index'

/** Match arXiv's navigation-collapse breakpoint; ar5iv also uses 46/52/96/109rem breakpoints (RESEARCH.md §3.2). */
export const NARROW_QUERY = '(max-width: 1279px)'

export interface ModeController {
  /** User-selected mode. */
  preference: () => Mode
  /** Mode actually applied to <html>. */
  effective: () => Mode
  /** Select a new mode; return the effective mode. */
  choose: (mode: Mode) => Mode
  stop: () => void
}

interface MediaLike {
  matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

export interface ModeControllerOptions {
  /** Test injection; defaults to window.matchMedia, or non-narrow if unavailable. */
  media?: MediaLike | null
  onChange?: (effective: Mode, preference: Mode) => void
}

const resolve = (preference: Mode, narrow: boolean): Mode => (preference === 'side' && narrow ? 'stack' : preference)

export function createModeController(doc: Document, preference: Mode, options: ModeControllerOptions = {}): ModeController {
  const media = options.media !== undefined
    ? options.media
    : (typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia(NARROW_QUERY) : null)

  let current = preference
  let applied = resolve(current, media?.matches ?? false)

  const apply = (next: Mode) => {
    if (next === applied) return
    applied = next
    setMode(doc, next)
    options.onChange?.(next, current)
  }

  const onMediaChange = () => apply(resolve(current, media?.matches ?? false))
  media?.addEventListener?.('change', onMediaChange)
  setMode(doc, applied)

  return {
    preference: () => current,
    effective: () => applied,
    choose(mode: Mode) {
      current = mode
      apply(resolve(current, media?.matches ?? false))
      return applied
    },
    stop() {
      media?.removeEventListener?.('change', onMediaChange)
    },
  }
}
