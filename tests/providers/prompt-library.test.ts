// Prompt library (ported from Read Frog): template variables, built-in/custom selection, and fingerprints.
import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_PROMPTS, DEFAULT_PROMPT_ID, PRECISION_REWRITE_PROMPT_ID, PROMPT_TOKENS,
  getTokenCellText, promptKey, renderTemplate, selectPrompt,
} from '@/providers/prompt-library'

const values = { targetLanguage: 'ja', input: 'IN', paperTitle: 'T', abstract: 'A', sectionTitle: 'S', glossary: 'G' }

describe('prompt library', () => {
  it('every built-in prompt uses target-language and metadata variables', () => {
    for (const id of Object.keys(BUILT_IN_PROMPTS)) {
      const t = BUILT_IN_PROMPTS[id]!
      expect(t.systemPrompt).toContain(getTokenCellText('targetLanguage'))
      // metadata belongs in delimited user messages; placing it in system would give it instruction priority (Codex #28)
      expect(t.systemPrompt).not.toContain(getTokenCellText('abstract'))
      expect(t.prompt).toContain('<document_metadata>')
      expect(t.prompt).toContain(getTokenCellText('abstract'))
      expect(t.prompt).toContain(getTokenCellText('input'))
    }
  })

  it('renderTemplate replaces all variables without leftover braces', () => {
    for (const id of Object.keys(BUILT_IN_PROMPTS)) {
      const t = BUILT_IN_PROMPTS[id]!
      const out = renderTemplate(t.systemPrompt, values) + renderTemplate(t.prompt, values)
      for (const token of PROMPT_TOKENS) expect(out).not.toContain(getTokenCellText(token))
      expect(out).toContain('ja')
    }
  })

  it('selects built-ins by ID and falls back to default for unknown IDs', () => {
    expect(selectPrompt({ promptId: PRECISION_REWRITE_PROMPT_ID, patterns: [] }).id).toBe(PRECISION_REWRITE_PROMPT_ID)
    expect(selectPrompt({ promptId: 'nope', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
    expect(selectPrompt({ promptId: '', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
  })

  it('selects custom prompts by ID; built-ins win name collisions, matching Read Frog', () => {
    const mine = { id: 'mine', name: 'mine', systemPrompt: 'S {{targetLanguage}}', prompt: '{{input}}' }
    expect(selectPrompt({ promptId: 'mine', patterns: [mine] })).toBe(mine)
    const shadow = { ...mine, id: DEFAULT_PROMPT_ID }
    expect(selectPrompt({ promptId: DEFAULT_PROMPT_ID, patterns: [shadow] })).toBe(BUILT_IN_PROMPTS[DEFAULT_PROMPT_ID])
  })

  it('identity uses built-in IDs or full custom text; only the outer cache key hashes with SHA-256', () => {
    expect(promptKey()).toBe(DEFAULT_PROMPT_ID)
    const a = promptKey({ promptId: 'mine', patterns: [{ id: 'mine', name: '', systemPrompt: 'A', prompt: '{{input}}' }] })
    const b = promptKey({ promptId: 'mine', patterns: [{ id: 'mine', name: '', systemPrompt: 'B', prompt: '{{input}}' }] })
    expect(a.startsWith('custom:')).toBe(true)
    expect(a).toContain('"A"')
    expect(a).not.toBe(b)
  })

  it('prototype-property IDs such as constructor fall back to default without accessing the prototype (Codex #28)', () => {
    expect(selectPrompt({ promptId: 'constructor', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
    expect(promptKey({ promptId: 'toString', patterns: [] })).toBe(DEFAULT_PROMPT_ID)
  })

  it('single-pass substitution preserves template-like source text such as {{abstract}} without replacing it again', () => {
    const out = renderTemplate('{{input}} | {{abstract}}', { ...values, input: 'see {{abstract}} literally', abstract: 'A' })
    expect(out).toBe('see {{abstract}} literally | A')
  })

  it('fingerprints encode both parts separately so A + B C differs from A B + C', () => {
    const k = (systemPrompt: string, prompt: string) => promptKey({ promptId: 'm', patterns: [{ id: 'm', name: '', systemPrompt, prompt }] })
    expect(k('A', 'B C')).not.toBe(k('A B', 'C'))
  })

  it('fingerprints use code points so prompts differing only in supplementary-plane characters have different keys (Codex #28)', () => {
    const k = (systemPrompt: string) => promptKey({ promptId: 'm', patterns: [{ id: 'm', name: '', systemPrompt, prompt: '{{input}}' }] })
    expect(k('😀')).not.toBe(k('😁'))
  })
})
