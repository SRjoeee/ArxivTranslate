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
})
