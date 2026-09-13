import { describe, expect, it } from 'vitest'
import { withSaved } from '@/entrypoints/options/PromptManager'
import type { PromptTemplate } from '@/providers/prompt-library'

// The prompt editor's save (options/PromptManager.tsx): a draft is never lost to a list that moved under it

const template = (id: string, name = id): PromptTemplate => ({ id, name, systemPrompt: 'system', prompt: 'user' })

describe('withSaved', () => {
  it('an edit replaces its template in place', () => {
    const saved = withSaved([template('a'), template('b')], 'edit', template('a', 'A edited'))
    expect(saved.map(p => p.name)).toEqual(['A edited', 'b'])
  })

  it('an edit of a template deleted elsewhere while the editor was open appends the draft rather than dropping it', () => {
    // The sixth local pass of S1: the list followed the deletion, the save mapped over it, found nothing, and closed
    // the editor reporting success
    const saved = withSaved([template('b')], 'edit', template('a', 'A edited'))
    expect(saved.map(p => p.name)).toEqual(['b', 'A edited'])
  })

  it('a new template and a copy append', () => {
    expect(withSaved([template('a')], 'new', template('n')).map(p => p.id)).toEqual(['a', 'n'])
    expect(withSaved([template('a')], 'copy', template('c')).map(p => p.id)).toEqual(['a', 'c'])
  })
})

// --- The manager hands the store an update of the configuration as stored, not a copy of what it last saw
import { createElement } from 'react'
import { beforeEach, vi } from 'vitest'
import { type PromptsUpdate, PromptManager } from '@/entrypoints/options/PromptManager'
import type { PromptsConfig } from '@/providers/prompt-library'
import { O, setLocale } from '@/ui/strings'
import { mountElement } from '../ui/render-hook'

vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'test-extension', getURL: (path: string) => path } } }))

const buttonNamed = (container: HTMLElement, label: string) => Array.from(container.querySelectorAll('button')).find(b => b.textContent === label)
const typeInto = (input: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

describe('PromptManager: changes are updates of the stored prompts', () => {
  beforeEach(() => { setLocale('en') })

  it('a new prompt is appended to the list as stored when the write runs, not to the list this tab saw', async () => {
    // Codex on #185: a prompt added in another tab while this tab's refresh was still queued was dropped by a list
    // built from the stale copy
    const seen: PromptsConfig = { patterns: [template('a')], promptId: 'a' }
    const updates: PromptsUpdate[] = []
    const mounted = await mountElement(createElement(PromptManager, { value: seen, onChange: (update: PromptsUpdate) => { updates.push(update) } }))
    buttonNamed(mounted.container, O.prompts.manager.create)?.click()
    await mounted.flush()
    const name = Array.from(mounted.container.querySelectorAll('input')).find(i => i.type === 'text' || !i.getAttribute('type')) as HTMLInputElement
    typeInto(name, 'Mine')
    await mounted.flush()
    buttonNamed(mounted.container, O.prompts.manager.addToList)?.click()
    await mounted.flush()
    expect(updates).toHaveLength(1)
    const stored: PromptsConfig = { patterns: [template('a'), template('b')], promptId: 'b' }
    const next = updates[0]!(stored)
    expect(next.patterns.map(p => p.name)).toEqual(['a', 'b', 'Mine'])
    expect(next.promptId).toBe('b')
    await mounted.unmount()
  })

  it('a deletion removes the prompt from the list as stored, keeping what was added elsewhere', async () => {
    const seen: PromptsConfig = { patterns: [template('a')], promptId: 'a' }
    const updates: PromptsUpdate[] = []
    // happy-dom has no confirm; the manager asks before deleting
    const asked = window.confirm
    window.confirm = () => true
    const mounted = await mountElement(createElement(PromptManager, { value: seen, onChange: (update: PromptsUpdate) => { updates.push(update) } }))
    buttonNamed(mounted.container, O.prompts.manager.remove)?.click()
    await mounted.flush()
    expect(updates).toHaveLength(1)
    const next = updates[0]!({ patterns: [template('a'), template('b')], promptId: 'a' })
    expect(next.patterns.map(p => p.id)).toEqual(['b'])
    expect(next.promptId).not.toBe('a')
    window.confirm = asked
    await mounted.unmount()
  })
})
