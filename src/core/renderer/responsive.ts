// Automatic mode fallback (DESIGN §7.2): side needs a wide enough viewport; a narrow one falls back to stack and
// returns when widened. The mode the reader picked is recorded as the preference; the fallback never overwrites it.
import type { Mode } from './attrs'
import { setMode } from './page'

/** Aligned with the breakpoint at which the arXiv theme collapses its navigation bar; ar5iv also has 46/52/96/109rem breakpoints (RESEARCH.md §3.2) */
export const NARROW_QUERY = '(max-width: 1279px)'

export interface ModeController {
  /** The mode the reader chose */
  preference: () => Mode
  /** The mode actually written on <html> */
  effective: () => Mode
  /** Choose a new mode; returns the one in effect */
  choose: (mode: Mode) => Mode
  stop: () => void
}

interface MediaLike {
  matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

export interface ModeControllerOptions {
  /** Test injection; window.matchMedia by default, and “not narrow” where the environment has none */
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
