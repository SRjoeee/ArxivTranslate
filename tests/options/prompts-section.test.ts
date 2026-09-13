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

const box = (container: HTMLElement) => container.querySelector('textarea') as HTMLTextAreaElement

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
    const textarea = box(mounted.container)
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    await mounted.flush()
    setter?.call(textarea, laidOut)
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await mounted.flush()
    expect(box(mounted.container).value).toBe(laidOut)
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'weights', translation: '权重' }] }) }))
    expect(box(mounted.container).value).toBe(laidOut)
    await mounted.unmount()
  })

  it('keeps a draft that does not parse yet while the stored glossary changes', async () => {
    const mounted = await mountElement(createElement(Prompts, { data: data({ ...llm, glossary: [] }) }))
    const textarea = box(mounted.container)
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
    setter?.call(textarea, 'weights')
    textarea.dispatchEvent(new Event('input', { bubbles: true }))
    await mounted.flush()
    expect(box(mounted.container).value).toBe('weights')
    await mounted.rerender(createElement(Prompts, { data: data({ ...llm, glossary: [{ term: 'bias', translation: '偏置' }] }) }))
    expect(box(mounted.container).value).toBe('weights')
    await mounted.unmount()
  })
})
