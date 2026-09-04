// 脚注两栏归位（DESIGN §7.2）。译文段落由占位符协议回填，脚注是受保护节点，
// 于是译文里会重建一份**原文**脚注；这里把它换成该脚注的译文，两栏才各自完整。
import { describe, expect, it } from 'vitest'
import { T_CLASS, localizeNotes } from '@/core/renderer'
import { docOf } from './helpers'

/** 一段带脚注的正文：原文段落（内含脚注与脚注译文）+ 段落译文（内含回填出来的脚注副本） */
const withNote = (translated = true) => docOf(`
  <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    >${translated ? `<span class="ltx_note_content ${T_CLASS}" data-axt-for="n1"><sup class="ltx_note_mark">1</sup>中文脚注</span>` : ''}
    </span></span></p>
  <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    ></span></span></p>`)

const copy = (doc: Document) => doc.querySelector(`.${T_CLASS} .ltx_note_content`)!

describe('localizeNotes', () => {
  it('译文搬进副本：一份边注里原文在上、译文在下', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    const box = copy(doc).closest('.ltx_note_outer')!
    expect(box.textContent).toContain('English note')
    expect(box.textContent).toContain('中文脚注')
    expect(box.textContent!.indexOf('English')).toBeLessThan(box.textContent!.indexOf('中文'))
  })

  it('搬进去的译文要脱掉脚注框外壳，否则框里套框', () => {
    // .ltx_note_content 带 double 顶边线与缩进，自带的标号还是绝对定位的（实测会飞进正文）
    const doc = withNote()
    localizeNotes(doc)
    const moved = doc.querySelector('.axt-note-t')!
    expect(moved.classList.contains('ltx_note_content')).toBe(false)
    expect(moved.querySelectorAll('.ltx_note_mark, .ltx_tag')).toHaveLength(0)
    expect(moved.textContent).toContain('中文脚注')
  })

  it('原件那份标上 data-axt-note，由样式隐藏——页面右缘只留一份', () => {
    const doc = withNote()
    localizeNotes(doc)
    const original = doc.querySelector(`.ltx_p:not(.${T_CLASS}) .ltx_note`)!
    expect(original.getAttribute('data-axt-note')).toBe('moved')
    // 副本那份不带标记，照常显示
    expect(doc.querySelector(`.${T_CLASS} .ltx_note`)!.hasAttribute('data-axt-note')).toBe(false)
  })

  it('是移动不是复制：搬完页面上只有一份译文', () => {
    // 第一版用"复制 + 样式隐藏原件里的译文"，只要这一趟没跑成中文就凭空消失，
    // 切到 stack 又变成三份（用户实测反馈）。移动没有这个耦合
    const doc = withNote()
    localizeNotes(doc)
    const source = doc.querySelector(`.ltx_p:not(.${T_CLASS}) .ltx_note_content:not(.${T_CLASS})`)!
    expect(source.textContent).toContain('English note')
    expect(source.nextElementSibling).toBeNull() // 原件里已经没有译文节点了
    expect(doc.body.textContent!.match(/中文脚注/g)).toHaveLength(1)
  })

  it('没跑这一趟也不丢内容：原件里仍是原文 + 译文', () => {
    const doc = withNote()
    const source = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(source.textContent).toContain('English note')
    expect(source.textContent).toContain('中文脚注')
  })

  it('脚注还没翻到就先不动，等下一轮', () => {
    const doc = withNote(false)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).textContent).toContain('English note')
    expect(doc.querySelector('.ltx_note')!.hasAttribute('data-axt-note')).toBe(false)
  })

  it('自幂等：搬完原件就没有译文节点，第二遍什么都不做', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).textContent).toContain('中文脚注')
  })

  it('数量对不上就整段跳过，宁可留原文也不张冠李戴', () => {
    const doc = withNote()
    // 译文块里多出一个脚注副本（回填错位）
    const t = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const extra = doc.createElement('span')
    extra.className = 'ltx_note_content'
    extra.textContent = 'stray'
    t.append(extra)
    expect(localizeNotes(doc)).toBe(0)
  })
})
