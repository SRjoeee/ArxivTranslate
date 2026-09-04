import { describe, expect, it } from 'vitest'
import { T_CLASS, alignPairMargins, clearPairMargins } from '@/core/renderer'

/** 站点里形如 ar5iv `.ltx_role_affiliation + .ltx_role_affiliation` 的相邻兄弟边距规则 */
const SITE_CSS = '.aff + .aff { margin-top: 8px }'

/** 作者区的形状：两对（邮箱、机构），译文复制原块的 class */
function setup(css = SITE_CSS): { original: HTMLElement; translation: HTMLElement } {
  document.head.innerHTML = `<style>${css}</style>`
  document.body.innerHTML = `<article class="ltx_document"><span class="box"
    ><span class="c mail">a@b</span><span class="c mail ${T_CLASS}">甲</span
    ><span class="c aff">Univ</span><span class="c aff ${T_CLASS}">大学</span
  ></span></article>`
  const original = document.querySelector<HTMLElement>(`.aff:not(.${T_CLASS})`)!
  return { original, translation: original.nextElementSibling as HTMLElement }
}

/** happy-dom 对没有声明的边距返回空串，浏览器返回 "0px" */
const mt = (el: Element) => getComputedStyle(el).marginTop || '0px'

describe('alignPairMargins', () => {
  it('译文插进来会改写相邻兄弟规则的匹配结果，同一对的上边距因此不一致', () => {
    const { original, translation } = setup()
    // 原文的前一个兄弟是上一条译文（.mail），译文的前一个兄弟是自己的原文（.aff）
    expect(mt(original)).toBe('0px')
    expect(mt(translation)).toBe('8px')
  })

  it('把原文的上边距抄到译文上，两边计算值一致', () => {
    const { original, translation } = setup()
    expect(alignPairMargins(document)).toBe(1)
    expect(mt(translation)).toBe(mt(original))
    expect(translation.style.marginTop).toBe('0px')
  })

  it('幂等：重复调用不再报告改动（值已经写好）', () => {
    setup()
    expect(alignPairMargins(document)).toBe(1)
    expect(alignPairMargins(document)).toBe(0)
  })

  it('重算时先擦掉上一轮的值，站点边距变了能跟着改', () => {
    const { translation } = setup()
    alignPairMargins(document)
    expect(translation.style.marginTop).toBe('0px')
    // 窗口变化后站点样式给出新的边距（这里直接换规则模拟）
    document.head.innerHTML = '<style>.aff { margin-top: 5px }</style>'
    // 两边都成了 5px，本来就一致：擦掉上一轮写死的 0px 也算一次改动
    expect(alignPairMargins(document)).toBe(1)
    expect(translation.style.marginTop).toBe('')
    expect(mt(translation)).toBe('5px')
  })

  it('原节点不被改写（§7.1）', () => {
    const { original } = setup()
    alignPairMargins(document)
    expect(original.getAttribute('style')).toBeNull()
  })

  it('clearPairMargins 把内联边距还给站点样式', () => {
    const { translation } = setup()
    alignPairMargins(document)
    clearPairMargins(document)
    expect(translation.style.marginTop).toBe('')
    expect(mt(translation)).toBe('8px')
  })

  it('前一个兄弟也是译文（镜像挨着译文）时不配对', () => {
    document.head.innerHTML = ''
    document.body.innerHTML = `<article class="ltx_document"><span class="c">x</span
      ><span class="c ${T_CLASS}">甲</span><span class="c ${T_CLASS}">乙</span></article>`
    expect(alignPairMargins(document)).toBe(0)
  })
})
