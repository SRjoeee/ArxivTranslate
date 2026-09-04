// 模式的自动降级（DESIGN §7.2）：side 需要足够宽的视口，窄了自动退回 stack，变宽再回来。
// 用户手选的模式记为偏好，自动降级不覆盖偏好。
import { setMode, type Mode } from './index'

/** 与 arXiv 主题折叠导航栏的断点对齐；ar5iv 另有 46/52/96/109rem 断点（RESEARCH.md §3.2） */
export const NARROW_QUERY = '(max-width: 1279px)'

export interface ModeController {
  /** 用户选定的模式 */
  preference: () => Mode
  /** 实际写在 <html> 上的模式 */
  effective: () => Mode
  /** 选一个新模式；返回实际生效的那个 */
  choose: (mode: Mode) => Mode
  stop: () => void
}

interface MediaLike {
  matches: boolean
  addEventListener?: (type: 'change', listener: () => void) => void
  removeEventListener?: (type: 'change', listener: () => void) => void
}

export interface ModeControllerOptions {
  /** 测试注入；默认用 window.matchMedia，环境没有时视为不窄 */
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
