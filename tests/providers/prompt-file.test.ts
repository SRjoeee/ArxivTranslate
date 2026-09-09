import { describe, expect, it } from 'vitest'
import { PROMPT_FILE_NAME, parsePromptFile, serializePrompts } from '@/providers/prompt-file'

// Matches Read Frog file shape: an array of { name, systemPrompt, prompt } without IDs
describe('prompt-file', () => {
  it('requires name and prompt; omitted systemPrompt defaults to empty', () => {
    const list = parsePromptFile(JSON.stringify([{ name: 'A', prompt: '{{input}}' }, { name: 'B', systemPrompt: 'S', prompt: 'P' }]))
    expect(list).toEqual([{ name: 'A', prompt: '{{input}}', systemPrompt: '' }, { name: 'B', systemPrompt: 'S', prompt: 'P' }])
  })

  it('rejects nonarrays, missing name, missing prompt, and invalid JSON', () => {
    expect(() => parsePromptFile('{"name":"A","prompt":"P"}')).toThrow(/Invalid prompt file/)
    expect(() => parsePromptFile('[{"prompt":"P"}]')).toThrow(/Invalid prompt file/)
    expect(() => parsePromptFile('[{"name":"A"}]')).toThrow(/Invalid prompt file/)
    expect(() => parsePromptFile('[{"name":"","prompt":"P"}]')).toThrow(/Invalid prompt file/)
    expect(() => parsePromptFile('nope')).toThrow(/invalid JSON/)
  })

  it('export omits IDs and import reassigns them, preserving round-trip content', () => {
    const patterns = [{ id: 'x', name: 'A', systemPrompt: 'S', prompt: 'P' }]
    const json = serializePrompts(patterns)
    expect(json).not.toContain('"id"')
    expect(parsePromptFile(json)).toEqual([{ name: 'A', systemPrompt: 'S', prompt: 'P' }])
    expect(PROMPT_FILE_NAME.endsWith('.json')).toBe(true)
  })
})
