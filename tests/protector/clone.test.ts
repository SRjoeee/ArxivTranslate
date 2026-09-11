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

  it('SVG 的局部引用留在克隆里，定义留在原件上——两边共用同一套坐标系才成立（§15.6，独立审计 B16）', () => {
    // LaTeXML 的 TikZ 图靠 `<clipPath id>` + `clip-path="url(#id)"` 裁剪（一篇论文里几十处）。
    // 克隆剥掉 id 之后引用看上去悬空，实际不会：`url(#…)` 是**文档级**解析，克隆的引用落到
    // 原件的定义上，而两份共用同一套用户坐标系，结果一致。这条测试守的就是这个前提——
    // 哪天原件也开始被剥 id、或者克隆被搬进另一个文档，它会先红
    const doc = docOf('<p class="ltx_p">图 <svg id="fig"><defs><clipPath id="clip"><rect width="10" height="10"/></clipPath>'
      + '<path id="glyph" d="M0 0H8V8H0Z"/></defs><use href="#glyph"/><rect clip-path="url(#clip)" width="20" height="20"/></svg> 在此。</p>')
    const svg = doc.getElementById('fig')!
    const clone = cloneWithoutIds(doc, svg, true) as Element
    // 克隆：引用还在，定义的 id 没了
    expect(clone.querySelector('use')!.getAttribute('href')).toBe('#glyph')
    expect(clone.querySelector('rect[clip-path]')!.getAttribute('clip-path')).toBe('url(#clip)')
    expect(clone.querySelector('[id]')).toBeNull()
    // 原件：id 一个不少，克隆的引用才有着落
    expect(doc.getElementById('clip')).not.toBeNull()
    expect(doc.getElementById('glyph')).not.toBeNull()
  })

  it('浅克隆不带子树', () => {
    const doc = docOf('<span class="ltx_text" id="s">外<em>内</em></span>')
    const clone = cloneWithoutIds(doc, doc.getElementById('s')!, false) as Element
    expect(clone.childNodes).toHaveLength(0)
    expect(clone.hasAttribute('id')).toBe(false)
  })
})
