import { describe, expect, it } from 'vitest'
import { PROMPT_FILE_NAME, parsePromptFile, serializePrompts } from '@/providers/prompt-file'

// The file shape matches Read Frog's: an array of { name, systemPrompt, prompt } without ids
describe('prompt-file', () => {
  it('parsing: name and prompt required, systemPrompt defaults to empty', () => {
    const list = parsePromptFile(JSON.stringify([{ name: 'A', prompt: '{{input}}' }, { name: 'B', systemPrompt: 'S', prompt: 'P' }]))
    expect(list).toEqual([{ name: 'A', prompt: '{{input}}', systemPrompt: '' }, { name: 'B', systemPrompt: 'S', prompt: 'P' }])
  })

  it('rejects: not an array, missing name, missing prompt, not JSON', () => {
    expect(() => parsePromptFile('{"name":"A","prompt":"P"}')).toThrow(/badShape/)
    expect(() => parsePromptFile('[{"prompt":"P"}]')).toThrow(/badShape/)
    expect(() => parsePromptFile('[{"name":"A"}]')).toThrow(/badShape/)
    expect(() => parsePromptFile('[{"name":"","prompt":"P"}]')).toThrow(/badShape/)
    expect(() => parsePromptFile('nope')).toThrow(/notJson/)
  })

  it('export drops the id, import assigns one again; round-trips', () => {
    const patterns = [{ id: 'x', name: 'A', systemPrompt: 'S', prompt: 'P' }]
    const json = serializePrompts(patterns)
    expect(json).not.toContain('"id"')
    expect(parsePromptFile(json)).toEqual([{ name: 'A', systemPrompt: 'S', prompt: 'P' }])
    expect(PROMPT_FILE_NAME.endsWith('.json')).toBe(true)
  })
})
