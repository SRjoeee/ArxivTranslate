import { createElement } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { type Config, DEFAULT_CONFIG } from '@/config/schema'
import { mountElement } from '../ui/render-hook'

// The glossary text box of the prompts section (options/sections/Prompts.tsx) follows the stored glossary — a change
// saved elsewhere included — unless the text is the reader's own

vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'test-extension', getURL: (path: string) => path } } }))

import { Prompts } from '@/entrypoints/options/sections/Prompts'
import type { OptionsData } from '@/entrypoints/options/data'
import { applyLocaleFrom } from '@/ui/apply-locale'

const llm: Config = { ...DEFAULT_CONFIG, provider: 'svc-1', services: [{ id: 'svc-1', kind: 'openai-compat', name: 'LLM', baseURL: 'https://api.example.com/v1', apiKey: 'k', model: 'm', thinking: 'disabled' }] }

function data(config: Config, patches: Config[] = [], land: () => Promise<void> = async () => undefined): OptionsData {
  return {
    config,
    fallbackReason: null,
    patch: async fn => { const next = fn(config); await land(); patches.push(next); return next },
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

const box = (container: HTMLElement) => container.querySelector('textarea') as HTMLTextAreaElement
const type = (textarea: HTMLTextAreaElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('Prompts: the glossary text', () => {
  beforeEach(() => { applyLocaleFrom('en') })

  it('follows a glossary saved elsewhere', async () => {
    const mounted = await mountElement(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: '权重' }] }) }))
    expect(box(mounted.container).value).toBe('weights, 权重')
    // Codex on #185: the text was read once, and the next local edit wrote the old table back over the change
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: '权重' }, { term: 'bias', translation: '偏置' }] }) }))
    expect(box(mounted.container).value).toBe('weights, 权重\nbias, 偏置')
    await mounted.unmount()
  })

  it('leaves text that parses to the stored entries under the reader, however it is laid out', async () => {
    const mounted = await mountElement(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: '权重' }] }) }))
    const laidOut = '# my terms\nweights,权重\n'
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: '权重' }] }) }))
    // Simulate the reader's own layout: the same entries, their own spacing and a comment line
    type(box(mounted.container), laidOut)
    await mounted.flush()
    expect(box(mounted.container).value).toBe(laidOut)
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: '权重' }] }) }))
    expect(box(mounted.container).value).toBe(laidOut)
    await mounted.unmount()
  })

  it('keeps what the reader types while their own writes are still landing, and takes up a change saved elsewhere only when idle', async () => {
    // The seventh local pass of S1: text 'weights, weight', type `s` then `!` before the first write lands — the sync
    // took the store, still old, for a change made elsewhere and put 'weight' back between the two keystrokes
    const stored: Config = { ...llm, glossary: [{ term: 'weights', translation: 'weight' }] }
    const patches: Config[] = []
    const lands: (() => void)[] = []
    const land = () => new Promise<void>(resolve => { lands.push(resolve) })
    const mounted = await mountElement(createElement(Prompts, { data: data(stored, patches, land) }))
    type(box(mounted.container), 'weights, weights')
    await mounted.flush()
    // The store has not moved yet; the page re-renders with it as it stands
    await mounted.rerender(createElement(Prompts, { data: data(stored, patches, land) }))
    expect(box(mounted.container).value).toBe('weights, weights')
    type(box(mounted.container), 'weights, weights!')
    await mounted.flush()
    await mounted.rerender(createElement(Prompts, { data: data(stored, patches, land) }))
    expect(box(mounted.container).value).toBe('weights, weights!')
    // The first write lands: the store says 'weights' while the second is still out
    lands.shift()?.()
    await mounted.flush()
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: 'weights' }] }, patches, land) }))
    expect(box(mounted.container).value).toBe('weights, weights!')
    lands.shift()?.()
    await mounted.flush()
    expect(patches.map(c => c.glossary[0]?.translation)).toEqual(['weights', 'weights!'])
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: 'weights!' }] }, patches, land) }))
    expect(box(mounted.container).value).toBe('weights, weights!')
    // Idle now: a glossary saved elsewhere shows
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'bias', translation: '偏置' }] }, patches, land) }))
    expect(box(mounted.container).value).toBe('bias, 偏置')
    await mounted.unmount()
  })

  it('a refused write leaves a draft: the text stays while the store, unchanged, is published again', async () => {
    // The eighth local pass of S1: the write was refused, the text held no draft, and a change to the target language
    // elsewhere published the old glossary over the edit
    const stored: Config = { ...llm, glossary: [{ term: 'weights', translation: 'weight' }] }
    const refuse = () => Promise.reject(new Error('quota'))
    const mounted = await mountElement(createElement(Prompts, { data: data(stored, [], refuse) }))
    type(box(mounted.container), 'weights, weights')
    await mounted.flush()
    await mounted.rerender(createElement(Prompts, { data: data({ ...stored, targetLanguage: 'jpn' }, [], refuse) }))
    expect(box(mounted.container).value).toBe('weights, weights')
    // A later write that lands lets the box follow the store again
    await mounted.rerender(createElement(Prompts, { data: data({ ...stored, targetLanguage: 'jpn' }) }))
    type(box(mounted.container), 'weights, weights!')
    await mounted.flush()
    await mounted.rerender(createElement(Prompts, { data: data({ ...stored, glossary: [{ term: 'weights', translation: 'weights!' }] }) }))
    expect(box(mounted.container).value).toBe('weights, weights!')
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'bias', translation: '偏置' }] }) }))
    expect(box(mounted.container).value).toBe('bias, 偏置')
    await mounted.unmount()
  })

  it('keeps a draft that does not parse yet while the stored glossary changes', async () => {
    const mounted = await mountElement(createElement(Prompts, { data: data({ ...llm, glossary: [] }) }))
    type(box(mounted.container), 'weights')
    await mounted.flush()
    expect(box(mounted.container).value).toBe('weights')
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'bias', translation: '偏置' }] }) }))
    expect(box(mounted.container).value).toBe('weights')
    await mounted.unmount()
  })
})
