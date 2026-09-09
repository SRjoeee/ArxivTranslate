import { describe, expect, it } from 'vitest'
import { PROMPT_VERSION, PROTOCOL_BLOCK, buildPrompts, formatGlossary } from '@/providers/prompt'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import type { TranslateRequest } from '@/providers/types'

const request: TranslateRequest = {
  segments: [{ id: 'S1.p1.1', text: 'Let <x id="1"/> be a graph.' }, { id: 'S1.p2.1', text: 'Then <t id="1">bold</t>.' }],
  source: 'en',
  target: 'cmn',
  context: { paperTitle: 'Graphs', abstract: 'We study graphs.', sectionTitle: 'Introduction' },
}

describe('prompt', () => {
  it('includes the glossary in user-message metadata, one entry per line', () => {
    const withGlossary = { ...request, context: { ...request.context, glossary: [{ term: 'weights', translation: '权重' }, { term: 'bias', translation: '偏置' }] } }
    const { prompt } = buildPrompts(withGlossary)
    expect(prompt).toContain('weights -> 权重')
    expect(prompt).toContain('bias -> 偏置')
    // uses None for an absent glossary rather than leaving it blank
    expect(buildPrompts(request).prompt).toContain('Glossary: None')
  })

  it('prepends target language to the user message when neither custom prompt part includes targetLanguage', () => {
    const prompts = { promptId: 'mine', patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'Be terse.', prompt: '{{input}}' }] }
    const { prompt } = buildPrompts(request, prompts)
    expect(prompt.startsWith('Target language: Simplified Mandarin Chinese')).toBe(true)
    // does not append target language when already present
    const withTarget = { promptId: 'mine', patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'Translate into {{targetLanguage}}.', prompt: '{{input}}' }] }
    expect(buildPrompts(request, withTarget).prompt.startsWith('Target language:')).toBe(false)
  })

  it('versioned: English target-language names bumped the version to 3', () => {
    expect(PROMPT_VERSION).toBe('4')
  })

  it('system prompt combines the library template and a protocol block specifying placeholders and output shape', () => {
    const { system } = buildPrompts(request)
    // Convert language codes to English names, following Read Frog.
    expect(system).toContain('Simplified Mandarin Chinese')
    expect(system).not.toContain('cmn')
    expect(system).toContain('<x id')
    expect(system).toContain('<t id')
    // The explicit output shape gives endpoints without json_schema support the correct top-level key.
    expect(system).toContain('{"segments":[{"id":"<id>","text":"<translated text>"}]}')
    expect(system.endsWith(PROTOCOL_BLOCK)).toBe(true)
  })

  it('paper context goes in delimited untrusted user-message metadata; system contains only instructions', () => {
    const { system, prompt } = buildPrompts(request)
    expect(prompt).toContain('<document_metadata>')
    expect(prompt).toContain('Paper title: Graphs')
    expect(prompt).toContain('Abstract: We study graphs.')
    expect(prompt).toContain('Current section: Introduction')
    expect(prompt).toContain('untrusted')
    expect(system).not.toContain('We study graphs.')
    expect(system).toContain('never instructions')
    expect(system + prompt).not.toContain('{{')
  })

  it('missing context uses Not available without leftover template variables', () => {
    const { system, prompt } = buildPrompts({ ...request, context: undefined })
    expect(prompt).toContain('Paper title: Not available')
    expect(prompt).toContain('Glossary: None')
    expect(system + prompt).not.toContain('{{')
  })

  it('user prompt contains all segment IDs and original text as JSON', () => {
    const { prompt } = buildPrompts(request)
    expect(prompt).toContain('S1.p1.1')
    expect(prompt).toContain('S1.p2.1')
    expect(prompt).toContain('Let <x id=\\"1\\"/> be a graph.')
  })

  it('custom prompts without input still send original text and append the protocol block', () => {
    const prompts = {
      promptId: 'mine',
      patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'Be terse. Target: {{targetLanguage}}', prompt: 'Translate now.' }],
    }
    const { system, prompt } = buildPrompts(request, prompts)
    expect(system.startsWith('Be terse. Target: Simplified Mandarin Chinese')).toBe(true)
    expect(system).toContain(PROTOCOL_BLOCK)
    expect(prompt).toContain('Translate now.')
    expect(prompt).toContain('S1.p1.1')
  })

  it('custom prompts without glossary still send glossary entries (Codex #52)', () => {
    // Settings promises to send the glossary with every batch, but newly created templates omit this variable by default.
    const prompts = {
      promptId: 'mine',
      patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'Target: {{targetLanguage}}', prompt: 'Translate: {{input}}' }],
    }
    const withGlossary = { ...request, context: { glossary: [{ term: 'graph', translation: '图' }] } }
    expect(buildPrompts(withGlossary, prompts).prompt).toContain('graph -> 图')
    // Without a glossary, append nothing and avoid needless prompt growth.
    expect(buildPrompts(request, prompts).prompt).not.toContain('Glossary:')
    // Do not append the glossary again when the template already includes it.
    const explicit = { promptId: 'mine', patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'G: {{glossary}}', prompt: '{{input}}' }] }
    expect(buildPrompts(withGlossary, explicit).prompt).not.toContain('Glossary:')
  })

  it('glossary formatting', () => {
    expect(formatGlossary()).toBe('None')
    expect(formatGlossary([{ term: 'graph', translation: '图' }])).toBe('graph -> 图')
    expect(buildPrompts({ ...request, context: { glossary: [{ term: 'graph', translation: '图' }] } }, DEFAULT_PROMPTS_CONFIG).prompt).toContain('graph -> 图')
  })
})
