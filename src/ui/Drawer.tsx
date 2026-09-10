// A right-side panel for editing one thing (a service, an appearance profile). Escape and a click
// on the backdrop close it; the panel itself is a dialog for assistive technology.
import { type ReactNode, useEffect } from 'react'

export function Drawer({ title, onClose, children, footer }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="fixed inset-0 z-20 flex justify-end">
      {/* A real button, so the backdrop is reachable and dismissible from the keyboard as well */}
      <button type="button" aria-label="关闭" tabIndex={-1} onClick={onClose} className="absolute inset-0 cursor-default bg-black/25" />
      <section role="dialog" aria-label={title} className="relative flex h-full w-[420px] max-w-full flex-col bg-bg shadow-[0_0_40px_rgba(0,0,0,0.2)]">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-[15px] font-bold">{title}</h2>
          <button type="button" aria-label="关闭" onClick={onClose} className="cursor-pointer text-fg-2 hover:text-fg">
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex items-center gap-3 border-t border-line px-5 py-4">{footer}</footer>}
      </section>
    </div>
  )
}
