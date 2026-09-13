import { createElement } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AdvancedCss } from '@/ui/appearance/AdvancedCss'
import { setLocale } from '@/ui/strings'
import { mountElement } from './render-hook'

// The advanced CSS box of a style profile (ui/appearance/AdvancedCss.tsx): a draft of its own that follows the
// profile when that changes elsewhere, and never loses the reader's typing to it

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

describe('AdvancedCss', () => {
  beforeEach(() => { setLocale('en') })

  it('follows a block saved elsewhere when the draft is not the reader own', async () => {
    const handed: string[] = []
    const mounted = await mountElement(createElement(AdvancedCss, { value: 'color: red;', onChange: css => handed.push(css) }))
    expect(box(mounted.container).value).toBe('color: red;')
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: blue;', onChange: css => handed.push(css) }))
    expect(box(mounted.container).value).toBe('color: blue;')
    await mounted.unmount()
  })

  it('keeps a refused block while the profile changes elsewhere', async () => {
    // The eighth local pass of S1: tab A holds `color: {`, tab B saves other CSS for the profile, A's text was snapped away
    const mounted = await mountElement(createElement(AdvancedCss, { value: 'color: red;', onChange: () => undefined }))
    await open(mounted)
    type(box(mounted.container), 'color: {')
    await mounted.flush()
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: blue;', onChange: () => undefined }))
    expect(box(mounted.container).value).toBe('color: {')
    await mounted.unmount()
  })

  it('while a block of its own is out, nothing else is adopted: the store is behind the reader', async () => {
    // Codex on #185: an external block arriving before the reader's own landed replaced the draft, and the reader's
    // block, an echo when it landed, never came back — the box and the store disagreed
    const onChange = () => undefined
    const mounted = await mountElement(createElement(AdvancedCss, { value: '', onChange }))
    await open(mounted)
    type(box(mounted.container), 'color: red;')
    await mounted.flush()
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: blue;', onChange }))
    expect(box(mounted.container).value).toBe('color: red;')
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: red;', onChange }))
    expect(box(mounted.container).value).toBe('color: red;')
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: green;', onChange }))
    expect(box(mounted.container).value).toBe('color: green;')
    await mounted.unmount()
  })

  it('its own blocks landing later are not news: the second keystroke survives the first echo', async () => {
    const handed: string[] = []
    const onChange = (css: string) => handed.push(css)
    const mounted = await mountElement(createElement(AdvancedCss, { value: '', onChange }))
    await open(mounted)
    type(box(mounted.container), 'color: red;')
    await mounted.flush()
    type(box(mounted.container), 'color: red; opacity: .5;')
    await mounted.flush()
    expect(handed).toEqual(['color: red;', 'color: red; opacity: .5;'])
    // The first write lands while the second is still out
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: red;', onChange }))
    expect(box(mounted.container).value).toBe('color: red; opacity: .5;')
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: red; opacity: .5;', onChange }))
    expect(box(mounted.container).value).toBe('color: red; opacity: .5;')
    // Idle now: a block saved elsewhere shows
    await mounted.rerender(createElement(AdvancedCss, { value: 'color: blue;', onChange }))
    expect(box(mounted.container).value).toBe('color: blue;')
    await mounted.unmount()
  })
})
