// The prompt library (ported from Read Frog): template variables, built-in / custom selection, fingerprints.
import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_PROMPTS, DEFAULT_PROMPT_ID, PRECISION_REWRITE_PROMPT_ID, PROMPT_TOKENS,
  getTokenCellText, promptKey, renderTemplate, selectPrompt,
} from '@/providers/prompt-library'

const values = { targetLanguage: 'ja', input: 'IN', paperTitle: 'T', abstract: 'A', sectionTitle: 'S', glossary: 'G' }

describe('prompt library', () => {
  it('every built-in prompt uses the target-language and metadata variables', () => {
    for (const id of Object.keys(BUILT_IN_PROMPTS)) {
      const t = BUILT_IN_PROMPTS[id]!
      expect(t.systemPrompt).toContain(getTokenCellText('targetLanguage'))
      // The metadata goes into the user message with delimiters: in system it would count as a peer instruction (Codex on #28)
      expect(t.systemPrompt).not.toContain(getTokenCellText('abstract'))
      expect(t.prompt).toContain('<document_metadata>')
      expect(t.prompt).toContain(getTokenCellText('abstract'))
      expect(t.prompt).toContain(getTokenCellText('input'))
    }
  })

  it('renderTemplate replaces every variable and leaves no {{ }}', () => {
    for (const id of Object.keys(BUILT_IN_PROMPTS)) {
      const t = BUILT_IN_PROMPTS[id]!
      const out = renderTemplate(t.systemPrompt, values) + renderTemplate(t.prompt, values)
      for (const token of PROMPT_TOKENS) expect(out).not.toContain(getTokenCellText(token))
      expect(out).toContain('ja')
    }
  })

  it('selects a built-in by id; an unknown id falls back to default', () => {
    expect(selectPrompt({ promptId: PRECISION_REWRITE_PROMPT_ID, patterns: [] }).id).toBe(PRECISION_REWRITE_PROMPT_ID)
    expect(selectPrompt({ promptId: 'nope', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
    expect(selectPrompt({ promptId: '', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
  })

  it('a custom prompt is matched by id; with the same name as a built-in the built-in wins (as in Read Frog)', () => {
    const mine = { id: 'mine', name: 'mine', systemPrompt: 'S {{targetLanguage}}', prompt: '{{input}}' }
    expect(selectPrompt({ promptId: 'mine', patterns: [mine] })).toBe(mine)
    const shadow = { ...mine, id: DEFAULT_PROMPT_ID }
    expect(selectPrompt({ promptId: DEFAULT_PROMPT_ID, patterns: [shadow] })).toBe(BUILT_IN_PROMPTS[DEFAULT_PROMPT_ID])
  })

  it('identity: a built-in by id, a custom one with its full text (no hashing here; the cache key\'s outer layer does the SHA-256)', () => {
    expect(promptKey()).toBe(DEFAULT_PROMPT_ID)
    const a = promptKey({ promptId: 'mine', patterns: [{ id: 'mine', name: '', systemPrompt: 'A', prompt: '{{input}}' }] })
    const b = promptKey({ promptId: 'mine', patterns: [{ id: 'mine', name: '', systemPrompt: 'B', prompt: '{{input}}' }] })
    expect(a.startsWith('custom:')).toBe(true)
    expect(a).toContain('"A"')
    expect(a).not.toBe(b)
  })

  it('an id that collides with a prototype property (constructor) does not touch the prototype and falls back to default (Codex on #28)', () => {
    expect(selectPrompt({ promptId: 'constructor', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
    expect(promptKey({ promptId: 'toString', patterns: [] })).toBe(DEFAULT_PROMPT_ID)
  })

  it('single-pass replacement: a literal "{{abstract}}" in the source is sent as it is, not replaced a second time by a later variable', () => {
    const out = renderTemplate('{{input}} | {{abstract}}', { ...values, input: 'see {{abstract}} literally', abstract: 'A' })
    expect(out).toBe('see {{abstract}} literally | A')
  })

  it('the fingerprint encodes the two parts separately: "A"+"B C" and "A B"+"C" get different keys', () => {
    const k = (systemPrompt: string, prompt: string) => promptKey({ promptId: 'm', patterns: [{ id: 'm', name: '', systemPrompt, prompt }] })
    expect(k('A', 'B C')).not.toBe(k('A B', 'C'))
  })

  it('the fingerprint counts code points: prompts differing in one supplementary-plane character (😀 / 😁) get different keys (Codex on #28)', () => {
    const k = (systemPrompt: string) => promptKey({ promptId: 'm', patterns: [{ id: 'm', name: '', systemPrompt, prompt: '{{input}}' }] })
    expect(k('😀')).not.toBe(k('😁'))
  })
})
