import { createElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdvancedCss } from '@/ui/appearance/AdvancedCss'
import { setLocale } from '@/ui/strings'
import { deferred, mountElement } from './render-hook'

// The advanced CSS box of a style profile (ui/appearance/AdvancedCss.tsx): a draft of its own that follows the
// profile when that changes elsewhere, and never loses the reader's typing to it. `onChange` answers with the
// write; the test decides when each lands

const box = (container: HTMLElement) => container.querySelector('textarea') as HTMLTextAreaElement
const type = (textarea: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}
const open = async (mounted: Awaited<ReturnType<typeof mountElement>>) => {
  const toggle = mounted.container.querySelector('button') as HTMLButtonElement
  if (toggle.getAttribute('aria-expanded') !== 'true') {
    toggle.click()
    await mounted.flush()
  }
}

/** A parent whose writes land when the test says: `land()` resolves the oldest write, `refuse()` rejects it */
function parent(initial: string) {
  const writes: { css: string; ack: ReturnType<typeof deferred<void>> }[] = []
  const onChange = (css: string) => { const ack = deferred<void>(); writes.push({ css, ack }); return ack.promise }
  return {
    onChange,
    writes,
    element: (value: string) => createElement(AdvancedCss, { value, onChange }),
    initial,
    land: () => writes.shift()?.ack.resolve(),
    refuse: () => writes.shift()?.ack.reject(new Error('quota')),
  }
}

describe('AdvancedCss', () => {
  beforeEach(() => { setLocale('en') })

  it('follows a block saved elsewhere when nothing of its own is out', async () => {
    const p = parent('color: red;')
    const mounted = await mountElement(p.element('color: red;'))
    expect(box(mounted.container).value).toBe('color: red;')
    await mounted.rerender(p.element('color: blue;'))
    expect(box(mounted.container).value).toBe('color: blue;')
    await mounted.unmount()
  })

  it('keeps a refused block while the profile changes elsewhere', async () => {
    // The eighth local pass of S1: tab A holds `color: {`, tab B saves other CSS for the profile, A's text was snapped away
    const p = parent('color: red;')
    const mounted = await mountElement(p.element('color: red;'))
    await open(mounted)
    type(box(mounted.container), 'color: {')
    await mounted.flush()
    await mounted.rerender(p.element('color: blue;'))
    expect(box(mounted.container).value).toBe('color: {')
    await mounted.unmount()
  })

  it('its own blocks landing later are not news: the second keystroke survives the first echo', async () => {
    const p = parent('')
    const mounted = await mountElement(p.element(''))
    await open(mounted)
    type(box(mounted.container), 'color: red;')
    await mounted.flush()
    type(box(mounted.container), 'color: red; opacity: .5;')
    await mounted.flush()
    expect(p.writes.map(w => w.css)).toEqual(['color: red;', 'color: red; opacity: .5;'])
    // The first write lands while the second is still out
    p.land()
    await mounted.rerender(p.element('color: red;'))
    expect(box(mounted.container).value).toBe('color: red; opacity: .5;')
    p.land()
    await mounted.rerender(p.element('color: red; opacity: .5;'))
    expect(box(mounted.container).value).toBe('color: red; opacity: .5;')
    // Idle now: a block saved elsewhere shows
    await mounted.rerender(p.element('color: blue;'))
    expect(box(mounted.container).value).toBe('color: blue;')
    await mounted.unmount()
  })

  it('while a block of its own is out, nothing else is adopted: the store is behind the reader', async () => {
    // Codex on #185: an external block arriving before the reader's own landed replaced the draft, and the reader's
    // block, an echo when it landed, never came back — the box and the store disagreed
    const p = parent('')
    const mounted = await mountElement(p.element(''))
    await open(mounted)
    type(box(mounted.container), 'color: red;')
    await mounted.flush()
    await mounted.rerender(p.element('color: blue;'))
    expect(box(mounted.container).value).toBe('color: red;')
    p.land()
    await mounted.rerender(p.element('color: red;'))
    expect(box(mounted.container).value).toBe('color: red;')
    await mounted.rerender(p.element('color: green;'))
    expect(box(mounted.container).value).toBe('color: green;')
    await mounted.unmount()
  })

  it('a block written twice, or equal to the stored one, is waited for by its write and not by the prop', async () => {
    // The tenth and eleventh local passes of S1: an undo to the saved block, and a block typed twice around a rejected
    // one, changed no prop when they landed; the wait keyed on the prop never ended, and every later change elsewhere
    // was taken for the store lagging the box
    const p = parent('color: red;')
    const mounted = await mountElement(p.element('color: red;'))
    await open(mounted)
    type(box(mounted.container), 'color: blue;')
    type(box(mounted.container), 'color: {')
    type(box(mounted.container), 'color: blue;')
    await mounted.flush()
    expect(p.writes.map(w => w.css)).toEqual(['color: blue;', 'color: blue;'])
    p.land()
    await mounted.rerender(p.element('color: blue;'))
    await mounted.rerender(p.element('color: green;'))
    expect(box(mounted.container).value).toBe('color: blue;')
    p.land()
    await mounted.flush()
    await mounted.rerender(p.element('color: green;'))
    expect(box(mounted.container).value).toBe('color: blue;')
    await mounted.rerender(p.element('color: purple;'))
    expect(box(mounted.container).value).toBe('color: purple;')
    // The undo to the saved block, the same way
    type(box(mounted.container), 'color: {')
    type(box(mounted.container), 'color: purple;')
    await mounted.flush()
    p.land()
    await mounted.flush()
    await mounted.rerender(p.element('color: orange;'))
    expect(box(mounted.container).value).toBe('color: orange;')
    await mounted.unmount()
  })

  it('a write the store refused leaves a draft: a change elsewhere does not replace it until a later write lands', async () => {
    const p = parent('color: red;')
    const mounted = await mountElement(p.element('color: red;'))
    await open(mounted)
    type(box(mounted.container), 'color: blue;')
    await mounted.flush()
    p.refuse()
    await mounted.flush()
    await mounted.rerender(p.element('color: green;'))
    expect(box(mounted.container).value).toBe('color: blue;')
    type(box(mounted.container), 'color: blue; opacity: .5;')
    await mounted.flush()
    p.land()
    await mounted.flush()
    await mounted.rerender(p.element('color: blue; opacity: .5;'))
    await mounted.rerender(p.element('color: teal;'))
    expect(box(mounted.container).value).toBe('color: teal;')
    await mounted.unmount()
  })
})
