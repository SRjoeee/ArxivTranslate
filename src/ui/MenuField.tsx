// A row that opens the popup's Menu under itself, for the settings page (the target language).
import { useRef, useState } from 'react'
import { Menu, type MenuItem } from './Menu'

export function MenuField({ label, value, items, search, searchPlaceholder, empty, compact = false, onSelect }: {
  label: string
  value: string
  items: MenuItem[]
  search?: boolean
  searchPlaceholder?: string
  empty?: string
  /** For a narrow column — the sidebar's language chooser: smaller type, tighter padding */
  compact?: boolean
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLDivElement>(null)
  return (
    <div ref={anchor} className="relative rounded-card border border-line bg-card">
      <button type="button" aria-haspopup="listbox" aria-expanded={open} aria-label={label} onClick={() => setOpen(v => !v)} className={`flex w-full cursor-pointer items-center justify-between text-left ${compact ? 'gap-1 px-2.5 py-1.5' : 'px-3.5 py-3'}`}>
        <span className={`truncate font-semibold ${compact ? 'text-[12px]' : 'text-[13px]'}`}>{value}</span>
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-fg-2/60"><path d={open ? 'm18 15-6-6-6 6' : 'm6 9 6 6 6-6'} /></svg>
      </button>
      {open && (
        <Menu
          anchor={anchor}
          // The settings page is an ordinary tab: a menu that hugs its list is right there, and
          // three rows must not open a panel to the foot of the window (Codex on #161)
          hug={compact}
          items={items}
          label={label}
          search={search}
          searchPlaceholder={searchPlaceholder}
          empty={empty}
          onSelect={id => { setOpen(false); onSelect(id) }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}
