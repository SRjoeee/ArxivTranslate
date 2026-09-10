// A popover list under a row: the same component for the service, language and prompt menus of
// the popup. Optional search (the language list has 179 entries). Keyboard: arrows move, Enter
// picks, Escape closes; a click outside closes; a click on the row itself is the row's to toggle.
//
// Fixed-positioned and pinned to the bottom of the window: measured once when it opens (the row's
// rectangle), then only written. Out of flow, so the popup window keeps its size; the list scrolls
// inside whatever room is left below the row.
import { type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from './Spinner'

export interface MenuItem {
  id: string
  name: string
  hint?: string
  /** Extra words the search also matches (a language's other names, its code) */
  keywords?: string
  selected: boolean
  disabled?: boolean
  /** A button beside the item (the offline pack's download); `busy` shows a spinner instead */
  action?: { label: string; busy?: boolean }
}

const GAP = 4
const MARGIN = 8

export function Menu({ anchor, items, label, search, searchPlaceholder, empty, onSelect, onAction, onClose }: {
  /** The row the menu belongs to: it is positioned under it, and clicks on it are not "outside" */
  anchor: RefObject<HTMLElement | null>
  items: MenuItem[]
  label: string
  search?: boolean
  searchPlaceholder?: string
  empty?: string
  onSelect: (id: string) => void
  onAction?: (id: string) => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter(i => `${i.name} ${i.keywords ?? ''} ${i.hint ?? ''}`.toLowerCase().includes(q))
  }, [items, query])
  const [active, setActive] = useState(() => Math.max(0, items.findIndex(i => i.selected)))

  // One read at open, then only writes. A transformed ancestor is the containing block of a fixed
  // element (the gallery frames every popup that way), so its rectangle is subtracted when there is one
  useLayoutEffect(() => {
    // On a first mount with the menu already open (the gallery), the parent's ref is attached
    // after this child's layout effect; the menu sits inside the row, so its parent is the row
    const el = anchor.current ?? root.current?.parentElement
    if (!el) return
    const r = el.getBoundingClientRect()
    let frame: HTMLElement | null = el.parentElement
    while (frame && getComputedStyle(frame).transform === 'none') frame = frame.parentElement
    const f = frame?.getBoundingClientRect() ?? { top: 0, left: 0 }
    setBox({ top: r.bottom - f.top + GAP, left: r.left - f.left, width: r.width })
  }, [anchor])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (root.current?.contains(t) || anchor.current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onClose, anchor])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(shown.length - 1, a + 1)); return }
    if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(0, a - 1)); return }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = shown[active]
      if (item && !item.disabled) onSelect(item.id)
    }
  }

  return (
    <div
      ref={root}
      role="listbox"
      aria-label={label}
      onKeyDown={onKey}
      style={box ? { top: box.top, left: box.left, width: box.width, bottom: MARGIN } : { visibility: 'hidden' }}
      className="fixed z-10 flex flex-col overflow-hidden rounded-control border border-line bg-card shadow-[0_8px_24px_rgba(0,0,0,0.14)]"
    >
      {search && (
        <input
          // biome-ignore lint/a11y/noAutofocus: the menu opened from a click; the search field is what the reader opened it for
          autoFocus
          value={query}
          onChange={e => { setQuery(e.target.value); setActive(0) }}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="w-full shrink-0 border-b border-line bg-transparent px-3.5 py-2 text-[13px] text-fg outline-none placeholder:text-fg-2"
        />
      )}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {shown.length === 0 && <p className="px-3.5 py-2 text-[12px] text-fg-2">{empty}</p>}
        {shown.map((item, index) => (
          <div key={item.id} data-index={index} className={`flex items-center gap-2 pr-2 ${index === active ? 'bg-control' : ''}`}>
            <button
              type="button"
              role="option"
              aria-selected={item.selected}
              disabled={item.disabled}
              onMouseEnter={() => setActive(index)}
              onClick={() => onSelect(item.id)}
              className={`flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 px-3.5 py-2 text-left disabled:cursor-default ${item.disabled ? 'text-fg-2' : 'text-fg'}`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-[13px] font-semibold">{item.name}</span>
                {item.hint && <span className="truncate text-[11px] text-fg-2">{item.hint}</span>}
              </span>
              {item.selected && <Check />}
            </button>
            {item.action && (item.action.busy
              ? <Spinner className="mr-1.5 text-accent" />
              : <button type="button" onClick={() => onAction?.(item.id)} className="shrink-0 cursor-pointer rounded-full bg-accent px-3 py-1 text-[12px] font-semibold text-white">{item.action.label}</button>)}
          </div>
        ))}
      </div>
    </div>
  )
}

function Check() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-accent"><path d="M20 6 9 17l-5-5" /></svg>
}
