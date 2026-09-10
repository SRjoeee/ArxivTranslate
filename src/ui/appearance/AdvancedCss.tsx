// The escape hatch of a style profile: CSS declarations, folded away by default. The selector is
// the extension's, so a stray brace would change the whole paper's layout — the sanitiser refuses
// braces, at-rules and `<`, and says so on the spot rather than at some later save.
import { useRef, useState } from 'react'
import { sanitizeCustomCss } from '@/core/renderer'
import { O } from '@/ui/strings'

export function AdvancedCss({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [open, setOpen] = useState(value !== '')
  /**
   * The box holds a draft of its own. A rejected block never reaches the stored profile, so a
   * `value` fed straight back from it would snap the text away before the reason beneath it could
   * be read (Codex on #157). The draft follows the profile whenever that changes underneath.
   */
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  if (committed.current !== value) {
    committed.current = value
    if (draft !== value) setDraft(value)
  }
  const check = sanitizeCustomCss(draft)
  return (
    <div className="mb-4">
      <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex cursor-pointer items-center gap-1 text-[12px] font-semibold text-fg-2">
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={open ? 'rotate-90' : ''}><path d="m9 6 6 6-6 6" /></svg>
        {O.reading.advanced}
      </button>
      {open && (
        <div className="mt-2">
          <textarea
            aria-label={O.reading.advanced}
            value={draft}
            onChange={e => {
              setDraft(e.target.value)
              // Only a block that will survive the schema is handed up; the rest stays here with its reason
              if (sanitizeCustomCss(e.target.value).ok) onChange(e.target.value)
            }}
            rows={3}
            placeholder="font-style: italic;"
            className="w-full rounded-control border border-line bg-card px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-fg-2"
          />
          <p className={`mt-1 text-[11px] ${check.ok ? 'text-fg-2' : 'text-accent'}`}>{check.ok ? O.reading.advancedHint : check.reason}</p>
        </div>
      )}
    </div>
  )
}
