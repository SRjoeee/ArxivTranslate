// 提示词库（移植自 Read Frog）：模板变量、内置/自定义选择、指纹。
import { describe, expect, it } from 'vitest'
import {
  BUILT_IN_PROMPTS, DEFAULT_PROMPT_ID, PRECISION_REWRITE_PROMPT_ID, PROMPT_TOKENS,
  getTokenCellText, promptKey, renderTemplate, selectPrompt,
} from '@/providers/prompt-library'

const values = { targetLanguage: 'ja', input: 'IN', paperTitle: 'T', abstract: 'A', sectionTitle: 'S', glossary: 'G' }

describe('prompt library', () => {
  it('内置提示词每个都用到目标语言与元数据变量', () => {
    for (const id of Object.keys(BUILT_IN_PROMPTS)) {
      const t = BUILT_IN_PROMPTS[id]!
      expect(t.systemPrompt).toContain(getTokenCellText('targetLanguage'))
      // 元数据放在用户消息里、带定界符：进 system 会被当成同级指令（Codex 在 #28 指出）
      expect(t.systemPrompt).not.toContain(getTokenCellText('abstract'))
      expect(t.prompt).toContain('<document_metadata>')
      expect(t.prompt).toContain(getTokenCellText('abstract'))
      expect(t.prompt).toContain(getTokenCellText('input'))
    }
  })

  it('renderTemplate 替换全部变量，不留 {{ }}', () => {
    for (const id of Object.keys(BUILT_IN_PROMPTS)) {
      const t = BUILT_IN_PROMPTS[id]!
      const out = renderTemplate(t.systemPrompt, values) + renderTemplate(t.prompt, values)
      for (const token of PROMPT_TOKENS) expect(out).not.toContain(getTokenCellText(token))
      expect(out).toContain('ja')
    }
  })

  it('按 id 选内置；未知 id 回退 default', () => {
    expect(selectPrompt({ promptId: PRECISION_REWRITE_PROMPT_ID, patterns: [] }).id).toBe(PRECISION_REWRITE_PROMPT_ID)
    expect(selectPrompt({ promptId: 'nope', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
    expect(selectPrompt({ promptId: '', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
  })

  it('自定义提示词按 id 命中；与内置同名时内置优先（与 Read Frog 一致）', () => {
    const mine = { id: 'mine', name: 'mine', systemPrompt: 'S {{targetLanguage}}', prompt: '{{input}}' }
    expect(selectPrompt({ promptId: 'mine', patterns: [mine] })).toBe(mine)
    const shadow = { ...mine, id: DEFAULT_PROMPT_ID }
    expect(selectPrompt({ promptId: DEFAULT_PROMPT_ID, patterns: [shadow] })).toBe(BUILT_IN_PROMPTS[DEFAULT_PROMPT_ID])
  })

  it('身份：内置用 id，自定义带全文（不压 hash，缓存键外层才做 SHA-256）', () => {
    expect(promptKey()).toBe(DEFAULT_PROMPT_ID)
    const a = promptKey({ promptId: 'mine', patterns: [{ id: 'mine', name: '', systemPrompt: 'A', prompt: '{{input}}' }] })
    const b = promptKey({ promptId: 'mine', patterns: [{ id: 'mine', name: '', systemPrompt: 'B', prompt: '{{input}}' }] })
    expect(a.startsWith('custom:')).toBe(true)
    expect(a).toContain('"A"')
    expect(a).not.toBe(b)
  })

  it('id 撞上原型属性（constructor）时不摸原型，回退 default（Codex 在 #28 指出）', () => {
    expect(selectPrompt({ promptId: 'constructor', patterns: [] }).id).toBe(DEFAULT_PROMPT_ID)
    expect(promptKey({ promptId: 'toString', patterns: [] })).toBe(DEFAULT_PROMPT_ID)
  })

  it('单趟替换：原文里写着 "{{abstract}}" 也原样送出，不会被后面的变量二次替换', () => {
    const out = renderTemplate('{{input}} | {{abstract}}', { ...values, input: 'see {{abstract}} literally', abstract: 'A' })
    expect(out).toBe('see {{abstract}} literally | A')
  })

  it('指纹对两段分别编码："A"+"B C" 与 "A B"+"C" 不同键', () => {
    const k = (systemPrompt: string, prompt: string) => promptKey({ promptId: 'm', patterns: [{ id: 'm', name: '', systemPrompt, prompt }] })
    expect(k('A', 'B C')).not.toBe(k('A B', 'C'))
  })

  it('指纹按码点算：只差一个增补平面字符（😀 / 😁）的提示词不同键（Codex 在 #28 指出）', () => {
    const k = (systemPrompt: string) => promptKey({ promptId: 'm', patterns: [{ id: 'm', name: '', systemPrompt, prompt: '{{input}}' }] })
    expect(k('😀')).not.toBe(k('😁'))
  })
})
