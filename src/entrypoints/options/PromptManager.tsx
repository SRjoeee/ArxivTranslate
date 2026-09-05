import { useRef, useState } from 'react'
import { downloadPromptFile, readPromptFile } from '@/providers/prompt-file'
import {
  BUILT_IN_PROMPTS, BUILT_IN_PROMPT_DESCRIPTIONS, DEFAULT_PROMPT_ID, PROMPT_TOKENS, getTokenCellText,
  type PromptTemplate, type PromptsConfig,
} from '@/providers/prompt-library'
import { getRandomUUID as uuid } from '@/shared/uuid'

// 提示词管理：功能对应 Read Frog components/prompt-configurator/*（列表、查看内置、复制并自定义、新建 / 编辑 / 删除、导入 / 导出、
// 变量按钮插到光标处）。它的实现是 base-ui + jotai + Tailwind，为一页十来个字段引整套 UI 栈不值，这里用设置页现有的朴素 React 重写。
// 改动只写进父组件的本地配置，随设置页的"保存"按钮一起落盘。

type EditorMode = 'view' | 'copy' | 'edit' | 'new'
type Field = 'systemPrompt' | 'prompt'

const TOKEN_HINTS: Record<(typeof PROMPT_TOKENS)[number], string> = {
  targetLanguage: '目标语言的英文名',
  input: '待翻译的 JSON 段落（用户消息里必须有）',
  paperTitle: '论文标题',
  abstract: '论文摘要',
  sectionTitle: '当前章节标题',
  glossary: '术语表',
}

/** 新建提示词的起点：点名目标语言并带上原文，只填名称也能用（Codex 在 #39 指出只有 {{input}} 的模板不知道译成哪种语言） */
const NEW_SYSTEM_PROMPT = `You are a professional ${getTokenCellText('targetLanguage')} translator of academic papers.`
const NEW_USER_PROMPT = `Translate the following into ${getTokenCellText('targetLanguage')}:\n\n${getTokenCellText('input')}`

const field = { display: 'block', width: '100%', boxSizing: 'border-box' as const, padding: '6px 8px', font: 'inherit', marginTop: 4 }
const small = { display: 'block', color: '#666', fontSize: 12 }
const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #eee' }
const button = { font: 'inherit', fontSize: 12 }

export function PromptManager({ value, onChange }: { value: PromptsConfig; onChange: (next: PromptsConfig) => void }) {
  const [editor, setEditor] = useState<{ mode: EditorMode; draft: PromptTemplate } | null>(null)
  const [message, setMessage] = useState('')
  const areas = useRef<Record<Field, HTMLTextAreaElement | null>>({ systemPrompt: null, prompt: null })
  const lastFocused = useRef<Field>('prompt')
  const fileInput = useRef<HTMLInputElement>(null)

  const builtIns = Object.values(BUILT_IN_PROMPTS)
  const select = (promptId: string) => onChange({ ...value, promptId })

  function open(mode: EditorMode, template?: PromptTemplate) {
    setMessage('')
    setEditor({ mode, draft: template ?? { id: uuid(), name: '', systemPrompt: NEW_SYSTEM_PROMPT, prompt: NEW_USER_PROMPT } })
  }

  /** 内置只读；"复制并自定义"给一份新 id 的副本，保存后直接选用（Read Frog 的做法） */
  function copyBuiltIn(template: PromptTemplate) {
    setEditor({ mode: 'copy', draft: { ...template, id: uuid(), name: `${template.name}（副本）` } })
  }

  function save() {
    if (!editor) return
    const { mode, draft } = editor
    if (!draft.name.trim()) return setMessage('名称不能为空')
    if (!draft.prompt.trim()) return setMessage('用户提示词不能为空')
    const patterns = mode === 'edit' ? value.patterns.map(p => (p.id === draft.id ? draft : p)) : [...value.patterns, draft]
    onChange({ patterns, promptId: mode === 'copy' ? draft.id : value.promptId })
    setEditor(null)
    setMessage('已加入列表，记得点下方"保存"')
  }

  function remove(template: PromptTemplate) {
    if (!window.confirm(`删除提示词「${template.name}」？`)) return
    onChange({
      patterns: value.patterns.filter(p => p.id !== template.id),
      promptId: value.promptId === template.id ? DEFAULT_PROMPT_ID : value.promptId,
    })
    if (editor?.draft.id === template.id) setEditor(null)
  }

  async function importFile(file: File | undefined) {
    if (!file) return
    try {
      const entries = await readPromptFile(file)
      onChange({ ...value, patterns: [...value.patterns, ...entries.map(entry => ({ ...entry, id: uuid() }))] })
      setMessage(`已导入 ${entries.length} 条，记得点下方"保存"`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /** 把变量插到最后聚焦的那个文本框的光标处（对应 Read Frog 的 QuickInsertableTextarea） */
  function insertToken(token: (typeof PROMPT_TOKENS)[number]) {
    if (!editor) return
    const which = lastFocused.current
    const el = areas.current[which]
    const text = getTokenCellText(token)
    const current = editor.draft[which]
    const start = el?.selectionStart ?? current.length
    const end = el?.selectionEnd ?? current.length
    const next = current.slice(0, start) + text + current.slice(end)
    setEditor({ ...editor, draft: { ...editor.draft, [which]: next } })
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(start + text.length, start + text.length)
    })
  }

  const readOnly = editor?.mode === 'view'
  const titles: Record<EditorMode, string> = { view: '查看内置提示词', copy: '复制并自定义', edit: '编辑提示词', new: '新建提示词' }

  return (
    <div>
      {builtIns.map(template => (
        <div key={template.id} style={row}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input type="radio" name="axt-prompt" checked={value.promptId === template.id} onChange={() => select(template.id)} />
            <span>
              {template.name}
              <small style={small}>{BUILT_IN_PROMPT_DESCRIPTIONS[template.id]}</small>
            </span>
          </label>
          <button type="button" style={button} onClick={() => open('view', template)}>查看</button>
        </div>
      ))}
      {value.patterns.map(template => (
        <div key={template.id} style={row}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input type="radio" name="axt-prompt" checked={value.promptId === template.id} onChange={() => select(template.id)} />
            <span>{template.name}<small style={small}>自定义</small></span>
          </label>
          <button type="button" style={button} onClick={() => open('edit', template)}>编辑</button>
          <button type="button" style={button} onClick={() => remove(template)}>删除</button>
        </div>
      ))}

      <p style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <button type="button" style={button} onClick={() => open('new')}>新建</button>
        <button type="button" style={button} onClick={() => fileInput.current?.click()}>导入 JSON</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => importFile(e.target.files?.[0])} />
        <button type="button" style={button} disabled={value.patterns.length === 0} onClick={() => downloadPromptFile(value.patterns)}>导出自定义</button>
        <span style={{ color: '#666', fontSize: 12 }}>{message}</span>
      </p>

      {editor && (
        <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: 12, marginTop: 4 }}>
          <strong>{titles[editor.mode]}</strong>
          <label style={{ display: 'block', marginTop: 8 }}>
            名称
            <input style={field} value={editor.draft.name} readOnly={readOnly} onChange={e => setEditor({ ...editor, draft: { ...editor.draft, name: e.target.value } })} />
          </label>
          {(['systemPrompt', 'prompt'] as Field[]).map(which => (
            <label key={which} style={{ display: 'block', marginTop: 8 }}>
              {which === 'systemPrompt' ? 'System prompt（收发协议会自动追加在它后面，改不掉）' : '用户提示词'}
              <textarea
                ref={el => { areas.current[which] = el }}
                style={{ ...field, minHeight: which === 'systemPrompt' ? 140 : 100, fontFamily: 'ui-monospace, monospace', fontSize: 12 }}
                value={editor.draft[which]}
                readOnly={readOnly}
                onFocus={() => { lastFocused.current = which }}
                onChange={e => setEditor({ ...editor, draft: { ...editor.draft, [which]: e.target.value } })}
              />
            </label>
          ))}
          {!readOnly && (
            <p style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '8px 0' }}>
              <span style={{ color: '#666', fontSize: 12 }}>插入变量：</span>
              {PROMPT_TOKENS.map(token => (
                <button type="button" key={token} style={button} title={TOKEN_HINTS[token]} onClick={() => insertToken(token)}>{getTokenCellText(token)}</button>
              ))}
            </p>
          )}
          <p style={{ display: 'flex', gap: 8, margin: '8px 0 0' }}>
            {readOnly
              ? <button type="button" style={button} onClick={() => copyBuiltIn(editor.draft)}>复制并自定义</button>
              : <button type="button" style={button} onClick={save}>加入列表</button>}
            <button type="button" style={button} onClick={() => setEditor(null)}>{readOnly ? '关闭' : '取消'}</button>
          </p>
        </div>
      )}
    </div>
  )
}
