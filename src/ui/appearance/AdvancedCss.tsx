// The escape hatch of a style profile: CSS declarations, folded away by default. The selector is
// the extension's, so a stray brace would change the whole paper's layout — the sanitiser refuses
// braces, at-rules and `<`, and says so on the spot rather than at some later save.
import { useRef, useState } from 'react'
import { sanitizeCustomCss } from '@/core/renderer'
import { O } from '@/ui/strings'

export function AdvancedCss({ value, onChange }: { value: string; onChange: (next: string) => unknown }) {
  const [open, setOpen] = useState(value !== '')
  /**
   * The box holds a draft of its own. A rejected block never reaches the stored profile, so a
   * `value` fed straight back from it would snap the text away before the reason beneath it could
   * be read (Codex on #157). The draft follows the profile when that changes underneath — a change
   * saved elsewhere (INVENTORY S1) — but never while a write of its own is out: the store is behind
   * the reader then, and what it says lands before their block does. `onChange` answers with the
   * write, so the box knows when its own have landed — the prop cannot tell it: a block equal to the
   * stored one, or written twice, changes no prop (the local review of S1, eighth to eleventh passes).
   * A refused block, and a write the store refused, are the reader's to finish
   */
  const [draft, setDraft] = useState(value)
  const committed = useRef(value)
  /** Writes of this box not landed yet */
  const pending = useRef(0)
  /** The last write was refused: the text is a draft the store does not have, until a later write lands */
  const failed = useRef(false)
  if (committed.current !== value) {
    committed.current = value
    if (pending.current === 0 && !failed.current && draft !== value && sanitizeCustomCss(draft).ok) setDraft(value)
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
              if (sanitizeCustomCss(e.target.value).ok) {
                pending.current++
                Promise.resolve(onChange(e.target.value))
                  .then(() => { failed.current = false }, () => { failed.current = true })
                  .finally(() => { pending.current-- })
              }
            }}
            rows={3}
            placeholder="font-style: italic;"
            className="w-full rounded-control border border-line bg-card px-3 py-2 font-mono text-[12px] text-fg outline-none focus:border-fg-2"
          />
          <p className={`mt-1 text-[11px] ${check.ok ? 'text-fg-2' : 'text-accent'}`}>{check.ok ? O.reading.advancedHint : O.reading.advancedRejected[check.reason]}</p>
        </div>
      )}
    </div>
  )
}
