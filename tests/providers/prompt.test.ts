import { describe, expect, it } from 'vitest'
import { PROMPT_VERSION, PROTOCOL_BLOCK, buildPrompts, formatGlossary } from '@/providers/prompt'
import { DEFAULT_PROMPTS_CONFIG } from '@/providers/prompt-library'
import type { TranslateRequest } from '@/providers/types'

const request: TranslateRequest = {
  segments: [{ id: 'S1.p1.1', text: 'Let <x id="1"/> be a graph.' }, { id: 'S1.p2.1', text: 'Then <t id="1">bold</t>.' }],
  source: 'en',
  target: 'zh-CN',
  context: { paperTitle: 'Graphs', abstract: 'We study graphs.', sectionTitle: 'Introduction' },
}

describe('prompt', () => {
  it('带版本号：提示词库接入后升到 2', () => {
    expect(PROMPT_VERSION).toBe('2')
  })

  it('system prompt = 提示词库模板 + 协议块；协议块写明占位符与输出形状', () => {
    const { system } = buildPrompts(request)
    expect(system).toContain('zh-CN')
    expect(system).toContain('<x id')
    expect(system).toContain('<t id')
    // 输出形状写死：不支持 json_schema 的端点也能给出正确的顶层键
    expect(system).toContain('{"segments":[{"id":"<id>","text":"<translated text>"}]}')
    expect(system.endsWith(PROTOCOL_BLOCK)).toBe(true)
  })

  it('论文上下文填进元数据块：标题、摘要、章节', () => {
    const { system } = buildPrompts(request)
    expect(system).toContain('Paper title: Graphs')
    expect(system).toContain('Abstract: We study graphs.')
    expect(system).toContain('Current section: Introduction')
    expect(system).not.toContain('{{')
  })

  it('缺的上下文用 "Not available" 占位，不留模板变量', () => {
    const { system } = buildPrompts({ ...request, context: undefined })
    expect(system).toContain('Paper title: Not available')
    expect(system).toContain('Glossary: None')
    expect(system).not.toContain('{{')
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
    expect(system.startsWith('Be terse. Target: zh-CN')).toBe(true)
    expect(system).toContain(PROTOCOL_BLOCK)
    expect(prompt).toContain('Translate now.')
    expect(prompt).toContain('S1.p1.1')
  })

  it('术语表格式化', () => {
    expect(formatGlossary()).toBe('None')
    expect(formatGlossary([{ term: 'graph', translation: '图' }])).toBe('graph -> 图')
    expect(buildPrompts({ ...request, context: { glossary: [{ term: 'graph', translation: '图' }] } }, DEFAULT_PROMPTS_CONFIG).system).toContain('graph -> 图')
  })
})
