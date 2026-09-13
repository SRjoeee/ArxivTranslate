// 提示词与术语: how an LLM service translates. The free services read neither, so the section says
// so rather than hiding itself — a reader looking for the glossary should find it either way.
import { useEffect, useRef, useState } from 'react'
import { configSchema } from '@/config/schema'
import { isLlmChosen } from '@/config/services'
import { type GlossaryEntry, formatGlossaryText, parseGlossary } from '@/providers/glossary'
import { O } from '@/ui/strings'
import { drafts } from '@/ui/drafts'
import type { OptionsData } from '../data'
import { PromptManager } from '../PromptManager'

export function Prompts({ data }: { data: OptionsData }) {
  const { config, patch } = data
  // The glossary is text on the page and entries in storage: pasting a batch beats editing rows
  const [text, setText] = useState<string | null>(null)
  /** The glossary this text last came from or last wrote, in the text's own form: a stored value equal to it is not news */
  const own = useRef<string | null>(null)
  /** Writes of this box not seen landing yet. While one is out the store is behind the reader, not ahead of them */
  const pending = useRef(0)
  /**
   * The last write was refused: the text is a draft the store does not have, and stays until a later write lands
   * (eighth pass). State, not a ref: the refusal arrives after the render that read it (Codex on #185)
   */
  const [failed, setFailed] = useState(false)
  /**
   * The draft hold of the writes themselves (ui/drafts.ts), taken the moment a write starts and kept until the latest
   * text has landed: a refused write leaves the text unsaved, and a reload asked for elsewhere in the gap before
   * React renders the refusal would otherwise find no draft (the local review of S1, ninth pass)
   */
  const writing = useRef<(() => void) | null>(null)
  /** The entries of the newest write issued: the hold ends when that one has landed, not when an older one has */
  const latest = useRef<readonly GlossaryEntry[] | null>(null)
  useEffect(() => () => { writing.current?.(); writing.current = null }, [])
  // The text follows the stored glossary: the first read, and a change saved elsewhere (Codex on #185) — never the
  // reader's own typing coming back to them. What this box wrote is not news when it lands; while a write is still
  // out, whatever the store says is older than the text (the local review of S1, seventh pass: the earlier version
  // took every difference for a change made elsewhere and put back, mid-word, the letter the reader had just typed).
  // A draft that does not parse or fit yet is the reader's to finish; the entries it saves later are their later word
  useEffect(() => {
    if (!config) return
    const stored = formatGlossaryText(config.glossary)
    if (text === null) {
      own.current = stored
      setText(stored)
      return
    }
    if (stored === own.current || pending.current > 0 || failed) return
    const local = parseGlossary(text)
    if (local.issues.length > 0 || !configSchema.shape.glossary.safeParse(local.entries).success) return
    own.current = stored
    setText(stored)
  }, [config, text, failed])
  const parsed = text === null ? null : parseGlossary(text)
  // A table can parse line by line and still break the schema's limits (200 entries, per-field
  // length, 6000 characters in all). Writing it would reject silently and leave the reader looking
  // at a glossary that is not in storage (Codex on #157)
  const overLimit = parsed !== null && parsed.issues.length === 0 && !configSchema.shape.glossary.safeParse(parsed.entries).success
  // A table that is not written yet is a draft: the page must not reload under it (ui/drafts.ts); a refused write leaves one too
  const unsaved = parsed !== null && (parsed.issues.length > 0 || overLimit || failed)
  useEffect(() => (unsaved ? drafts.hold() : undefined), [unsaved])
  if (!config || parsed === null || text === null) return null

  return (
    <>
      {!isLlmChosen(config) && <p className="mb-4 rounded-card bg-card px-3.5 py-2.5 text-[12px] text-fg-2">{O.prompts.onlyLlm}</p>}

      <h3 className="mb-2 text-[14px] font-bold">{O.prompts.title}</h3>
      <div className="mb-8 rounded-card border border-line bg-card p-3.5">
        <PromptManager value={config.prompts} onChange={prompts => void patch(latest => ({ ...latest, prompts }))} />
      </div>

      <div className="mb-2 flex items-end justify-between">
        <span className="flex flex-col">
          <h3 className="text-[14px] font-bold">{O.prompts.glossary}</h3>
          <span className="text-[11px] text-fg-2">{O.prompts.glossaryHint}</span>
        </span>
        <span className="text-[12px] text-fg-2">{O.prompts.glossaryCount(parsed.entries.length)}</span>
      </div>
      <textarea
        aria-label={O.prompts.glossary}
        value={text}
        rows={6}
        placeholder={O.prompts.glossaryPlaceholder}
        onChange={e => {
          setText(e.target.value)
          // Only a table that parses **and** fits the schema is written; the rest stays on screen
          // with its reason
          const next = parseGlossary(e.target.value)
          if (next.issues.length === 0 && configSchema.shape.glossary.safeParse(next.entries).success) {
            own.current = formatGlossaryText(next.entries)
            pending.current++
            latest.current = next.entries
            writing.current ??= drafts.hold()
            patch(stored => ({ ...stored, glossary: next.entries }))
              .then(
                () => {
                  setFailed(false)
                  if (latest.current === next.entries) { writing.current?.(); writing.current = null }
                },
                () => setFailed(true),
              )
              .finally(() => { pending.current-- })
          }
        }}
        className="w-full rounded-control border border-line bg-card px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-fg-2"
      />
      {parsed.issues.map(issue => (
        <p key={issue.line} className="mt-1 text-[11px] text-accent">{O.prompts.glossaryIssue[issue.reason](issue.line)}</p>
      ))}
      {overLimit && <p className="mt-1 text-[11px] text-accent">{O.prompts.glossaryTooBig}</p>}
    </>
  )
}
