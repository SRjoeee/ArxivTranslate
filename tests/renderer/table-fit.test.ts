import { describe, expect, it } from 'vitest'
import { FIT_ATTR, FIT_SCROLL, T_CLASS, fitTables } from '@/core/renderer'
import { docOf } from './helpers'

/** 一对表格：原表 + 译文克隆（renderTable 的结果形状） */
const pairDoc = (count = 1) => {
  const one = '<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table>'
    + `<table class="ltx_tabular ${T_CLASS}" data-axt-for="T"><tbody><tr><td class="ltx_td">甲</td></tr></tbody></table></figure>`
  return docOf(one.repeat(count))
}
const originals = (doc: Document) => Array.from(doc.querySelectorAll(`.ltx_tabular:not(.${T_CLASS})`))
const fitOf = (el: Element) => el.getAttribute(FIT_ATTR)

/** 一对行间公式：原式 + 镜像（createMirrors 的结果形状） */
const eqnDoc = () => docOf('<div class="ltx_para"><table class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell">x</td><td class="ltx_eqn_cell ltx_eqn_eqno">(1)</td></tr></tbody></table>'
  + `<table class="ltx_equation ltx_eqn_table ${T_CLASS} axt-mirror" data-axt-for="mirror:0"><tbody><tr class="ltx_equation ltx_eqn_row"><td class="ltx_eqn_cell">x</td><td class="ltx_eqn_cell ltx_eqn_eqno">(1)</td></tr></tbody></table></div>`)

describe('fitTables', () => {
  it('行间公式与镜像同表格一样按栏缩放：只标最外层的 table.ltx_eqn_table，组里的 tr.ltx_equation 不单独算', () => {
    const doc = eqnDoc()
    const r = fitTables(doc, { naturalWidth: () => 800, columnWidth: () => 436 })
    expect(r).toEqual({ fitted: 0, scrolled: 1 }) // 436/800 = 0.545 < 0.7 → 滚动
    const [original, mirror] = Array.from(doc.querySelectorAll('table'))
    expect(fitOf(original!)).toBe(FIT_SCROLL)
    expect(fitOf(mirror!)).toBe(FIT_SCROLL)
    expect(doc.querySelector(`tr[${FIT_ATTR}]`)).toBeNull()
    const again = fitTables(doc, { naturalWidth: () => 500, columnWidth: () => 436 })
    expect(again).toEqual({ fitted: 1, scrolled: 0 })
    expect(fitOf(original!)).toBe('85') // 436/500 = 0.872
  })

  it('装得下就不标比例', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { naturalWidth: () => 400, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('装不下就落到能装下的那一档，原表与译文同标', () => {
    const doc = pairDoc()
    // 需要 484/551 = 0.878 → 85 档
    const r = fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    const original = originals(doc)[0]!
    expect(fitOf(original)).toBe('85')
    expect(fitOf(original.nextElementSibling!)).toBe('85')
  })

  it('档位向下取：刚好等于某档时用该档', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 1000, columnWidth: () => 950 })
    expect(fitOf(originals(doc)[0]!)).toBe('95')
  })

  it('缩到 0.7 还装不下就退化为栏内滚动', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { naturalWidth: () => 1200, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 1 })
    expect(fitOf(originals(doc)[0]!)).toBe(FIT_SCROLL)
  })

  it('没有译文的表格不处理', () => {
    const doc = docOf('<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table></figure>')
    const r = fitTables(doc, { naturalWidth: () => 900, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('拿不到布局信息时什么都不做（happy-dom、display:none）', () => {
    const doc = pairDoc()
    expect(fitTables(doc, { naturalWidth: () => 0, columnWidth: () => 0 })).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('重复调用按新宽度重算，窗口变宽后标记被清掉', () => {
    const doc = pairDoc()
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
    fitTables(doc, { naturalWidth: () => 551, columnWidth: () => 700 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('多张表各自算各自的', () => {
    const doc = pairDoc(2)
    const widths = [551, 1200]
    let i = 0
    const r = fitTables(doc, { naturalWidth: () => widths[i++]!, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 1 })
    expect(originals(doc).map(fitOf)).toEqual(['85', FIT_SCROLL])
  })
})

describe('只读量法的松紧规则', () => {
  const column = 468
  const marked = (fit: string | null) => {
    const doc = eqnDoc()
    if (fit) for (const t of Array.from(doc.querySelectorAll('table'))) t.setAttribute(FIT_ATTR, fit)
    return doc
  }
  const original = (doc: Document) => doc.querySelector('table')!

  it('精确值（溢出时的盒宽）可以收紧', () => {
    const doc = marked('90')
    fitTables(doc, { naturalWidth: () => 560, columnWidth: () => column }) // 468/560 = 0.836 → 80
    expect(fitOf(original(doc))).toBe('80')
  })

  it('估算值永远不用来收紧：它量的是"装得下"的状态', () => {
    const doc = marked('90')
    fitTables(doc, { naturalWidth: () => ({ width: 560, exact: false }), columnWidth: () => column })
    expect(fitOf(original(doc))).toBe('90')
  })

  it('估算值放松要留 5% 余量，否则会在两档之间来回跳', () => {
    // 460 × 1.05 = 483 > 468：不能去掉标记
    const stay = marked('95')
    fitTables(stay, { naturalWidth: () => ({ width: 460, exact: false }), columnWidth: () => column })
    expect(fitOf(original(stay))).toBe('95')
    // 440 × 1.05 = 462 ≤ 468：可以去掉
    const loosen = marked('95')
    fitTables(loosen, { naturalWidth: () => ({ width: 440, exact: false }), columnWidth: () => column })
    expect(fitOf(original(loosen))).toBeNull()
    // 从 80 放松：加余量后 500 × 1.05 = 525 → 468/525 = 0.891 → 85，而不是不加余量的 90
    const step = marked('80')
    fitTables(step, { naturalWidth: () => ({ width: 500, exact: false }), columnWidth: () => column })
    expect(fitOf(original(step))).toBe('85')
  })

  it('不再克隆去量：模块里没有探针，量宽度不往文档里插节点', async () => {
    const mod = await import('@/core/renderer/table-fit')
    expect('createFitProbe' in mod).toBe(false)
    const doc = eqnDoc()
    const before = doc.body.childElementCount
    fitTables(doc, { naturalWidth: () => 800, columnWidth: () => column })
    expect(doc.body.childElementCount).toBe(before)
  })
})
