import { describe, expect, it } from 'vitest'
import { cloneWithoutIds } from '@/core/protector/clone'

const docOf = (body: string) =>
  new DOMParser().parseFromString(`<!doctype html><html><body>${body}</body></html>`, 'text/html')

describe('cloneWithoutIds', () => {
  it('剥掉自身与子树的 id，其他属性保留', () => {
    const doc = docOf('<span id="s" class="ltx_note" data-keep="1"><a id="a" href="/x">链接</a></span>')
    const clone = cloneWithoutIds(doc, doc.getElementById('s')!, true) as Element
    expect(clone.hasAttribute('id')).toBe(false)
    expect(clone.querySelector('[id]')).toBeNull()
    expect(clone.getAttribute('data-keep')).toBe('1')
    expect(clone.querySelector('a')?.getAttribute('href')).toBe('/x')
  })

  it('剥掉 data-axt-* 标记', () => {
    const doc = docOf('<span class="ltx_note" data-axt-id="b1" data-axt-state="translated"><em data-axt-id="b2">x</em></span>')
    const clone = cloneWithoutIds(doc, doc.querySelector('.ltx_note')!, true) as Element
    expect(clone.hasAttribute('data-axt-id')).toBe(false)
    expect(clone.hasAttribute('data-axt-state')).toBe(false)
    expect(clone.querySelector('[data-axt-id]')).toBeNull()
  })

  it('删掉克隆里已有的译文节点：先翻脚注再翻外层段落时不会把脚注译文复制进去', () => {
    const doc = docOf(
      '<span class="ltx_note"><span class="ltx_note_content" data-axt-id="n1">Footnote.</span>'
      + '<span class="axt-t" data-axt-for="n1">脚注。</span></span>',
    )
    const clone = cloneWithoutIds(doc, doc.querySelector('.ltx_note')!, true) as Element
    expect(clone.querySelectorAll('.axt-t')).toHaveLength(0)
    expect(clone.textContent).toBe('Footnote.')
    // 原节点不受影响
    expect(doc.querySelectorAll('.axt-t')).toHaveLength(1)
  })

  it('浅克隆不带子树', () => {
    const doc = docOf('<span class="ltx_text" id="s">外<em>内</em></span>')
    const clone = cloneWithoutIds(doc, doc.getElementById('s')!, false) as Element
    expect(clone.childNodes).toHaveLength(0)
    expect(clone.hasAttribute('id')).toBe(false)
  })
})
