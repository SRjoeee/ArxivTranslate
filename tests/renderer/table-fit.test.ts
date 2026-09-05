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

describe('fitTables', () => {
  it('装得下就不标比例', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { minContentWidth: () => 400, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('装不下就落到能装下的那一档，原表与译文同标', () => {
    const doc = pairDoc()
    // 需要 484/551 = 0.878 → 85 档
    const r = fitTables(doc, { minContentWidth: () => 551, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 0 })
    const original = originals(doc)[0]!
    expect(fitOf(original)).toBe('85')
    expect(fitOf(original.nextElementSibling!)).toBe('85')
  })

  it('档位向下取：刚好等于某档时用该档', () => {
    const doc = pairDoc()
    fitTables(doc, { minContentWidth: () => 1000, columnWidth: () => 950 })
    expect(fitOf(originals(doc)[0]!)).toBe('95')
  })

  it('缩到 0.7 还装不下就退化为栏内滚动', () => {
    const doc = pairDoc()
    const r = fitTables(doc, { minContentWidth: () => 1200, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 1 })
    expect(fitOf(originals(doc)[0]!)).toBe(FIT_SCROLL)
  })

  it('没有译文的表格不处理', () => {
    const doc = docOf('<figure class="ltx_table"><table class="ltx_tabular"><tbody><tr><td class="ltx_td">a</td></tr></tbody></table></figure>')
    const r = fitTables(doc, { minContentWidth: () => 900, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('拿不到布局信息时什么都不做（happy-dom、display:none）', () => {
    const doc = pairDoc()
    expect(fitTables(doc, { minContentWidth: () => 0, columnWidth: () => 0 })).toEqual({ fitted: 0, scrolled: 0 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('重复调用按新宽度重算，窗口变宽后标记被清掉', () => {
    const doc = pairDoc()
    fitTables(doc, { minContentWidth: () => 551, columnWidth: () => 484 })
    expect(fitOf(originals(doc)[0]!)).toBe('85')
    fitTables(doc, { minContentWidth: () => 551, columnWidth: () => 700 })
    expect(fitOf(originals(doc)[0]!)).toBeNull()
  })

  it('多张表各自算各自的', () => {
    const doc = pairDoc(2)
    const widths = [551, 1200]
    let i = 0
    const r = fitTables(doc, { minContentWidth: () => widths[i++]!, columnWidth: () => 484 })
    expect(r).toEqual({ fitted: 1, scrolled: 1 })
    expect(originals(doc).map(fitOf)).toEqual(['85', FIT_SCROLL])
  })
})

describe('createFitProbe', () => {
  it('剥掉 data-axt-*，并显式 zoom: 1——否则量到的是上一轮缩放后的宽度，窗口停在某些尺寸会不停闪', async () => {
    const { createFitProbe } = await import('@/core/renderer/table-fit')
    const doc = docOf('<table class="ltx_tabular" data-axt-fitOf="85" data-axt-id="T1" id="T1">'
      + '<tbody><tr><td class="ltx_td" data-axt-state="translated">a</td></tr></tbody></table>')
    const table = doc.querySelector('.ltx_tabular')!
    const probe = createFitProbe(table)
    expect(probe.hasAttribute('data-axt-fitOf')).toBe(false)
    expect(probe.hasAttribute('data-axt-id')).toBe(false)
    expect(probe.querySelector('[data-axt-state]')).toBeNull()
    expect(probe.getAttribute('style')).toContain('zoom:1')
    expect(probe.getAttribute('style')).toContain('width:min-content')
    // 原节点不受影响
    expect(table.getAttribute('data-axt-fitOf')).toBe('85')
  })
})
