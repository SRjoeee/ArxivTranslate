// 提示词与术语: how an LLM service translates. The free services read neither, so the section says
// so rather than hiding itself — a reader looking for the glossary should find it either way.
import { useEffect, useState } from 'react'
import { configSchema } from '@/config/schema'
import { isLlmChosen } from '@/config/services'
import { formatGlossaryText, parseGlossary } from '@/providers/glossary'
import { O } from '@/ui/strings'
import { drafts } from '@/ui/drafts'
import type { OptionsData } from '../data'
import { PromptManager } from '../PromptManager'

export function Prompts({ data }: { data: OptionsData }) {
  const { config, patch } = data
  // The glossary is text on the page and entries in storage: pasting a batch beats editing rows
  const [text, setText] = useState<string | null>(null)
  useEffect(() => { if (config && text === null) setText(formatGlossaryText(config.glossary)) }, [config, text])
  const parsed = text === null ? null : parseGlossary(text)
  // A table can parse line by line and still break the schema's limits (200 entries, per-field
  // length, 6000 characters in all). Writing it would reject silently and leave the reader looking
  // at a glossary that is not in storage (Codex on #157)
  const overLimit = parsed !== null && parsed.issues.length === 0 && !configSchema.shape.glossary.safeParse(parsed.entries).success
  // A table that is not written yet is a draft: the page must not reload under it (ui/drafts.ts)
  const unsaved = parsed !== null && (parsed.issues.length > 0 || overLimit)
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
            void patch(latest => ({ ...latest, glossary: next.entries }))
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
