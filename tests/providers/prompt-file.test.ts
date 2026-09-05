import { describe, expect, it } from 'vitest'
import { PROMPT_FILE_NAME, parsePromptFile, serializePrompts } from '@/providers/prompt-file'

// 文件形状与 Read Frog 的一致：不带 id 的 { name, systemPrompt, prompt } 数组
describe('prompt-file', () => {
  it('解析：name 与 prompt 必填，systemPrompt 缺省为空', () => {
    const list = parsePromptFile(JSON.stringify([{ name: 'A', prompt: '{{input}}' }, { name: 'B', systemPrompt: 'S', prompt: 'P' }]))
    expect(list).toEqual([{ name: 'A', prompt: '{{input}}', systemPrompt: '' }, { name: 'B', systemPrompt: 'S', prompt: 'P' }])
  })

  it('拒绝：不是数组、缺 name、缺 prompt、不是 JSON', () => {
    expect(() => parsePromptFile('{"name":"A","prompt":"P"}')).toThrow(/格式不对/)
    expect(() => parsePromptFile('[{"prompt":"P"}]')).toThrow(/格式不对/)
    expect(() => parsePromptFile('[{"name":"A"}]')).toThrow(/格式不对/)
    expect(() => parsePromptFile('[{"name":"","prompt":"P"}]')).toThrow(/格式不对/)
    expect(() => parsePromptFile('nope')).toThrow(/不是合法 JSON/)
  })

  it('导出去掉 id，导入再分配；来回一致', () => {
    const patterns = [{ id: 'x', name: 'A', systemPrompt: 'S', prompt: 'P' }]
    const json = serializePrompts(patterns)
    expect(json).not.toContain('"id"')
    expect(parsePromptFile(json)).toEqual([{ name: 'A', systemPrompt: 'S', prompt: 'P' }])
    expect(PROMPT_FILE_NAME.endsWith('.json')).toBe(true)
  })
})
