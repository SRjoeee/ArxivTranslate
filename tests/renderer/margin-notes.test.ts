// 边注在沟槽里依次下排（DESIGN §7.2）。样式表把边注框的高度归零（否则它会撑高网格行），
// 代价是浮动之间不再互相避让；位置因此由 JS 量出来、用 transform 推开。
import { describe, expect, it } from 'vitest'
import { applyMarginNotes, clearMarginNotes, planMarginNotes, stackShifts } from '@/core/renderer'
import { docOf } from './helpers'

const box = (top: number, height: number, ours = true) => ({ top, height, ours })

describe('stackShifts', () => {
  it('互不相碰的就不动', () => {
    expect(stackShifts([box(0, 40), box(100, 40)], 8)).toEqual([0, 0])
  })

  it('压上来的往下推到上一条下面加一个间距', () => {
    // 第一条占 0–40，间距 8：第二条自然落在 20，要推到 48
    expect(stackShifts([box(0, 40), box(20, 30)], 8)).toEqual([0, 28])
  })

  it('推移会传递：一条被推下去，后面的按推完之后的位置让开', () => {
    expect(stackShifts([box(0, 100), box(10, 100), box(20, 10)], 0)).toEqual([0, 90, 180])
  })

  it('原件那份推不动（§7.1 不许给原节点写样式），但后面的要绕开它', () => {
    const shifts = stackShifts([box(0, 50, false), box(10, 20, true)], 0)
    expect(shifts).toEqual([0, 40])
  })

  // Codex 在 #163 指出：底线只能往下走。推不动的原件若自然落得比当前底线还高，
  // 直接赋值会把底线拉回去，下一条副本只躲开了这个原件、又压回前面那条副本上
  it('推不动的原件不会把底线拉回去', () => {
    // 副本一被推到 0–100；原件自然落在 10–30（比底线高得多）；副本二自然落在 20
    const shifts = stackShifts([box(0, 100), box(10, 20, false), box(20, 30)], 0)
    expect(shifts).toEqual([0, 0, 80])
    const tops = shifts.map((v, i) => [box(0, 100), box(10, 20, false), box(20, 30)][i]!.top + v)
    // 副本二落在 100，正好接在副本一（0–100）下面，而不是接在原件（10–30）下面
    expect(tops).toEqual([0, 10, 100])
  })

  it('六条同一行上的短脚注排成一列（2509.10652v3 的形状）', () => {
    const boxes = Array.from({ length: 6 }, (_, i) => box(i * 32, 50))
    const shifts = stackShifts(boxes, 8)
    const tops = shifts.map((s, i) => boxes[i]!.top + s)
    for (let i = 1; i < tops.length; i++) expect(tops[i]! - tops[i - 1]!).toBe(58)
  })
})

/** 一篇有两条边注的文档：第二条压在第一条身上。heights / tops 可以就地改，模拟译文到达或被撤掉 */
function stubbed(heights: [number, number], tops: [number, number]) {
  const doc = docOf(`
    <p class="ltx_p" data-axt-id="p1">body</p>
    <p class="ltx_p axt-t" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
      ><span class="ltx_note_outer" id="o1"><span class="ltx_note_content">Note one.</span></span></span>
      <span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">2</sup
      ><span class="ltx_note_outer" id="o2"><span class="ltx_note_content">Note two.</span></span></span></p>`)
  const contents = Array.from(doc.querySelectorAll('.ltx_note_content')) as HTMLElement[]
  contents.forEach((content, i) => {
    content.getBoundingClientRect = () => {
      const outer = content.closest('.ltx_note_outer') as HTMLElement
      // 已经写下去的位移要体现在量到的位置上，跟真实浏览器一样
      const shift = /translateY\((-?\d+)px\)/.exec(outer.style.transform)?.[1]
      const top = tops[i]! + (shift ? Number(shift) : 0)
      const height = heights[i]!
      return { top, bottom: top + height, height, width: 192, left: 0, right: 192, x: 0, y: top, toJSON: () => ({}) } as DOMRect
    }
  })
  return doc
}

describe('planMarginNotes / applyMarginNotes', () => {
  it('压在一起的两条：第二条被推到第一条下面，原文一个节点都没动', () => {
    const doc = stubbed([100, 60], [0, 20])
    const before = doc.querySelector('.ltx_p:not(.axt-t)')!.outerHTML
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(doc.querySelector('#o1')!.getAttribute('style')).toBeNull()
    // 100 高 + 2rem 间距（happy-dom 的根字号是 16px）→ 第二条要从 20 推到 132
    expect((doc.querySelector('#o2') as HTMLElement).style.transform).toBe('translateY(112px)')
    expect(doc.querySelector('.ltx_p:not(.axt-t)')!.outerHTML).toBe(before)
  })

  it('幂等：位置没变第二趟一个都不写', () => {
    const doc = stubbed([100, 60], [0, 20])
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(0)
  })

  it('第一条变矮了就把位移收回去，不会一直欠着上一轮的账', () => {
    const heights: [number, number] = [100, 60]
    const doc = stubbed(heights, [0, 200])
    applyMarginNotes(planMarginNotes(doc))
    const second = doc.querySelector('#o2') as HTMLElement
    // 100 高 + 32 间距 = 132 < 200：一开始就不用让
    expect(second.style.transform).toBe('')
    // 第一条的译文到了，它长到 300 高：第二条要让到 332
    heights[0] = 300
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(second.style.transform).toBe('translateY(132px)')
    // 重翻失败、译文被撤掉，第一条又矮回去：位移跟着收回
    heights[0] = 100
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(1)
    expect(second.style.transform).toBe('')
  })

  it('量不到盒子（折叠的边注、没有布局的环境）就什么都不写', () => {
    const doc = docOf(`
      <p class="ltx_p axt-t" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
        ><span class="ltx_note_outer" id="o1"><span class="ltx_note_content">Note.</span></span></span></p>`)
    expect(applyMarginNotes(planMarginNotes(doc))).toBe(0)
    expect(doc.querySelector('#o1')!.getAttribute('style')).toBeNull()
  })

  it('clearMarginNotes 擦掉写下去的位移', () => {
    const doc = stubbed([100, 60], [0, 20])
    applyMarginNotes(planMarginNotes(doc))
    clearMarginNotes(doc)
    expect((doc.querySelector('#o2') as HTMLElement).style.transform).toBe('')
  })
})
