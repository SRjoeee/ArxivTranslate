import { describe, expect, it, vi } from 'vitest'
import { MODE_ATTR, createModeController } from '@/core/renderer'

/** 可控的 matchMedia 替身 */
function fakeMedia(matches: boolean) {
  const listeners = new Set<() => void>()
  return {
    media: {
      get matches() { return matches },
      addEventListener: (_: 'change', l: () => void) => { listeners.add(l) },
      removeEventListener: (_: 'change', l: () => void) => { listeners.delete(l) },
    },
    resize(next: boolean) { matches = next; for (const l of listeners) l() },
    listenerCount: () => listeners.size,
  }
}

const docOf = () => new DOMParser().parseFromString('<!doctype html><html><body></body></html>', 'text/html')
const modeOf = (doc: Document) => doc.documentElement.getAttribute(MODE_ATTR)

describe('createModeController', () => {
  it('宽视口：side 原样生效', () => {
    const doc = docOf()
    const { media } = fakeMedia(false)
    const c = createModeController(doc, 'side', { media })
    expect(c.effective()).toBe('side')
    expect(modeOf(doc)).toBe('side')
  })

  it('窄视口：side 自动降级为 stack，但偏好仍是 side', () => {
    const doc = docOf()
    const { media } = fakeMedia(true)
    const c = createModeController(doc, 'side', { media })
    expect(c.effective()).toBe('stack')
    expect(c.preference()).toBe('side')
    expect(modeOf(doc)).toBe('stack')
  })

  it('变窄自动降级，变宽自动回到 side，并回调', () => {
    const doc = docOf()
    const m = fakeMedia(false)
    const seen: string[] = []
    const c = createModeController(doc, 'side', { media: m.media, onChange: e => seen.push(e) })
    m.resize(true)
    expect(c.effective()).toBe('stack')
    m.resize(false)
    expect(c.effective()).toBe('side')
    expect(seen).toEqual(['stack', 'side'])
    expect(c.preference()).toBe('side')
  })

  it('stack 与 only 不受视口影响', () => {
    const doc = docOf()
    const m = fakeMedia(true)
    const c = createModeController(doc, 'only', { media: m.media })
    expect(c.effective()).toBe('only')
    m.resize(false)
    expect(c.effective()).toBe('only')
  })

  it('choose 返回实际生效的模式：窄视口选 side 得到 stack', () => {
    const doc = docOf()
    const m = fakeMedia(true)
    const c = createModeController(doc, 'stack', { media: m.media })
    expect(c.choose('side')).toBe('stack')
    expect(c.preference()).toBe('side')
    expect(c.choose('only')).toBe('only')
    expect(modeOf(doc)).toBe('only')
  })

  it('stop 之后不再响应视口变化，监听器被移除', () => {
    const doc = docOf()
    const m = fakeMedia(false)
    const c = createModeController(doc, 'side', { media: m.media })
    expect(m.listenerCount()).toBe(1)
    c.stop()
    expect(m.listenerCount()).toBe(0)
    m.resize(true)
    expect(c.effective()).toBe('side')
  })

  it('没有 matchMedia 的环境视为不窄', () => {
    const doc = docOf()
    const c = createModeController(doc, 'side', { media: null })
    expect(c.effective()).toBe('side')
    expect(() => c.stop()).not.toThrow()
  })

  it('同一个模式重复应用不重复回调', () => {
    const doc = docOf()
    const m = fakeMedia(false)
    const onChange = vi.fn()
    const c = createModeController(doc, 'stack', { media: m.media, onChange })
    c.choose('stack')
    expect(onChange).not.toHaveBeenCalled()
  })
})
