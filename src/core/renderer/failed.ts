// Failure widget (DESIGN §7.6): Retry and an exclamation mark with the reason beside the failed block, isolated in Shadow DOM.
// Corresponds to Read Frog components/translation/error/* (React + jotai + @tabler/icons + base-ui, one React root per failed block).
// Those dependencies and per-block roots add overhead (including its #1831 leak); native DOM implements the same two controls here (§12).
// Consistent with §7.1: only an adjacent sibling; restore removes the host for complete cleanup.
import type { Block } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { FOR_ATTR, clearTranslation, setState } from './index'

export const ERROR_CLASS = 'axt-error'

const STYLE = `
:host { display: inline-flex; align-items: center; gap: 4px; font: 12px system-ui, sans-serif; vertical-align: middle; }
button { font: inherit; padding: 0 6px; border: 1px solid var(--axt-failed-color, rgba(220, 38, 38, 0.6)); border-radius: 3px; background: transparent; color: inherit; cursor: pointer; }
button:disabled { opacity: 0.5; cursor: default; }
.mark { color: var(--axt-failed-color, rgba(220, 38, 38, 0.9)); font-weight: 700; cursor: help; }
`

/** Remove the adjacent failure widget when retry starts; return whether it existed. */
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
 * Failure: remove pending / old translation, mark failed (retaining the red border), then insert the widget.
 * Retry disables the button and invokes retry; renderPending removes the widget before inserting the spinner.
 */
export function renderFailed(block: Block, reason: string, retry: () => void): Element {
  clearTranslation(block)
  setState(block, 'failed')
  const doc = block.el.ownerDocument
  const host = doc.createElement('span')
  host.className = `${T_CLASS} ${ERROR_CLASS}`
  host.setAttribute(FOR_ATTR, block.id)
  host.title = reason
  const root = host.attachShadow({ mode: 'open' })
  const style = doc.createElement('style')
  style.textContent = STYLE
  const button = doc.createElement('button')
  button.type = 'button'
  button.textContent = 'Retry'
  button.addEventListener('click', () => {
    button.disabled = true
    retry()
  })
  const mark = doc.createElement('span')
  mark.className = 'mark'
  mark.title = reason
  mark.textContent = '!'
  root.append(style, button, mark)
  block.el.after(host)
  return host
}
