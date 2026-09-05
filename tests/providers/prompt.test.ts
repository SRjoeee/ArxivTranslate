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
  it('术语表进用户消息的元数据块，一行一条', () => {
    const withGlossary = { ...request, context: { ...request.context, glossary: [{ term: 'weights', translation: '权重' }, { term: 'bias', translation: '偏置' }] } }
    const { prompt } = buildPrompts(withGlossary)
    expect(prompt).toContain('weights -> 权重')
    expect(prompt).toContain('bias -> 偏置')
    // 没有术语表时是 None，不留空
    expect(buildPrompts(request).prompt).toContain('Glossary: None')
  })

  it('自定义提示词两段都没写 {{targetLanguage}} 时，用户消息前面补一行目标语言', () => {
    const prompts = { promptId: 'mine', patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'Be terse.', prompt: '{{input}}' }] }
    const { prompt } = buildPrompts(request, prompts)
    expect(prompt.startsWith('Target language: Simplified Mandarin Chinese')).toBe(true)
    // 写了就不重复补
    const withTarget = { promptId: 'mine', patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'Translate into {{targetLanguage}}.', prompt: '{{input}}' }] }
    expect(buildPrompts(request, withTarget).prompt.startsWith('Target language:')).toBe(false)
  })

  it('带版本号：目标语言改填英文名后升到 3', () => {
    expect(PROMPT_VERSION).toBe('4')
  })

  it('system prompt = 提示词库模板 + 协议块；协议块写明占位符与输出形状', () => {
    const { system } = buildPrompts(request)
    // 语言码换成英文名（Read Frog 的做法）
    expect(system).toContain('Simplified Mandarin Chinese')
    expect(system).not.toContain('cmn')
    expect(system).toContain('<x id')
    expect(system).toContain('<t id')
    // 输出形状写死：不支持 json_schema 的端点也能给出正确的顶层键
    expect(system).toContain('{"segments":[{"id":"<id>","text":"<translated text>"}]}')
    expect(system.endsWith(PROTOCOL_BLOCK)).toBe(true)
  })

  it('论文上下文填进用户消息的元数据块（带定界符、声明不可信），system 里只有说明', () => {
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

  it('缺的上下文用 "Not available" 占位，不留模板变量', () => {
    const { system, prompt } = buildPrompts({ ...request, context: undefined })
    expect(prompt).toContain('Paper title: Not available')
    expect(prompt).toContain('Glossary: None')
    expect(system + prompt).not.toContain('{{')
  })

  it('user prompt 含全部 segment id 与原文（JSON）', () => {
    const { prompt } = buildPrompts(request)
    expect(prompt).toContain('S1.p1.1')
    expect(prompt).toContain('S1.p2.1')
    expect(prompt).toContain('Let <x id=\\"1\\"/> be a graph.')
  })

  it('自定义提示词漏写 {{input}} 也会把原文发出去；协议块照样追加', () => {
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

  it('自定义提示词漏写 {{glossary}} 也会把术语表发出去（Codex 在 #52 指出）', () => {
    // 设置页承诺「术语表随每一批发出」，而「新建」出来的模板默认不含这个变量
    const prompts = {
      promptId: 'mine',
      patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'Target: {{targetLanguage}}', prompt: 'Translate: {{input}}' }],
    }
    const withGlossary = { ...request, context: { glossary: [{ term: 'graph', translation: '图' }] } }
    expect(buildPrompts(withGlossary, prompts).prompt).toContain('graph -> 图')
    // 没配术语表就不追加这一段，prompt 不平白变长
    expect(buildPrompts(request, prompts).prompt).not.toContain('Glossary:')
    // 模板自己写了 {{glossary}} 时不重复追加
    const explicit = { promptId: 'mine', patterns: [{ id: 'mine', name: 'mine', systemPrompt: 'G: {{glossary}}', prompt: '{{input}}' }] }
    expect(buildPrompts(withGlossary, explicit).prompt).not.toContain('Glossary:')
  })

  it('术语表格式化', () => {
    expect(formatGlossary()).toBe('None')
    expect(formatGlossary([{ term: 'graph', translation: '图' }])).toBe('graph -> 图')
    expect(buildPrompts({ ...request, context: { glossary: [{ term: 'graph', translation: '图' }] } }, DEFAULT_PROMPTS_CONFIG).prompt).toContain('graph -> 图')
  })
})
