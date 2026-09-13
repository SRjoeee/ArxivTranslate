import { describe, expect, it, vi } from 'vitest'
import { MODE_ATTR } from '@/core/renderer/attrs'
import { createModeController } from '@/core/renderer/responsive'
/** A controllable stand-in for matchMedia */
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
  it('a wide viewport: side applies as it is', () => {
    const doc = docOf()
    const { media } = fakeMedia(false)
    const c = createModeController(doc, 'side', { media })
    expect(c.effective()).toBe('side')
    expect(modeOf(doc)).toBe('side')
  })

  it('a narrow viewport: side falls back to stack of itself, the preference still side', () => {
    const doc = docOf()
    const { media } = fakeMedia(true)
    const c = createModeController(doc, 'side', { media })
    expect(c.effective()).toBe('stack')
    expect(c.preference()).toBe('side')
    expect(modeOf(doc)).toBe('stack')
  })

  it('narrowing falls back of itself, widening returns to side of itself, with a callback', () => {
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

  it('stack and only are unaffected by the viewport', () => {
    const doc = docOf()
    const m = fakeMedia(true)
    const c = createModeController(doc, 'only', { media: m.media })
    expect(c.effective()).toBe('only')
    m.resize(false)
    expect(c.effective()).toBe('only')
  })

  it('choose returns the mode in effect: side on a narrow viewport gives stack', () => {
    const doc = docOf()
    const m = fakeMedia(true)
    const c = createModeController(doc, 'stack', { media: m.media })
    expect(c.choose('side')).toBe('stack')
    expect(c.preference()).toBe('side')
    expect(c.choose('only')).toBe('only')
    expect(modeOf(doc)).toBe('only')
  })

  it('after stop it no longer responds to viewport changes, the listener removed', () => {
    const doc = docOf()
    const m = fakeMedia(false)
    const c = createModeController(doc, 'side', { media: m.media })
    expect(m.listenerCount()).toBe(1)
    c.stop()
    expect(m.listenerCount()).toBe(0)
    m.resize(true)
    expect(c.effective()).toBe('side')
  })

  it('an environment without matchMedia counts as not narrow', () => {
    const doc = docOf()
    const c = createModeController(doc, 'side', { media: null })
    expect(c.effective()).toBe('side')
    expect(() => c.stop()).not.toThrow()
  })

  it('applying the same mode again does not call back again', () => {
    const doc = docOf()
    const m = fakeMedia(false)
    const onChange = vi.fn()
    const c = createModeController(doc, 'stack', { media: m.media, onChange })
    c.choose('stack')
    expect(onChange).not.toHaveBeenCalled()
  })
})
