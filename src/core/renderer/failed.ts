// The failure widget (DESIGN §7.6): a “retry” button beside the failed block and an exclamation mark carrying the reason, in a
// Shadow DOM out of the site's styles. The counterpart of Read Frog's components/translation/error/* (React + jotai
// + @tabler/icons + base-ui, one React root per failed block); those dependencies and a root per block are a burden
// (it took the leak of its own #1831), so a few dozen lines of plain DOM make the same two controls (the trade-off
// of §12). In keeping with §7.1: it is only the original block's next sibling, and restore removing the host is all
// the clean-up there is.
import type { Block } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { S, parseFatal, reasonText } from '@/ui/strings'
import { ERROR_CLASS, FOR_ATTR } from './attrs'
import { translationShell } from './shell'
import { clearTranslation, setState } from './translation'

/** The raw diagnostic stays in an attribute: `restore()` clears it with the injected marks as a whole, and it never reaches the interface */
export const REASON_ATTR = 'data-axt-reason'

const STYLE = `
:host { display: inline-flex; align-items: center; gap: 4px; font: 12px system-ui, sans-serif; vertical-align: middle; }
button { font: inherit; padding: 0 6px; border: 1px solid var(--axt-failed-color, rgba(220, 38, 38, 0.6)); border-radius: 3px; background: transparent; color: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
.mark { color: var(--axt-failed-color, rgba(220, 38, 38, 0.9)); font-weight: 700; cursor: help; }
`

/** Remove the failure widget beside a block (when a retry starts); returns whether one was removed */
export function clearFailed(block: Block): boolean {
  const parent = block.el.parentElement
  if (!parent) return false
  let removed = false
  for (const sibling of Array.from(parent.children)) {
    if (sibling.classList.contains(ERROR_CLASS) && sibling.getAttribute(FOR_ATTR) === block.id) {
      sibling.remove()
      removed = true
    }
  }
  return removed
}

/**
 * Failure: remove the pending node or the old translation, mark failed (the red line as before), then insert the
 * widget. Clicking “retry” disables the button and calls retry; renderPending removes the widget before inserting
 * the ring (see there)
 */
export function renderFailed(block: Block, reason: string, retry: () => void): Element {
  clearTranslation(block)
  setState(block, 'failed')
  const doc = block.el.ownerDocument
  const host = doc.createElement('span')
  host.className = `${T_CLASS} ${ERROR_CLASS}`
  host.setAttribute(FOR_ATTR, block.id)
  // The widget of a description row cannot be a `<span>` child of `<tbody>`: that breaks the table content model and
  // the browser moves it out of the table (Codex on #168). Wrap it as `<tr><td>…</td></tr>` with the translation's own shell
  const { node: outer, slot } = translationShell(block)
  const widget = outer === slot ? null : outer
  // The reader sees the sentence in the interface's language; the tail of `kind: diagnostic` is kept for diagnosis, not shown (Codex on #161)
  const kind = parseFatal(reason)
  host.title = reasonText(kind.kind) || S.page.retry
  host.setAttribute(REASON_ATTR, reason)
  const root = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = STYLE
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = S.page.retry
  button.addEventListener('click', () => {
    button.disabled = true
    retry()
  })
  const mark = doc.createElement('span')
  mark.className = 'mark'
  mark.title = host.title
  mark.textContent = '！'
  root.append(style, button, mark)
  if (widget) {
    // The shell carries the class / data-axt-for itself: pairing and clean-up go by it; host is only the widget inside
    widget.className = host.className
    widget.setAttribute(FOR_ATTR, block.id)
    host.classList.remove(T_CLASS)
    host.removeAttribute(FOR_ATTR)
    slot.append(host)
    block.el.after(widget)
    return widget
  }
  block.el.after(host)
  return host
}

/**
 * Re-label the widgets already on the page. A widget copies the word into its shadow root when it
 * is built, so a page holding failed blocks would keep the previous language until those blocks were
 * retried (Codex on #161). Called when the interface's language changes under an open paper
 */
export function relabelFailed(doc: Document): number {
  const hosts = doc.querySelectorAll<HTMLElement>(`.${ERROR_CLASS}`)
  for (const host of hosts) {
    const root = (host as HTMLElement & { shadowRoot: ShadowRoot | null }).shadowRoot
    const button = root?.querySelector('button')
    if (button) button.textContent = S.page.retry
    // The sentence shown on hover must follow too: it is derived from kind, and the raw diagnostic stays in the attribute (Codex on #161)
    const reason = host.getAttribute(REASON_ATTR)
    if (reason === null) continue
    host.title = reasonText(parseFatal(reason).kind) || S.page.retry
    const mark = root?.querySelector<HTMLElement>('.mark')
    if (mark) mark.title = host.title
  }
  return hosts.length
}
