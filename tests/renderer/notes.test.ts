// 脚注两栏归位（DESIGN §7.2）。译文段落由占位符协议回填，脚注是受保护节点，
// 于是译文里会重建一份**原文**脚注；这里把该脚注的译文复制进去，页面右缘只挂一份边注。
import { describe, expect, it } from 'vitest'
import { T_CLASS, localizeNotes } from '@/core/renderer'
import { docOf } from './helpers'

/** 一段带脚注的正文：原文段落（内含脚注与脚注译文）+ 段落译文（内含回填出来的脚注副本） */
const withNote = (translated = true, zh = '中文脚注') => docOf(`
  <p class="ltx_p">body<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    >${translated ? `<span class="ltx_note_content ${T_CLASS}" data-axt-for="n1"><sup class="ltx_note_mark">1</sup>${zh}</span>` : ''}
    </span></span></p>
  <p class="ltx_p ${T_CLASS}" data-axt-for="p1">正文<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup
    ><span class="ltx_note_outer"><span class="ltx_note_content"><sup class="ltx_note_mark">1</sup>English note</span
    ></span></span></p>`)

const copy = (doc: Document) => doc.querySelector(`.${T_CLASS} .ltx_note_content`)!
const sourceNote = (doc: Document) => doc.querySelector(`.ltx_p:not(.${T_CLASS}) .ltx_note`)!

describe('localizeNotes', () => {
  it('译文复制进副本：一份边注里原文在上、译文在下', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    const box = copy(doc).closest('.ltx_note_outer')!
    expect(box.textContent).toContain('English note')
    expect(box.textContent).toContain('中文脚注')
    expect(box.textContent!.indexOf('English')).toBeLessThan(box.textContent!.indexOf('中文'))
  })

  it('放进去的译文要脱掉脚注框外壳，且不带标号与块标记', () => {
    // .ltx_note_content 带 double 顶边线与缩进，自带的标号还是绝对定位的（实测会飞进正文）
    const doc = withNote()
    localizeNotes(doc)
    const placed = doc.querySelector('.axt-note-t')!
    expect(placed.classList.contains('ltx_note_content')).toBe(false)
    expect(placed.querySelectorAll('.ltx_note_mark, .ltx_tag')).toHaveLength(0)
    expect(placed.getAttributeNames().some(n => n.startsWith('data-axt-'))).toBe(false)
  })

  it('原件那份标上 data-axt-note 由样式整框隐藏；副本那份不标', () => {
    const doc = withNote()
    localizeNotes(doc)
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(true)
    expect(doc.querySelector(`.${T_CLASS} .ltx_note`)!.hasAttribute('data-axt-note')).toBe(false)
  })

  it('是复制不是移动：原件里的译文留在原处，二次翻译时 renderText 才找得到旧译文去替换', () => {
    // 搬走的话，旧副本会随段落译文一起被删，脚注译文就丢了（Codex 在 #26 指出）
    const doc = withNote()
    localizeNotes(doc)
    expect(doc.querySelectorAll(`.ltx_note_content.${T_CLASS}`)).toHaveLength(1)
    expect(sourceNote(doc).querySelector(`.${T_CLASS}`)!.textContent).toContain('中文脚注')
  })

  it('二次翻译：段落译文被整个换掉后，新副本再次归位', () => {
    const doc = withNote()
    localizeNotes(doc)
    // renderText 换掉段落译文：旧的（含已归位副本）删掉，插一个新的、副本又是原文
    const old = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const fresh = old.cloneNode(true) as Element
    fresh.querySelector('.axt-note-t')!.remove()
    old.replaceWith(fresh)
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('中文脚注')
  })

  it('译文内容变了（换目标语言重翻）就换新的，不会一直用旧副本', () => {
    const doc = withNote()
    localizeNotes(doc)
    sourceNote(doc).querySelector(`.${T_CLASS}`)!.append('（修订）')
    expect(localizeNotes(doc)).toBe(1)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
    expect(copy(doc).querySelector('.axt-note-t')!.textContent).toContain('修订')
  })

  it('没跑这一趟也不丢内容：原件里仍是原文 + 译文', () => {
    const doc = withNote()
    const source = doc.querySelector(`.ltx_p:not(.${T_CLASS})`)!
    expect(source.textContent).toContain('English note')
    expect(source.textContent).toContain('中文脚注')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('脚注还没翻到就先不动，等下一轮', () => {
    const doc = withNote(false)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).textContent).toContain('English note')
    expect(sourceNote(doc).hasAttribute('data-axt-note')).toBe(false)
  })

  it('幂等：内容没变第二遍什么都不做', () => {
    const doc = withNote()
    expect(localizeNotes(doc)).toBe(1)
    expect(localizeNotes(doc)).toBe(0)
    expect(copy(doc).querySelectorAll('.axt-note-t')).toHaveLength(1)
  })

  it('数量对不上就整段跳过，宁可留原文也不张冠李戴', () => {
    const doc = withNote()
    const t = doc.querySelector(`.ltx_p.${T_CLASS}`)!
    const extra = doc.createElement('span')
    extra.className = 'ltx_note_content'
    extra.textContent = 'stray'
    t.append(extra)
    expect(localizeNotes(doc)).toBe(0)
  })
})
