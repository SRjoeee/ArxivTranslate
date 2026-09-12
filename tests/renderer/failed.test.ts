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

// 失败态小部件（§7.6）：重试按钮 + 带原因的"！"，Shadow DOM 里，只是原块的下一个兄弟
describe('renderFailed', () => {
  it('换界面语言之后，按钮与悬停的那句一起改写（Codex 在 #161 两轮分别指出这两半）', () => {
    const doc = docOf('<p class="ltx_p" id="p1">x</p>')
    const block = extract(doc)[0] as TextBlock
    renderFailed(block, 'auth: bad key', () => undefined)
    const host = doc.querySelector<HTMLElement>(`.${ERROR_CLASS}`)!
    setLocale('en')
    expect(relabelFailed(doc)).toBe(1)
    expect(host.getAttribute('title')).toBe(reasonText('auth'))
    expect(host.shadowRoot?.querySelector('button')?.textContent).toBe(S.page.retry)
    expect(host.shadowRoot?.querySelector('.mark')?.getAttribute('title')).toBe(reasonText('auth'))
    // 原始诊断不动：它是给诊断用的，不跟着语言走
    expect(host.getAttribute(REASON_ATTR)).toBe('auth: bad key')
    setLocale('zh-CN')
    relabelFailed(doc)
    expect(host.getAttribute('title')).toBe(reasonText('auth'))
  })

  it('删掉 pending、标 failed，插带 shadow root 的小部件：按钮 + 原因', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    renderPending(p)
    const host = renderFailed(p, 'auth: bad key', () => {})
    expect(doc.querySelectorAll('.axt-pending')).toHaveLength(0)
    expect(p.el.getAttribute(STATE_ATTR)).toBe('failed')
    expect(p.el.nextElementSibling).toBe(host)
    expect(host.className).toBe(`${T_CLASS} ${ERROR_CLASS}`)
    expect(host.getAttribute(FOR_ATTR)).toBe('p1')
    // 读者看到的是按界面语言写的那一句；`kind: 诊断` 的后半段留在属性里给诊断（Codex 在 #161 指出）
    expect(host.getAttribute('title')).toBe(reasonText('auth'))
    expect(host.getAttribute(REASON_ATTR)).toBe('auth: bad key')
    const root = host.shadowRoot!
    expect(root.querySelector('button')?.textContent).toBe(S.page.retry)
    expect(root.querySelector('.mark')?.getAttribute('title')).toBe(reasonText('auth'))
  })

  it('点"重试"调回调并禁用按钮', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    const retry = vi.fn()
    const host = renderFailed(p, 'x', retry)
    const button = host.shadowRoot!.querySelector('button')!
    button.click()
    expect(retry).toHaveBeenCalledTimes(1)
    expect(button.disabled).toBe(true)
  })

  it('clearTranslation / restore 把它删干净，DOM 逐节点相等（§7.1）', () => {
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

  it('拆图不把小部件当译文', () => {
    const doc = docOf(`<figure class="ltx_figure"><img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption" id="c1">cap</figcaption></figure>`)
    const caption = extract(doc)[0] as TextBlock
    renderFailed(caption, 'x', () => {})
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)).toBeNull()
  })
})

describe('重试开始时旧的失败小部件要消失（Codex 在 #36 指出）', () => {
  it('renderPending 插圆环之前删掉同块的 .axt-error', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    renderFailed(p, '网络错误', () => {})
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(1)
    // 点"重试"走的就是这条路：run.ts 的 retry 回调调 translate，processBatch 里插 pending
    renderPending(p)
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(0)
    // 圆环紧跟原块，中间没有别的东西——不删的话它会插在原块与小部件之间，两个并存
    const next = p.el.nextElementSibling!
    expect(next.classList.contains('axt-pending')).toBe(true)
    expect(next.getAttribute(FOR_ATTR)).toBe(p.id)
    expect(p.el.parentElement!.querySelectorAll(`[${FOR_ATTR}="${p.id}"]`)).toHaveLength(1)
  })

  it('重试时状态回到 pending，红线与半翻标记一起消失（Codex 在 #76 指出）', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    markPartial(p)
    renderFailed(p, '网络错误', () => {})
    expect(p.el.getAttribute(STATE_ATTR)).toBe('failed')
    renderPending(p)
    // modes.css 按 data-axt-state="failed" 画红线、按 data-axt-partial 画半翻标记，两个都得清掉
    expect(p.el.getAttribute(STATE_ATTR)).toBe('pending')
    expect(p.el.hasAttribute(PARTIAL_ATTR)).toBe(false)
  })

  it('半翻的表格重试：没有小部件也要清干净（Codex 在 #81 指出）', () => {
    // run.ts 里 cells.size > 0 那条路：renderTable + markPartial，**不建小部件**，但块记为 failed。
    // 重置若挂在"删掉了小部件"上，这种块就一点都清不掉
    const doc = docOf('<table class="ltx_tabular" id="t"><tbody><tr><td class="ltx_td">A</td></tr></tbody></table>')
    const block = extract(doc)[0]!
    expect(block.kind).toBe('table')
    const cell = doc.querySelector('.ltx_td')!
    renderTable(block as TableBlock, new Map([[cell, frag(doc, '甲')]]))
    markPartial(block)
    expect(block.el.getAttribute(STATE_ATTR)).toBe('translated')
    expect(doc.querySelectorAll(`.${T_CLASS}`)).toHaveLength(1)
    expect(doc.querySelectorAll(`.${ERROR_CLASS}`)).toHaveLength(0) // 关键：没有小部件

    renderPending(block)
    expect(block.el.getAttribute(STATE_ATTR)).toBe('pending')
    expect(block.el.hasAttribute(PARTIAL_ATTR)).toBe(false)
    // 旧的半成品克隆没了，只剩圆环
    const mine = [...doc.querySelectorAll(`[${FOR_ATTR}="${block.id}"]`)]
    expect(mine).toHaveLength(1)
    expect(mine[0]!.classList.contains('axt-pending')).toBe(true)
  })

  it('首次翻译（没有失败小部件）时不碰状态：标记循环已经设过 pending 了', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    p.el.setAttribute(STATE_ATTR, 'pending')
    renderPending(p)
    expect(p.el.getAttribute(STATE_ATTR)).toBe('pending')
  })

  it('已经有圆环时是幂等的，不会误删别的东西', () => {
    const doc = docOf(page)
    const p = extract(doc)[0] as TextBlock
    const first = renderPending(p)
    expect(renderPending(p)).toBe(first)
  })
})
