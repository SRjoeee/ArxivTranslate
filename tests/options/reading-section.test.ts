import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BUILT_IN_STYLES, type StyleProfile } from '@/config/appearance'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import { mountElement } from '../ui/render-hook'

// The reading section's profile drawer (options/sections/Reading.tsx): a profile deleted in another tab while its
// drawer is open here keeps the drawer, and the reader's next change writes the profile back

vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'test-extension', getURL: (path: string) => path } } }))

import { Reading } from '@/entrypoints/options/sections/Reading'
import type { OptionsData } from '@/entrypoints/options/data'
import { O, setLocale } from '@/ui/strings'

const mine: StyleProfile = { ...BUILT_IN_STYLES[0]!, id: 'style-mine', name: 'Mine' }
/** Mine is the chosen style: only the chosen tile carries the edit control */
const withMine: Config = { ...DEFAULT_CONFIG, appearance: { ...DEFAULT_CONFIG.appearance, styles: [...DEFAULT_CONFIG.appearance.styles, mine], activeStyle: mine.id } }

function data(config: Config, patches: Config[] = []): OptionsData {
  return {
    config,
    fallbackReason: null,
    patch: async fn => { const next = fn(config); patches.push(next); return next },
    pack: null,
    checkPack: async () => 'unsupported',
    fetchPack: async () => undefined,
    helper: null,
    setHelper: () => undefined,
    platform: 'mac',
    cache: null,
    cacheError: '',
    clearCache: async () => undefined,
    cacheCleared: false,
  }
}

const dialog = (container: HTMLElement) => container.querySelector('[role="dialog"]')
/** The tile's edit control, not the tile itself (whose label is the bare name) */
const editButton = (container: HTMLElement) => Array.from(container.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === `${O.reading.editTitle}：Mine`)
const typeInto = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Reading: the profile drawer', () => {
  beforeEach(() => { setLocale('en') })

  it('outlives a deletion made elsewhere, and the next change writes the profile back', async () => {
    // The eighth local pass of S1: the list followed the deletion, the drawer unmounted with the reader's draft
    const patches: Config[] = []
    const mounted = await mountElement(createElement(Reading, { data: data(withMine, patches) }))
    const edit = editButton(mounted.container)
    expect(edit).toBeDefined()
    edit?.click()
    await mounted.flush()
    expect(dialog(mounted.container)).not.toBeNull()
    // Another tab deletes the profile; this page follows the store
    await mounted.rerender(createElement(Reading, { data: data(DEFAULT_CONFIG, patches) }))
    expect(dialog(mounted.container)).not.toBeNull()
    const name = dialog(mounted.container)?.querySelector('input') as HTMLInputElement
    expect(name.value).toBe('Mine')
    typeInto(name, 'Mine, kept')
    await mounted.flush()
    const written = patches.at(-1)?.appearance.styles.find(s => s.id === 'style-mine')
    expect(written?.name).toBe('Mine, kept')
    await mounted.unmount()
  })

  it('a drawer closed here forgets the profile', async () => {
    const mounted = await mountElement(createElement(Reading, { data: data(withMine) }))
    editButton(mounted.container)?.click()
    await mounted.flush()
    expect(dialog(mounted.container)).not.toBeNull()
    const close = Array.from(dialog(mounted.container)?.querySelectorAll('button') ?? []).find(b => b.getAttribute('aria-label') === 'Close')
    close?.click()
    await mounted.flush()
    expect(dialog(mounted.container)).toBeNull()
    await mounted.unmount()
  })
})
