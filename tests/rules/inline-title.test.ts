import { describe, expect, it } from 'vitest'
import { isInlineTitleCandidate } from '@/core/rules/latexml'

const docOf = (body: string) => new DOMParser().parseFromString(`<!doctype html><html><body><article class="ltx_document">${body}</article></body></html>`, 'text/html')

describe('isInlineTitleCandidate', () => {
  it('节标题、摘要标题是候选；文档主标题、段落不是', () => {
    const doc = docOf(
      '<h6 class="ltx_title ltx_title_abstract" id="a">Abstract</h6>'
      + '<h2 class="ltx_title ltx_title_section" id="s">1 Introduction</h2>'
      + '<h1 class="ltx_title ltx_title_document" id="d">Paper</h1>'
      + '<p class="ltx_p" id="p">Text.</p>',
    )
    const get = (id: string) => doc.getElementById(id)!
    expect(isInlineTitleCandidate(get('a'))).toBe(true)
    expect(isInlineTitleCandidate(get('s'))).toBe(true)
    expect(isInlineTitleCandidate(get('d'))).toBe(false)
    expect(isInlineTitleCandidate(get('p'))).toBe(false)
  })
})
