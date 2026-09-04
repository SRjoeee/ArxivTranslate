import { describe, expect, it } from 'vitest'
import { extract, markBlocks, type TextBlock } from '@/core/extractor'
import { FOR_ATTR, MIRROR_CLASS, T_CLASS, createMirrors, renderText, restore } from '@/core/renderer'
import { docOf, frag } from './helpers'

/** 造出"某个容器里已有译文"的形状，容器判定才会生效 */
const withTranslation = (body: string) => {
  const doc = docOf(body)
  const blocks = extract(doc)
  markBlocks(blocks)
  const first = blocks.find(b => b.kind === 'text') as TextBlock | undefined
  if (first) renderText(first, frag(doc, '译文'))
  return doc
}

describe('createMirrors', () => {
  it('容器里没有译文的内容各补一份副本，标成 axt-t + axt-mirror', () => {
    const doc = withTranslation('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_equation" id="E1"><tbody><tr><td class="ltx_eqn_cell">x=1</td></tr></tbody></table></div>')
    expect(createMirrors(doc)).toBe(1)
    const mirror = doc.getElementById('E1')!.nextElementSibling!
    expect(mirror.classList.contains(T_CLASS)).toBe(true)
    expect(mirror.classList.contains(MIRROR_CLASS)).toBe(true)
    expect(mirror.tagName).toBe('TABLE')
    expect(mirror.hasAttribute('id')).toBe(false)
    expect(mirror.getAttribute(FOR_ATTR)).toMatch(/^mirror:/)
  })

  it('参考文献的序号与作者段也镜像——它们同样没有译文，右栏空着就断了对照', () => {
    const doc = withTranslation('<ul class="ltx_biblist"><li class="ltx_bibitem" id="b1">'
      + '<span class="ltx_tag ltx_tag_bibitem">[1]</span>'
      + '<span class="ltx_bibblock">A. Author, B. Author.</span>'
      + '<span class="ltx_bibblock">Some title.</span></li></ul>')
    createMirrors(doc)
    const item = doc.getElementById('b1')!
    const kinds = Array.from(item.children).map(c => `${Array.from(c.classList).filter(x => x.startsWith('ltx_'))[0]}${c.classList.contains(MIRROR_CLASS) ? '(镜像)' : c.classList.contains(T_CLASS) ? '(译文)' : ''}`)
    expect(kinds).toContain('ltx_tag(镜像)')
    expect(kinds.filter(k => k === 'ltx_bibblock(镜像)').length).toBe(1)
  })

  it('等待翻译的块不镜像：否则译文到达后会同时存在副本与译文', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">One.</p><p class="ltx_p" id="p2">Two.</p></div>')
    const blocks = extract(doc)
    markBlocks(blocks)
    renderText(blocks[0] as TextBlock, frag(doc, '译文'))
    createMirrors(doc)
    // p2 还没翻译，但它是块，不能被镜像
    expect(doc.getElementById('p2')!.nextElementSibling).toBeNull()
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('已经有译文的块不镜像；内部含译文的容器自己不镜像，交给它的子元素', () => {
    const doc = withTranslation('<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="c1">Cap.</figcaption></figure>')
    createMirrors(doc)
    const figure = doc.getElementById('F1')!
    expect(figure.nextElementSibling).toBeNull()
    expect(figure.querySelector(`.${MIRROR_CLASS}`)?.tagName).toBe('IMG')
  })

  it('幂等：重复调用不会叠加', () => {
    const doc = withTranslation('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_equation" id="E1"><tbody><tr><td>x</td></tr></tbody></table></div>')
    expect(createMirrors(doc)).toBe(1)
    expect(createMirrors(doc)).toBe(0)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('恢复原文时镜像一并删除，DOM 逐字回到原样', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = '<article class="ltx_document"><div class="ltx_para">'
      + '<p class="ltx_p" id="p1">Text.</p><table class="ltx_equation" id="E1"><tbody><tr><td>x</td></tr></tbody></table>'
      + '</div></article>'
    const before = document.documentElement.outerHTML
    const blocks = extract(document)
    markBlocks(blocks)
    renderText(blocks[0] as TextBlock, frag(document, '译文'))
    expect(createMirrors(document)).toBe(1)
    restore(document)
    expect(document.documentElement.outerHTML).toBe(before)
  })
})
