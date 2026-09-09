// Pending translation nodes (DESIGN §7.6, following Read Frog): insert a spinner-only sibling before sending a request.
// Real translations replace them; renderText / renderTable call clearTranslation to remove siblings with the same data-axt-for.
// Consistent with §7.1: next sibling only; original nodes stay untouched.
import type { Block, TextBlock } from '@/core/extractor'
import { FOR_ATTR, INLINE_ATTR, clearTranslation, setState, shouldInline, translationClass } from './index'
import { cancelSpinnersIn, createSpinnerInside } from './spinner'

export const PENDING_CLASS = 'axt-pending'

function pendingOf(block: Block): Element | null {
  const next = block.el.nextElementSibling
  return next?.classList.contains(PENDING_CLASS) && next.getAttribute(FOR_ATTR) === block.id ? next : null
}

/**
 * Insert pending with the original tag (div for tables until their real clone arrives), original classes plus axt-t axt-pending.
 * Idempotent: return existing nodes. Short titles pair inline (§7.3), placing spinners after titles without shifts on completion.
 */
export function renderPending(block: Block): Element {
  const existing = pendingOf(block)
  if (existing) return existing
  // Retry must reset the entire block to pending; nothing from the previous attempt may remain:
  //   - Failure widgets (.axt-error) are invisible to pendingOf, so a spinner would insert before them,
  //     showing pending and Retry together and adding a right-column item in side mode (Codex #36).
  //   - data-axt-state="failed" draws a red border in modes.css; clear it during retry (#76).
  //   - Partial tables: cells.size > 0 uses renderTable + markPartial,
  //     marking the run outcome failed without a widget (run.ts:240-246). Reset must not depend on widget removal:
  //     clearFailed returns false for these, leaving the old clone, data-axt-partial, and translated state (#81).
  // clearTranslation removes translations / partial results / widgets sharing the ID; setState also removes partial.
  clearTranslation(block)
  setState(block, 'pending')
  const doc = block.el.ownerDocument
  const node = doc.createElement(block.kind === 'table' ? 'div' : block.el.tagName)
  node.className = `${translationClass(block.el)} ${PENDING_CLASS}`
  node.setAttribute(FOR_ATTR, block.id)
  if (block.kind === 'text' && shouldInline(block as TextBlock)) {
    block.el.setAttribute(INLINE_ATTR, '')
    node.setAttribute(INLINE_ATTR, '')
  }
  createSpinnerInside(node as HTMLElement)
  block.el.after(node)
  return node
}

/** Remove pending on failure / stop; successful translations use renderText instead. */
export function clearPending(block: Block): boolean {
  const node = pendingOf(block)
  if (!node) return false
  cancelSpinnersIn(node)
  node.remove()
  return true
}

/** Stop session: remove all pending nodes; return count removed. */
export function clearAllPending(doc: Document): number {
  const nodes = Array.from(doc.querySelectorAll(`.${PENDING_CLASS}`))
  for (const node of nodes) {
    cancelSpinnersIn(node)
    node.remove()
  }
  return nodes.length
}
