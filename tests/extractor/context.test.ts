// 论文级上下文：标题 + 摘要（去掉 "Abstract" 标题、截断）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ABSTRACT_MAX_CHARS, paperContext } from '@/core/extractor'

const load = (name: string) => new DOMParser().parseFromString(readFileSync(join(import.meta.dirname, '../fixtures/arxiv', name), 'utf8'), 'text/html')

describe('paperContext', () => {
  it('真实论文：标题与摘要正文，摘要不带 "Abstract" 标题', () => {
    const ctx = paperContext(load('2312.17141.html'))
    expect(ctx.paperTitle).toContain('Probabilistic Programming')
    expect(ctx.abstract).toBeTruthy()
    expect(ctx.abstract!.toLowerCase().startsWith('abstract')).toBe(false)
    expect(ctx.abstract!.length).toBeLessThanOrEqual(ABSTRACT_MAX_CHARS + 3)
  })

  it('没有标题与摘要的页面返回空对象，不放 undefined 字段', () => {
    const doc = new DOMParser().parseFromString('<article class="ltx_document"><p class="ltx_p">x</p></article>', 'text/html')
    expect(paperContext(doc)).toEqual({})
  })

  it('过长的摘要按词截断并加省略号', () => {
    const long = 'word '.repeat(600)
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6><p class="ltx_p">${long}</p></div></article>`, 'text/html')
    const { abstract } = paperContext(doc)
    expect(abstract!.length).toBeLessThanOrEqual(ABSTRACT_MAX_CHARS + 3)
    expect(abstract!.endsWith('...')).toBe(true)
  })

  it('摘要里的公式只取呈现层文字，不把 <annotation> 里的 TeX 源码读一遍（Codex 在 #28 指出）', () => {
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6>
      <p class="ltx_p">Let <math><semantics><mi>x</mi><annotation encoding="application/x-tex">\\mathbf{x}</annotation></semantics></math> be.</p></div></article>`, 'text/html')
    expect(paperContext(doc).abstract).toBe('Let x be.')
  })

  it('标题里嵌着的出版元数据不算标题（2507.00150 把 .ltx_pubnotes 放在文档标题里）', () => {
    const doc = load('2507.00150.html')
    const notes = doc.querySelector('.ltx_title_document .ltx_pubnotes')
    expect(notes).not.toBeNull()
    const noteText = (notes!.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 30)
    const { paperTitle } = paperContext(doc)
    expect(paperTitle).toBeTruthy()
    expect(paperTitle).not.toContain(noteText)
  })

  it('翻译过之后再抽，我们注入的译文不会混进摘要（Codex 在 #28 指出）', () => {
    const doc = new DOMParser().parseFromString(`<article class="ltx_document"><div class="ltx_abstract"><h6 class="ltx_title">Abstract</h6>
      <p class="ltx_p" data-axt-id="a1">We study graphs.</p><p class="ltx_p axt-t" data-axt-for="a1">我们研究图。</p></div></article>`, 'text/html')
    expect(paperContext(doc).abstract).toBe('We study graphs.')
  })
})
