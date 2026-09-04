import { describe, expect, it } from 'vitest'
import { extract, type TextBlock } from '@/core/extractor'
import { FOR_ATTR, MIRROR_CLASS, T_CLASS, createMirrors, renderText, restore } from '@/core/renderer'
import { docOf, frag } from './helpers'

describe('createMirrors', () => {
  it('给没有译文的公式与图形各插一份副本，标成 axt-t + axt-mirror', () => {
    const doc = docOf('<div class="ltx_para"><p class="ltx_p" id="p1">Text.</p>'
      + '<table class="ltx_equation" id="E1"><tbody><tr><td class="ltx_eqn_cell">x=1</td></tr></tbody></table></div>'
      + '<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption">Cap.</figcaption></figure>')
    expect(createMirrors(doc)).toBe(2)
    const eq = doc.getElementById('E1')!
    const mirror = eq.nextElementSibling!
    expect(mirror.classList.contains(T_CLASS)).toBe(true)
    expect(mirror.classList.contains(MIRROR_CLASS)).toBe(true)
    expect(mirror.tagName).toBe('TABLE')
    expect(mirror.hasAttribute('id')).toBe(false)
    expect(mirror.getAttribute(FOR_ATTR)).toMatch(/^mirror:/)
  })

  it('幂等：重复调用不会叠加', () => {
    const doc = docOf('<div class="ltx_para"><table class="ltx_equation" id="E1"><tbody><tr><td>x</td></tr></tbody></table></div>')
    expect(createMirrors(doc)).toBe(1)
    expect(createMirrors(doc)).toBe(0)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('只镜像图形，不镜像整个 figure：说明由译文配对，右栏不会出现英文说明', () => {
    const doc = docOf('<figure class="ltx_figure" id="F1"><img class="ltx_graphics" src="a.png">'
      + '<figcaption class="ltx_caption" id="c1">Cap.</figcaption></figure>')
    const caption = extract(doc).find(b => b.id === 'c1') as TextBlock
    renderText(caption, frag(doc, '说明。'))
    expect(createMirrors(doc)).toBe(1)
    const figure = doc.getElementById('F1')!
    expect(figure.nextElementSibling).toBeNull()
    const mirror = figure.querySelector(`.${MIRROR_CLASS}`)!
    expect(mirror.tagName).toBe('IMG')
    expect(figure.querySelectorAll(`.${T_CLASS}`)).toHaveLength(2)
  })

  it('嵌套目标只镜像最外层', () => {
    const doc = docOf('<div class="ltx_para"><table class="ltx_equationgroup" id="G1"><tbody><tr><td>'
      + '<table class="ltx_equation"><tbody><tr><td>x</td></tr></tbody></table></td></tr></tbody></table></div>')
    expect(createMirrors(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
  })

  it('恢复原文时镜像一并删除，DOM 逐字回到原样', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = '<article class="ltx_document"><div class="ltx_para">'
      + '<p class="ltx_p" id="p1">Text.</p><table class="ltx_equation" id="E1"><tbody><tr><td>x</td></tr></tbody></table>'
      + '</div></article>'
    const before = document.documentElement.outerHTML
    expect(createMirrors(document)).toBe(1)
    expect(document.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(1)
    restore(document)
    expect(document.documentElement.outerHTML).toBe(before)
  })
})
