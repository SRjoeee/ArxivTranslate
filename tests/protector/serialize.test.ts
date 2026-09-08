import { describe, expect, it } from 'vitest'
import { VOID_DENSE_THRESHOLD, serialize } from '@/core/protector'
import { el } from './helpers'

describe('serialize', () => {
  it('void / paired / 文本混合的段落', () => {
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph ltx_font_italic">bold</em> per <a class="ltx_ref" href="#S2">Section 2</a>.</p>')
    const b = serialize(p)
    expect(b.text).toBe('Let <x id="1"/> be <t id="2">bold</t> per <x id="3"/>.')
    expect([...b.paired]).toEqual([2])
    expect(b.voidCount).toBe(2)
    expect(b.slots.get(1)).toBe(p.querySelector('math'))
    expect(b.slots.get(2)).toBe(p.querySelector('em'))
    expect(b.slots.get(3)).toBe(p.querySelector('a'))
  })

  it('paired 可以嵌套', () => {
    const p = el('<p class="ltx_p"><span class="ltx_text ltx_font_bold">A <span class="ltx_text ltx_font_italic">B</span> C</span></p>')
    expect(serialize(p).text).toBe('<t id="1">A <t id="2">B</t> C</t>')
  })

  it('& < > 转义，细空格与 nbsp 原样保留', () => {
    const p = el('<p class="ltx_p">a &lt; b &amp; c <math class="ltx_Math"><mi>x</mi></math> d e &gt; f</p>')
    expect(serialize(p).text).toBe('a &lt; b &amp; c <x id="1"/> d e &gt; f')
  })

  it('嵌套单元与脚注容器作 void，即使它们在 paired 内部', () => {
    const p = el(
      '<p class="ltx_p">Text<span class="ltx_note ltx_role_footnote"><sup class="ltx_note_mark">1</sup>'
      + '<span class="ltx_note_outer"><span class="ltx_note_content">Note.</span></span></span>'
      + ' and <span class="ltx_inline-block"><span class="ltx_p">inner</span></span>.</p>',
    )
    const b = serialize(p)
    expect(b.text).toBe('Text<x id="1"/> and <t id="2"><x id="3"/></t>.')
    expect(b.voidCount).toBe(2)
    expect([...b.paired]).toEqual([2])
  })

  it('没有文本的元素作 void', () => {
    const p = el('<p class="ltx_p">a<span class="ltx_rule"></span>b<img class="ltx_graphics" alt="">c<br>d</p>')
    expect(serialize(p).text).toBe('a<x id="1"/>b<x id="2"/>c<x id="3"/>d')
  })

  it('cite、tag、等宽文本、转换错误都是 void', () => {
    const p = el('<p class="ltx_p"><cite class="ltx_cite">[1]</cite> <span class="ltx_tag">(a)</span> <span class="ltx_text ltx_font_typewriter">x</span> <span class="ltx_ERROR">\\foo</span></p>')
    expect(serialize(p).text).toBe('<x id="1"/> <x id="2"/> <x id="3"/> <x id="4"/>')
  })

  it('不修改 DOM', () => {
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em>b</em>.</p>')
    const before = p.outerHTML
    serialize(p)
    expect(p.outerHTML).toBe(before)
  })

  it('公式密集阈值', () => {
    expect(VOID_DENSE_THRESHOLD).toBe(40)
  })

  it('表格单元格是块内的段：格里的 .ltx_p 走进去当 paired，不作 void（实测 2410.00260 表 1；Codex 在 #5 指出）', () => {
    const td = el('<table><tbody><tr><td class="ltx_td"><span class="ltx_inline-block"><span class="ltx_p">Choices <math class="ltx_Math"><mi>x</mi></math></span></span></td></tr></tbody></table>').querySelector('.ltx_td')!
    const b = serialize(td)
    expect(b.text).toBe('<t id="1"><t id="2">Choices <x id="3"/></t></t>')
    expect([...b.paired]).toEqual([1, 2])
  })

  it('单元格里的嵌套表仍是 void（内层格各自是格），空的 .ltx_p 也是 void', () => {
    const td = el('<table><tbody><tr><td class="ltx_td">Outer<table class="ltx_tabular"><tbody><tr><td class="ltx_td">Alpha</td></tr></tbody></table><span class="ltx_p"></span></td></tr></tbody></table>').querySelector('td')!
    expect(serialize(td).text).toBe('Outer<x id="1"/><x id="2"/>')
  })

  it('原块里已有的译文 / 镜像不是原文：跳过，不占槽位（Codex 在 #8 指出）', () => {
    const li = el('<li class="ltx_item">Lead <p class="ltx_p">inner</p><p class="ltx_p axt-t">译文</p><span class="axt-t axt-mirror">mirror text</span></li>')
    const b = serialize(li)
    expect(b.text).toBe('Lead <x id="1"/>')
    expect(b.slots.size).toBe(1)
  })
})

describe('空白折叠（#119）', () => {
  it('硬换行折成一个空格——微软把每个换行当句号', () => {
    // LaTeXML 的 HTML 带硬换行，12 篇 fixture 的 3847 个正文块里 2373 个（62%）有。
    // 实测同一段：带换行时 srcSentLen 切成 5 句、state explosion 译成「州级爆炸性质」；
    // 折叠后 2 句、「状态爆炸」
    const block = serialize(el('<p class="ltx_p">Automatic verification faces state\nexplosion due to\nthe interleavings.</p>'))
    expect(block.text).toBe('Automatic verification faces state explosion due to the interleavings.')
  })

  it('制表符与连续空格一起折', () => {
    expect(serialize(el('<p class="ltx_p">a \t\n  b</p>')).text).toBe('a b')
  })

  it('&nbsp; 一个都不动——它在 LaTeXML 里是禁止折行的排版，HTML 也不折叠它', () => {
    // JS 的 \s 含 U+00A0，用 \s 折叠会把 `W.&nbsp;Arendt` 变成 `W. Arendt`（参考文献块里到处都是）
    const block = serialize(el('<p class="ltx_p">W.\u00a0Arendt,\n  no.\u00a01, see Section\u00a01.1</p>'))
    expect(block.text).toBe('W.\u00a0Arendt, no.\u00a01, see Section\u00a01.1')
    expect(block.text).toContain('\u00a0')
  })

  it('首尾空白保留，不 trim——相邻行内块靠它分开', () => {
    // `<span>A</span><span>B</span>` 渲染成 AB，`<span>A </span>` 才是 A B。
    // 作者名与联系方式标签就是这种相邻行内块（§5.2），trim 会让相邻译文粘连
    expect(serialize(el('<p class="ltx_p"> a b </p>')).text).toBe(' a b ')
    // 但首尾的**换行**仍然折成空格，不是原样留着
    expect(serialize(el('<p class="ltx_p">\n  a b\n</p>')).text).toBe(' a b ')
  })

  it('折叠不碰占位符的内部结构', () => {
    const block = serialize(el('<p class="ltx_p">see\n<math><mi>x</mi></math>\nand\n<math><mi>y</mi></math></p>'))
    // 不钉 id 编号（那是分配器的事），钉的是折叠没把 `<x id="N"/>` 内部的那个空格也吃掉、
    // 也没把公式两侧的分词空格折没
    expect(block.text).toMatch(/^see <x id="\d+"\/> and <x id="\d+"\/>$/)
    expect(block.slots.size).toBe(2)
  })
})
