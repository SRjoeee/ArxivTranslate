// 插图整块拆两份（DESIGN §7.2）。图与公式没有译文，按块配对右栏就空着；
// 整张图跨两栏又等于放弃对照，所以整块复制一份、副本里只留译文。
import { describe, expect, it } from 'vitest'
import { MIRROR_CLASS, SPLIT_ATTR, SPLIT_CLASS, T_CLASS, restore, splitFigures } from '@/core/renderer'
import { docOf } from './helpers'

/** 一张带分图说明的插图：图形 + 说明 + 说明的译文 */
const figure = (extra = '') => `<figure class="ltx_figure">
  <img class="ltx_graphics" src="a.png" width="600" height="200">
  <figcaption class="ltx_caption">Figure 1. Original</figcaption>
  <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="c1">图 1. 译文</figcaption>${extra}
</figure>`

describe('splitFigures', () => {
  it('内含配对的插图整块复制一份，副本只留译文', () => {
    const doc = docOf(figure())
    expect(splitFigures(doc)).toBe(1)
    const original = doc.querySelector(`figure[${SPLIT_ATTR}]`)!
    const clone = original.nextElementSibling!
    expect(clone.classList.contains(SPLIT_CLASS)).toBe(true)
    expect(clone.classList.contains(T_CLASS)).toBe(true) // 配对规则据此把它放进右栏
    // 副本：图还在，原文说明没了，只剩译文
    expect(clone.querySelector('img')).not.toBeNull()
    expect(clone.querySelectorAll('.ltx_caption')).toHaveLength(1)
    expect(clone.textContent).toContain('图 1. 译文')
    expect(clone.textContent).not.toContain('Figure 1. Original')
    // 原件一个子节点都没动，只多了标记
    expect(original.querySelectorAll('.ltx_caption')).toHaveLength(2)
  })

  it('副本不带原件的 id 与块标记', () => {
    const doc = docOf(`<figure class="ltx_figure" id="S1.F1">
      <img class="ltx_graphics" src="a.png"><figcaption class="ltx_caption" id="S1.F1.cap" data-axt-id="b1">cap</figcaption>
      <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="b1">说明</figcaption></figure>`)
    splitFigures(doc)
    const clone = doc.querySelector(`.${SPLIT_CLASS}`)!
    expect(clone.id).toBe('')
    expect(clone.querySelector('[id]')).toBeNull()
    expect(clone.querySelector('[data-axt-id]')).toBeNull()
  })

  it('没有译文的插图不拆：那是镜像的活', () => {
    const doc = docOf('<figure class="ltx_figure"><img class="ltx_graphics" src="a.png"></figure>')
    expect(splitFigures(doc)).toBe(0)
  })

  it('没有媒体的浮动体不拆：表格浮动体的表本来就有译文克隆', () => {
    const doc = docOf(`<figure class="ltx_table">
      <table class="ltx_tabular"><tbody><tr><td>a</td></tr></tbody></table>
      <table class="ltx_tabular ${T_CLASS}" data-axt-for="t1"><tbody><tr><td>甲</td></tr></tbody></table>
      <figcaption class="ltx_caption">Table 1</figcaption>
      <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="c1">表 1</figcaption></figure>`)
    expect(splitFigures(doc)).toBe(0)
  })

  it('嵌套的分图交给最外层一起复制，不各拆各的', () => {
    const doc = docOf(`<figure class="ltx_figure"><div class="ltx_flex_figure"><div class="ltx_flex_cell">
      <figure class="ltx_figure ltx_figure_panel"><img class="ltx_graphics" src="a.png">
        <figcaption class="ltx_caption">(a) panel</figcaption>
        <figcaption class="ltx_caption ${T_CLASS}" data-axt-for="p1">(a) 面板</figcaption>
      </figure></div></div></figure>`)
    expect(splitFigures(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
  })

  it('幂等：译文没变就不重建', () => {
    const doc = docOf(figure())
    expect(splitFigures(doc)).toBe(1)
    expect(splitFigures(doc)).toBe(0)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
  })

  it('译文变多了要重建副本，否则右栏永远停在半成品', () => {
    const doc = docOf(figure())
    splitFigures(doc)
    const fig = doc.querySelector(`figure[${SPLIT_ATTR}]`)!
    const p = doc.createElement('p')
    p.className = 'ltx_p'
    p.textContent = 'note'
    fig.append(p)
    const t = doc.createElement('p')
    t.className = `ltx_p ${T_CLASS}`
    t.setAttribute('data-axt-for', 'c2')
    t.textContent = '注'
    p.after(t)
    expect(splitFigures(doc)).toBe(1)
    expect(doc.querySelectorAll(`.${SPLIT_CLASS}`)).toHaveLength(1)
    expect(doc.querySelector(`.${SPLIT_CLASS}`)!.textContent).toContain('注')
  })

  it('图里原有的镜像会被清掉：两套方案叠加会重复一份', () => {
    const doc = docOf(figure(`<img class="ltx_graphics ${T_CLASS} ${MIRROR_CLASS}" src="a.png">`))
    splitFigures(doc)
    expect(doc.querySelectorAll(`.${MIRROR_CLASS}`)).toHaveLength(0)
  })

  it('恢复原文后与翻译前逐节点相等（§7.1）', () => {
    const doc = docOf(figure())
    const before = doc.querySelector('article')!.innerHTML
    splitFigures(doc)
    // 副本与标记都由 restore 清掉
    for (const t of Array.from(doc.querySelectorAll(`.${T_CLASS}`))) t.remove()
    restore(doc)
    expect(doc.querySelector(`[${SPLIT_ATTR}]`)).toBeNull()
    expect(doc.querySelector('article')!.innerHTML.replace(/\s+/g, ' ').trim())
      .toBe(before.replace(new RegExp(`<figcaption class="ltx_caption ${T_CLASS}"[^>]*>[^<]*</figcaption>`), '').replace(/\s+/g, ' ').trim())
  })
})
