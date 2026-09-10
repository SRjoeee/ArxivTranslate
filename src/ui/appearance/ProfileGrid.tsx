// The list of appearance profiles as tiles: each shows what it does rather than naming it, the
// chosen one is checked, and a pencil on it opens the editor. Adding and resetting sit in the
// toolbar, so the grid itself stays a row of choices.
import type { ReactNode } from 'react'
import { Button } from '@/ui/Button'
import { O, profileName } from '@/ui/strings'

export function ProfileGrid<T extends { id: string; name: string }>({ kind, title, hint, items, activeId, onChoose, onEdit, onAdd, onReset, renderTile }: {
  /** Which list this is: the names of the ones that ship with the extension come from the pack */
  kind: 'styles' | 'highlights'
  title: string
  hint?: string
  items: readonly T[]
  activeId: string
  onChoose: (id: string) => void
  onEdit: (id: string) => void
  onAdd: () => void
  onReset: () => void
  renderTile: (item: T) => ReactNode
}) {
  return (
    <section className="mb-8">
      <header className="mb-2 flex items-end justify-between">
        <span className="flex flex-col">
          <h3 className="text-[14px] font-bold">{title}</h3>
          {hint && <span className="text-[11px] text-fg-2">{hint}</span>}
        </span>
        <span className="flex items-center gap-2">
          <Button variant="chip" onClick={onAdd}>{O.reading.add}</Button>
          <Button variant="text" title={O.reading.resetHint} onClick={onReset}>{O.reading.reset}</Button>
        </span>
      </header>
      <div className="grid grid-cols-3 gap-2">
        {items.map(item => {
          const active = item.id === activeId
          return (
            <div key={item.id} className={`relative rounded-card border bg-card p-3 ${active ? 'border-accent' : 'border-line'}`}>
              <button type="button" aria-pressed={active} aria-label={profileName(item, kind)} onClick={() => onChoose(item.id)} className="block w-full cursor-pointer text-left">
                <span className="block h-8 overflow-hidden">{renderTile(item)}</span>
                <span className="mt-1.5 block truncate text-[12px] font-semibold">{profileName(item, kind)}</span>
              </button>
              {active && (
                <button type="button" aria-label={`${O.reading.editTitle}：${profileName(item, kind)}`} onClick={() => onEdit(item.id)} className="absolute right-2 top-2 cursor-pointer text-fg-2 hover:text-fg">
                  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
