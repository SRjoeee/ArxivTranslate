// A right-side panel for editing one thing (a service, an appearance profile). Escape and a click
// on the backdrop close it; the panel itself is a dialog for assistive technology.
import { type ReactNode, useEffect, useRef } from 'react'
import { drafts } from './drafts'
import { O } from './strings'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  const panel = useRef<HTMLElement>(null)
  // What a drawer edits is local until its own save: the page must not reload under it (ui/drafts.ts)
  useEffect(() => drafts.hold(), [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  /**
   * Take focus on open and give it back on close. Without this the keyboard stays on the trigger,
   * behind the backdrop, and Tab walks the settings controls the drawer covers (Codex on #157).
   * `aria-modal` tells assistive technology the same thing the backdrop tells the mouse.
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    // The **first control**, not the panel: from the panel itself Shift+Tab matches neither wrap
    // below and walks out to what the backdrop covers (Codex on #157)
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel.current)?.focus()
    return () => opener?.focus?.()
  }, [])
  /** Tab stays inside while it is open: the first and last focusable elements wrap onto each other */
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'Tab' || !panel.current) return
    const focusable = panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (!first || !last) return
    const here = document.activeElement
    // The panel counts as "before the first": it is where focus lands when a drawer has no controls
    // to hold it, and Shift+Tab from there must wrap to the end rather than leave
    if (e.shiftKey && (here === first || here === panel.current)) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && here === last) { e.preventDefault(); first.focus() }
  }
  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      {/* A real button, so the backdrop is reachable and dismissible from the keyboard as well */}
      <button type="button" aria-label={O.close} tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/25" />
      <section ref={panel} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={onKeyDown} className="relative flex h-full w-[420px] max-w-full flex-col bg-bg shadow-[0_0_40px_rgba(0,0,0,0.2)] outline-none">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <button type="button" aria-label={O.close} onClick={onClose} className="cursor-pointer text-fg-2 hover:text-fg">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center gap-3 border-t border-line px-5 py-4">{footer}</footer>}
      </section>
    </div>
  )
}
