import { describe, expect, it } from 'vitest'
import { PROMPT_VERSION, systemPrompt, userPrompt } from '@/providers/prompt'

describe('prompt', () => {
  it('带版本号', () => {
    expect(PROMPT_VERSION).toBe('1')
  })

  it('system prompt 写明占位符、人名与只返回译文三条约束，并含目标语言', () => {
    const s = systemPrompt('zh-CN')
    expect(s).toContain('<x id')
    expect(s).toContain('<t id')
    expect(s).toContain('zh-CN')
    expect(s).toMatch(/人名|author|names/i)
    expect(s).toMatch(/只返回|only/i)
    // 输出形状写死：不支持 json_schema 的端点也能给出正确的顶层键
    expect(s).toContain('{"segments":[{"id":"<id>","text":"<translated text>"}]}')
  })

  it('user prompt 含全部 segment id、原文与章节上下文', () => {
    const u = userPrompt({
      segments: [{ id: 'S1.p1.1', text: 'Let <x id="1"/> be a graph.' }, { id: 'S1.p2.1', text: 'Then <t id="1">bold</t>.' }],
      source: 'en',
      target: 'zh-CN',
      context: { paperTitle: 'Graphs', sectionTitle: 'Introduction' },
    })
    expect(u).toContain('S1.p1.1')
    expect(u).toContain('S1.p2.1')
    expect(u).toContain('Let <x id=\\"1\\"/> be a graph.')
    expect(u).toContain('Introduction')
    expect(u).toContain('Graphs')
  })
})
