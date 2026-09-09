import { describe, expect, it, vi } from 'vitest'
import { extract, type TableBlock, type TextBlock } from '@/core/extractor'
import { ERROR_CLASS, FOR_ATTR, PARTIAL_ATTR, SPLIT_CLASS, STATE_ATTR, T_CLASS, clearTranslation, markPartial, renderFailed, renderPending, renderTable, restore, splitFigures } from '@/core/renderer'
import { docOf, frag } from './helpers'

const page = '<p class="ltx_p" id="p1">Text.</p>'

// Failure widget (§7.6): Retry button and exclamation mark with the reason, inside Shadow DOM as the next sibling of the original.
describe('renderFailed', () => {
  it('removes pending, marks failed, and inserts a shadow-root widget with a button and reason', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    renderPending(p)
    const host = renderFailed(p, 'auth: bad key', () => {})
    expect(doc.querySelectorAll('.axt-pending')).toHaveLength(0)
    expect(p.el.getAttribute(STATE_ATTR)).toBe('failed')
    expect(p.el.nextElementSibling).toBe(host)
    expect(host.className).toBe(`${T_CLASS} ${ERROR_CLASS}`)
    expect(host.getAttribute(FOR_ATTR)).toBe('p1')
    expect(host.getAttribute('title')).toBe('auth: bad key')
    const root = host.shadowRoot!
    expect(root.querySelector('button')?.textContent).toBe('Retry')
    expect(root.querySelector('.mark')?.getAttribute('title')).toBe('auth: bad key')
  })

  it('clicking Retry calls the callback and disables the button', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    const retry = vi.fn()
    const host = renderFailed(p, 'x', retry)
    const button = host.shadowRoot!.querySelector('button')!
    button.click()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
  })

  it('clearTranslation and restore remove everything and recover the identical DOM (§7.1)', () => {
    const doc = docOf(page)
    const before = doc.documentElement.outerHTML
    const p = extract(doc)[0] as TextBlock
    renderFailed(p, 'x', () => {})
    clearTranslation(p)
    expect(doc.querySelector(`.${ERROR_CLASS}`)).toBeNull()
    renderFailed(p, 'x', () => {})
    restore(doc)
    expect(doc.documentElement.outerHTML).toBe(before)
  })

  it('figure splitting does not treat failure widgets as translations', () => {
    const doc = docOf(`<figure class="ltx_figure"><img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption" id="c1">cap</figcaption></figure>`)
    const caption = extract(doc)[0] as TextBlock
    renderFailed(caption, 'x', () => {})
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
  })
})

describe('starting a retry removes the old failure widget (Codex #36)', () => {
  it('renderPending removes the block error widget before inserting a spinner', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    renderFailed(p, 'Network error', () => {})
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(1)
    // Retry follows this path: run.ts calls translate, then processBatch inserts pending.
    renderPending(p)
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(0)
    // The spinner immediately follows the original; otherwise both spinner and old widget would remain side by side.
    const next = p.el.nextElementSibling!
    expect(next.classList.contains('axt-pending')).toBe(true)
    expect(next.getAttribute(FOR_ATTR)).toBe(p.id)
    expect(p.el.parentElement!.querySelectorAll(`[${FOR_ATTR}="${p.id}"]`)).toHaveLength(1)
  })

  it('retry resets state to pending and removes both the red line and partial marker (Codex #76)', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    markPartial(p)
    renderFailed(p, 'Network error', () => {})
    expect(p.el.getAttribute(STATE_ATTR)).toBe('failed')
    renderPending(p)
    // modes.css draws the red line for failed state and the partial indicator for data-axt-partial; clear both.
    expect(p.el.getAttribute(STATE_ATTR)).toBe('pending')
    expect(p.el.hasAttribute(PARTIAL_ATTR)).toBe(false)
  })

  it('retrying partially translated tables cleans up even without a widget (Codex #81)', () => {
    // When cells.size > 0, run.ts calls renderTable and markPartial without creating a widget, but records the block as failed.
    // Conditioning reset on widget removal would leave all state on these blocks intact.
    const doc = docOf('<table class="ltx_tabular" id="t"><tbody><tr><td class="ltx_td">A</td></tr></tbody></table>')
    const block = extract(doc)[0]!
    expect(block.kind).toBe('table')
    const cell = doc.querySelector('.ltx_td')!
    renderTable(block as TableBlock, new Map([[cell, frag(doc, '甲')]]))
    markPartial(block)
    expect(block.el.getAttribute(STATE_ATTR)).toBe('translated')
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(1)
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(0) // Crucially, there is no widget.

    renderPending(block)
    expect(block.el.getAttribute(STATE_ATTR)).toBe('pending')
    expect(block.el.hasAttribute(PARTIAL_ATTR)).toBe(false)
    // The old partial clone is gone; only the spinner remains.
    const mine = [...doc.querySelectorAll(`[${FOR_ATTR}="${block.id}"]`)]
    expect(mine).toHaveLength(1)
    expect(mine[0]!.classList.contains('axt-pending')).toBe(true)
  })

  it('first translation without a failure widget leaves state alone because marking already set pending', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    p.el.setAttribute(STATE_ATTR, 'pending')
    renderPending(p)
    expect(p.el.getAttribute(STATE_ATTR)).toBe('pending')
  })

  it('an existing spinner makes rendering idempotent without removing unrelated content', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    const first = renderPending(p)
    expect(renderPending(p)).toBe(first)
  })
})
