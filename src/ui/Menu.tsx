// A popover list under a row: the same component for the service, language and prompt menus of
// the popup. Optional search (the language list has 179 entries). Keyboard: arrows move, Enter
// picks, Escape closes; a click outside closes; a click on the row itself is the row's to toggle.
//
// Fixed-positioned: measured once when it opens (the row's rectangle), then only written. Out of
// flow, so the popup window keeps its size. It fills the room below the row and the list scrolls
// inside it — or, when that room is too small to hold anything, it opens upward from the row
// instead and hugs its own content (the appearance row sits at the foot of the popup).
import { type CSSProperties, type RefObject, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from './Spinner'

export interface MenuItem {
  id: string
  name: string
  hint?: string
  /** Inline style for the hint line: the appearance menu shows each style on a sample sentence */
  preview?: CSSProperties
  /** Extra words the search also matches (a language's other names, its code) */
  keywords?: string
  selected: boolean
  disabled?: boolean
  /** A button beside the item (the offline pack's download); `busy` shows a spinner instead */
  action?: { label: string; busy?: boolean }
}

const GAP = 4
const MARGIN = 8
/**
 * Under this much room below the row, the menu opens **upward** instead. A row near the foot of the
 * popup otherwise gets a panel a few pixels tall: the window does not grow to fit it, it clips
 * (the reader reported exactly that on the appearance row, 2026-09-11)
 */
const MIN_BELOW = 180
/** A hugging menu is at least this wide, whatever its row measures */
const HUG_MIN_WIDTH = 180

export function Menu({ anchor, trigger, hug = false, items, label, search, searchPlaceholder, empty, onSelect, onAction, onClose }: {
  /** The element the menu is measured against: its width, and the edge it opens from */
  anchor: RefObject<HTMLElement | null>
  /**
   * Hug the list instead of filling the room below the row. For a page that is a page — the settings
   * page's own menus — where nothing resizes to fit it. The popup's menus keep the full-height
   * layout: its window **does** size to the document, and a menu that grew the window was the
   * defect that put this component on fixed positioning in the first place (Codex on #161)
   */
  hug?: boolean
  /**
   * The control that opened it, if that is not the anchor itself. Clicks on it are not "outside",
   * so pressing it again closes rather than reopens; a click anywhere else in the anchor — the two
   * switches sharing the appearance row — closes the menu and does its own thing
   */
  trigger?: RefObject<HTMLElement | null>
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
  /** `up` carries a max height instead of a top edge: the panel then hugs the row it grew from */
  const [box, setBox] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight?: number } | null>(null)
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
    const f = frame?.getBoundingClientRect() ?? { top: 0, left: 0, height: window.innerHeight, width: window.innerWidth }
    const top = r.top - f.top
    const bottom = r.bottom - f.top
    const below = f.height - bottom
    // A hugging menu is as wide as its row **or** wide enough to read, whichever is more: the
    // settings sidebar is 140px and "Follow the browser" has to fit. It is kept inside the frame
    const width = hug ? Math.max(r.width, HUG_MIN_WIDTH) : r.width
    const left = Math.max(MARGIN, Math.min(r.left - f.left, (f.width ?? width) - width - MARGIN))
    const common = { left, width }
    setBox(below < MIN_BELOW && top > below
      ? { ...common, bottom: f.height - top + GAP, maxHeight: Math.max(0, top - GAP - MARGIN) }
      : hug
        ? { ...common, top: bottom + GAP, maxHeight: Math.max(0, below - GAP - MARGIN) }
        : { ...common, top: bottom + GAP, bottom: MARGIN })
  }, [anchor, hug])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (root.current?.contains(t) || (trigger ?? anchor).current?.contains(t)) return
      onClose()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [onClose, anchor, trigger])
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])
  // The search field takes focus by itself; without one nothing inside would have it, and the
  // arrows, Enter and Escape below would never reach this element — the trigger is a sibling, not
  // a descendant (Codex on #157)
  useEffect(() => {
    if (!search) root.current?.focus()
  }, [search])

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
      tabIndex={-1}
      onKeyDown={onKey}
      style={box ? { top: box.top, bottom: box.bottom, left: box.left, width: box.width, maxHeight: box.maxHeight } : { visibility: 'hidden' }}
      className="fixed z-10 flex flex-col overflow-hidden rounded-control border border-line bg-card shadow-[0_8px_24px_rgba(0,0,0,0.14)] outline-none"
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
                {/* A preview is a sample drawn in the style, not information: it says nothing to a
                    reader who cannot see it, and it would swallow the option's name in the
                    accessible name. Every other hint here is real ("免费", "尚未配置 API Key") */}
                {item.hint && <span aria-hidden={item.preview ? 'true' : undefined} style={item.preview} className={`truncate text-[11px] ${item.preview ? '' : 'text-fg-2'}`}>{item.hint}</span>}
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
