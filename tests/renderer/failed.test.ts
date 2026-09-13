import { describe, expect, it, vi } from 'vitest'
import { extract, type TableBlock, type TextBlock } from '@/core/extractor'
import { T_CLASS } from '@/core/marks'
import { ERROR_CLASS, FOR_ATTR, PARTIAL_ATTR, SPLIT_CLASS, STATE_ATTR } from '@/core/renderer/attrs'
import { REASON_ATTR, relabelFailed, renderFailed } from '@/core/renderer/failed'
import { restore } from '@/core/renderer/page'
import { renderPending } from '@/core/renderer/pending'
import { splitFigures } from '@/core/renderer/split-figures'
import { clearTranslation, markPartial, renderTable } from '@/core/renderer/translation'
import { docOf, frag } from './helpers'
import { S, reasonText, setLocale } from '@/ui/strings'

const page = '<p class="ltx_p" id="p1">Text.</p>'

// The failure widget (§7.6): a retry button + a “!” with the reason, inside a Shadow DOM, only the original block's next sibling
describe('renderFailed', () => {
  it('after a change of interface language the button and the hover sentence are rewritten together (Codex on #161, the two halves in two rounds)', () => {
    const doc = docOf('<p class="ltx_p" id="p1">x</p>')
    const block = extract(doc)[0] as TextBlock
    renderFailed(block, 'auth: bad key', () => undefined)
    const host = doc.querySelector<HTMLElement>(`.${ERROR_CLASS}`)!
    setLocale('en')
    expect(relabelFailed(doc)).toBe(1)
    expect(host.getAttribute('title')).toBe(reasonText('auth'))
    expect(host.shadowRoot?.querySelector('button')?.textContent).toBe(S.page.retry)
    expect(host.shadowRoot?.querySelector('.mark')?.getAttribute('title')).toBe(reasonText('auth'))
    // The raw diagnostic stays: it is for diagnosis and does not follow the language
    expect(host.getAttribute(REASON_ATTR)).toBe('auth: bad key')
    setLocale('zh-CN')
    relabelFailed(doc)
    expect(host.getAttribute('title')).toBe(reasonText('auth'))
  })

  it('removes pending, marks failed, inserts the widget with a shadow root: button + reason', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    renderPending(p)
    const host = renderFailed(p, 'auth: bad key', () => {})
    expect(doc.querySelectorAll('.axt-pending')).toHaveLength(0)
    expect(p.el.getAttribute(STATE_ATTR)).toBe('failed')
    expect(p.el.nextElementSibling).toBe(host)
    expect(host.className).toBe(`${T_CLASS} ${ERROR_CLASS}`)
    expect(host.getAttribute(FOR_ATTR)).toBe('p1')
    // The reader sees the sentence in the interface language; the `kind: diagnostic` second half stays in the attribute for diagnosis (Codex on #161)
    expect(host.getAttribute('title')).toBe(reasonText('auth'))
    expect(host.getAttribute(REASON_ATTR)).toBe('auth: bad key')
    const root = host.shadowRoot!
    expect(root.querySelector('button')?.textContent).toBe(S.page.retry)
    expect(root.querySelector('.mark')?.getAttribute('title')).toBe(reasonText('auth'))
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

  it('clearTranslation / restore remove it cleanly, the DOM equal node for node (§7.1)', () => {
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

  it('splitting a figure does not take the widget for a translation', () => {
    const doc = docOf(`<figure class="ltx_figure"><img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption" id="c1">cap</figcaption></figure>`)
    const caption = extract(doc)[0] as TextBlock
    renderFailed(caption, 'x', () => {})
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
  })
})

describe('the old failure widget has to vanish when the retry starts (Codex on #36)', () => {
  it('renderPending removes the same block\'s .axt-error before inserting the ring', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    renderFailed(p, '网络错误', () => {})
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(1)
    // Clicking Retry takes exactly this path: run.ts's retry callback calls translate, and processBatch inserts pending
    renderPending(p)
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(0)
    // The ring follows the original block with nothing in between — unremoved, it would sit between the block and the widget, both present
    const next = p.el.nextElementSibling!
    expect(next.classList.contains('axt-pending')).toBe(true)
    expect(next.getAttribute(FOR_ATTR)).toBe(p.id)
    expect(p.el.parentElement!.querySelectorAll(`[${FOR_ATTR}="${p.id}"]`)).toHaveLength(1)
  })

  it('on retry the state returns to pending, and the red line and the partial mark vanish together (Codex on #76)', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    markPartial(p)
    renderFailed(p, '网络错误', () => {})
    expect(p.el.getAttribute(STATE_ATTR)).toBe('failed')
    renderPending(p)
    // modes.css draws the red line by data-axt-state="failed" and the partial mark by data-axt-partial; both have to go
    expect(p.el.getAttribute(STATE_ATTR)).toBe('pending')
    expect(p.el.hasAttribute(PARTIAL_ATTR)).toBe(false)
  })

  it('retrying a partially translated table: cleaned up even with no widget (Codex on #81)', () => {
    // The cells.size > 0 path in run.ts: renderTable + markPartial, **no widget built**, yet the block is recorded failed.
    // A reset hung on “the widget was removed” would clear nothing of such a block
    const doc = docOf('<table class="ltx_tabular" id="t"><tbody><tr><td class="ltx_td">A</td></tr></tbody></table>')
    const block = extract(doc)[0]!
    expect(block.kind).toBe('table')
    const cell = doc.querySelector('.ltx_td')!
    renderTable(block as TableBlock, new Map([[cell, frag(doc, '甲')]]))
    markPartial(block)
    expect(block.el.getAttribute(STATE_ATTR)).toBe('translated')
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(1)
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(0) // // the crux: no widget

    renderPending(block)
    expect(block.el.getAttribute(STATE_ATTR)).toBe('pending')
    expect(block.el.hasAttribute(PARTIAL_ATTR)).toBe(false)
    // The old half-done clone is gone, only the ring remains
    const mine = [...doc.querySelectorAll(`[${FOR_ATTR}="${block.id}"]`)]
    expect(mine).toHaveLength(1)
    expect(mine[0]!.classList.contains('axt-pending')).toBe(true)
  })

  it('a first translation (no failure widget) leaves the state alone: the marking loop has set pending already', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    p.el.setAttribute(STATE_ATTR, 'pending')
    renderPending(p)
    expect(p.el.getAttribute(STATE_ATTR)).toBe('pending')
  })

  it('with a ring present it is idempotent and removes nothing else by mistake', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    const first = renderPending(p)
    expect(renderPending(p)).toBe(first)
  })
})
