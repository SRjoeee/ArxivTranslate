import { useRef, useState } from 'react'
import { downloadPromptFile, readPromptFile } from '@/providers/prompt-file'
import {
  BUILT_IN_PROMPTS, BUILT_IN_PROMPT_DESCRIPTIONS, DEFAULT_PROMPT_ID, PROMPT_TOKENS, getTokenCellText,
  type PromptTemplate, type PromptsConfig,
} from '@/providers/prompt-library'
import { getRandomUUID as uuid } from '@/shared/uuid'

// Prompt management corresponds to Read Frog components/prompt-configurator/*: list, view built-ins, copy/customize, CRUD, import/export,
// and variable insertion at the cursor. Rewritten with the settings page's plain React; importing base-ui + jotai + Tailwind for a few fields is unnecessary.
// Changes update only the parent's local config and persist with the settings page's Save button.

type EditorMode = 'view' | 'copy' | 'edit' | 'new'
type Field = 'systemPrompt' | 'prompt'

const TOKEN_HINTS: Record<(typeof PROMPT_TOKENS)[number], string> = {
  targetLanguage: 'English name of the target language',
  input: 'JSON segments to translate (required in the user message)',
  paperTitle: 'Paper title',
  abstract: 'Paper abstract',
  sectionTitle: 'Current section title',
  glossary: 'Glossary',
}

/** New prompt starter: names the target and includes source text, so a name alone makes it usable (Codex #39: {{input}} alone omits the target). */
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

  /** Built-ins are read-only; Copy and customize creates a new id and selects the copy when saved (as in Read Frog). */
  function copyBuiltIn(template: PromptTemplate) {
    setEditor({ mode: 'copy', draft: { ...template, id: uuid(), name: `${template.name} (copy)` } })
  }

  function save() {
    if (!editor) return
    const { mode, draft } = editor
    if (!draft.name.trim()) return setMessage('Name is required')
    if (!draft.prompt.trim()) return setMessage('User prompt is required')
    const patterns = mode === 'edit' ? value.patterns.map(p => (p.id === draft.id ? draft : p)) : [...value.patterns, draft]
    onChange({ patterns, promptId: mode === 'copy' ? draft.id : value.promptId })
    setEditor(null)
    setMessage('Added to the list. Click Save below to keep your changes.')
  }

  function remove(template: PromptTemplate) {
    if (!window.confirm(`Delete prompt "${template.name}"?`)) return
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
      setMessage(`Imported ${entries.length} prompts. Click Save below to keep your changes.`)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  /** Insert a variable at the cursor in the last-focused text area (Read Frog QuickInsertableTextarea). */
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
  const titles: Record<EditorMode, string> = { view: 'View built-in prompt', copy: 'Copy and customize', edit: 'Edit prompt', new: 'New prompt' }

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
          <button type="button" style={button} onClick={() => open('view', template)}>View</button>
        </div>
      ))}
      {value.patterns.map(template => (
        <div key={template.id} style={row}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 1 }}>
            <input type="radio" name="axt-prompt" checked={value.promptId === template.id} onChange={() => select(template.id)} />
            <span>{template.name}<small style={small}>Custom</small></span>
          </label>
          <button type="button" style={button} onClick={() => open('edit', template)}>Edit</button>
          <button type="button" style={button} onClick={() => remove(template)}>Delete</button>
        </div>
      ))}

      <p style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '8px 0' }}>
        <button type="button" style={button} onClick={() => open('new')}>New</button>
        <button type="button" style={button} onClick={() => fileInput.current?.click()}>Import JSON</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={e => importFile(e.target.files?.[0])} />
        <button type="button" style={button} disabled={value.patterns.length === 0} onClick={() => downloadPromptFile(value.patterns)}>Export custom prompts</button>
        <span style={{ color: '#666', fontSize: 12 }}>{message}</span>
      </p>

      {editor && (
        <div style={{ border: '1px solid #ddd', borderRadius: 4, padding: 12, marginTop: 4 }}>
          <strong>{titles[editor.mode]}</strong>
          <label style={{ display: 'block', marginTop: 8 }}>
            Name
            <input style={field} value={editor.draft.name} readOnly={readOnly} onChange={e => setEditor({ ...editor, draft: { ...editor.draft, name: e.target.value } })} />
          </label>
          {(['systemPrompt', 'prompt'] as Field[]).map(which => (
            <label key={which} style={{ display: 'block', marginTop: 8 }}>
              {which === 'systemPrompt' ? 'System prompt (mandatory input/output protocol is appended automatically)' : 'User prompt'}
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
              <span style={{ color: '#666', fontSize: 12 }}>Insert variable:</span>
              {PROMPT_TOKENS.map(token => (
                <button type="button" key={token} style={button} title={TOKEN_HINTS[token]} onClick={() => insertToken(token)}>{getTokenCellText(token)}</button>
              ))}
            </p>
          )}
          <p style={{ display: 'flex', gap: 8, margin: '8px 0 0' }}>
            {readOnly
              ? <button type="button" style={button} onClick={() => copyBuiltIn(editor.draft)}>Copy and customize</button>
              : <button type="button" style={button} onClick={save}>Add to list</button>}
            <button type="button" style={button} onClick={() => setEditor(null)}>{readOnly ? 'Close' : 'Cancel'}</button>
          </p>
        </div>
      )}
    </div>
  )
}
