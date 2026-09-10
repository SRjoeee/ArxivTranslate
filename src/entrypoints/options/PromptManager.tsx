import { useRef, useState } from 'react'
import { downloadPromptFile, readPromptFile } from '@/providers/prompt-file'
import {
  BUILT_IN_PROMPTS, DEFAULT_PROMPT_ID, PROMPT_TOKENS, getTokenCellText,
  type PromptTemplate, type PromptsConfig,
} from '@/providers/prompt-library'
import { getRandomUUID as uuid } from '@/shared/uuid'
import { O } from '@/ui/strings'

// The prompt library: the same features as Read Frog's components/prompt-configurator/* — the list,
// reading a built-in one, copying it into an editable one, new / edit / delete, import / export, and
// the variable buttons that insert at the caret. Read Frog builds it on base-ui + jotai + Tailwind;
// a whole UI stack for a dozen fields is not worth it, so this is the settings page's plain React.
// A change is handed to the parent, which writes it to storage straight away — the page has no save button.

type EditorMode = 'view' | 'copy' | 'edit' | 'new'
type Field = 'systemPrompt' | 'prompt'

/** Read at render, not at import: this module is evaluated before the pack is chosen (ui/strings.ts) */
const tokenHint = (token: (typeof PROMPT_TOKENS)[number]): string => O.prompts.manager.tokens[token]
/** The shipped prompts' one-line descriptions, in the interface's language (Codex on #161) */
const builtInDescription = (id: string): string => (O.prompts.manager.builtIn as Record<string, string>)[id] ?? ''

/** 新建提示词的起点：点名目标语言并带上原文，只填名称也能用（Codex 在 #39 指出只有 {{input}} 的模板不知道译成哪种语言） */
const NEW_SYSTEM_PROMPT = `You are a professional ${getTokenCellText('targetLanguage')} translator of academic papers.`
const NEW_USER_PROMPT = `Translate the following into ${getTokenCellText('targetLanguage')}:\n\n${getTokenCellText('input')}`

const field = { display: 'block', width: '100%', boxSizing: 'border-box' as const, padding: '6px 8px', font: 'inherit', marginTop: 4 }
const small = { display: 'block', color: 'var(--axt-fg-2)', fontSize: 12 }
const row = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--axt-line)' }
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
    if (!draft.name.trim()) return setMessage(O.prompts.manager.nameEmpty)
    if (!draft.prompt.trim()) return setMessage(O.prompts.manager.promptEmpty)
    const patterns = mode === 'edit' ? value.patterns.map(p => (p.id === draft.id ? draft : p)) : [...value.patterns, draft]
    onChange({ patterns, promptId: mode === 'copy' ? draft.id : value.promptId })
    setEditor(null)
    setMessage(mode === 'edit' ? O.prompts.manager.saved : O.prompts.manager.added)
  }

  function remove(template: PromptTemplate) {
    if (!window.confirm(O.prompts.manager.removeConfirm(template.name))) return
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
      setMessage(O.prompts.manager.imported(entries.length))
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
  const titles: Record<EditorMode, string> = { view: O.prompts.manager.viewTitle, copy: O.prompts.manager.copyTitle, edit: O.prompts.manager.editTitle, new: O.prompts.manager.createTitle }

  return (
    <div>
      {builtIns.map(template => (
        <div key={template.id} style={row}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input type="radio" name="axt-prompt" checked={value.promptId === template.id} onChange={() => select(template.id)} />
            <span>
              {template.name}
              <small style={small}>{builtInDescription(template.id)}</small>
            </span>
          </label>
          <button type="button" style={button} onClick={() => open('view', template)}>{O.prompts.manager.view}</button>
        </div>
      ))}
      {value.patterns.map(template => (
        <div key={template.id} style={row}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input type="radio" name="axt-prompt" checked={value.promptId === template.id} onChange={() => select(template.id)} />
            <span>{template.name}<small style={small}>{O.prompts.manager.custom}</small></span>
          </label>
          <button type="button" style={button} onClick={() => open('edit', template)}>{O.prompts.manager.edit}</button>
          <button type="button" style={button} onClick={() => remove(template)}>{O.prompts.manager.remove}</button>
        </div>
      ))}

      <p style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <button type="button" style={button} onClick={() => open('new')}>{O.prompts.manager.create}</button>
        <button type="button" style={button} onClick={() => fileInput.current?.click()}>{O.prompts.manager.importFile}</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => importFile(e.target.files?.[0])} />
        <button type="button" style={button} disabled={value.patterns.length === 0} onClick={() => downloadPromptFile(value.patterns)}>{O.prompts.manager.exportMine}</button>
        <span style={{ color: 'var(--axt-fg-2)', fontSize: 12 }}>{message}</span>
      </p>

      {editor && (
        <div style={{ border: '1px solid var(--axt-line)', borderRadius: 4, padding: 12, marginTop: 4 }}>
          <strong>{titles[editor.mode]}</strong>
          <label style={{ display: 'block', marginTop: 8 }}>
            名称
            <input style={field} value={editor.draft.name} readOnly={readOnly} onChange={e => setEditor({ ...editor, draft: { ...editor.draft, name: e.target.value } })} />
          </label>
          {(['systemPrompt', 'prompt'] as Field[]).map(which => (
            <label key={which} style={{ display: 'block', marginTop: 8 }}>
              {which === 'systemPrompt' ? O.prompts.manager.systemPrompt : O.prompts.manager.userPrompt}
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
              <span style={{ color: 'var(--axt-fg-2)', fontSize: 12 }}>{O.prompts.manager.insert}</span>
              {PROMPT_TOKENS.map(token => (
                <button type="button" key={token} style={button} title={tokenHint(token)} onClick={() => insertToken(token)}>{getTokenCellText(token)}</button>
              ))}
            </p>
          )}
          <p style={{ display: 'flex', gap: 8, margin: '8px 0 0' }}>
            {readOnly
              ? <button type="button" style={button} onClick={() => copyBuiltIn(editor.draft)}>{O.prompts.manager.copy}</button>
              : <button type="button" style={button} onClick={save}>{O.prompts.manager.addToList}</button>}
            <button type="button" style={button} onClick={() => setEditor(null)}>{readOnly ? O.prompts.manager.close : O.prompts.manager.cancel}</button>
          </p>
        </div>
      )}
    </div>
  )
}
