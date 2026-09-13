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
