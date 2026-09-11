import { describe, expect, it } from 'vitest'
import { PlaceholderIntegrityError, rehydrate, serialize } from '@/core/protector'
import { el, htmlOf, stripIds } from './helpers'

describe('rehydrate', () => {
  it('恒等译文回填后与原文（剥 id）相等', () => {
    const p = el(
      '<p class="ltx_p" id="p1">Let <math class="ltx_Math" id="m1" alttext="x"><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>'
      + ' be <em class="ltx_emph ltx_font_italic" id="e1">bold</em> per <a class="ltx_ref" href="#S2" id="r1"><span class="ltx_text ltx_ref_tag">2</span></a> &lt;&amp;&gt;.</p>',
    )
    const b = serialize(p)
    expect(htmlOf(rehydrate(b.text, b, document))).toBe(stripIds(p.innerHTML))
  })

  it('占位符按译文顺序放置', () => {
    const p = el('<p class="ltx_p"><math class="ltx_Math"><mi>a</mi></math> then <math class="ltx_Math"><mi>b</mi></math></p>')
    const b = serialize(p)
    const html = htmlOf(rehydrate('<x id="2"/> 先于 <x id="1"/>', b, document))
    expect(html).toBe('<math class="ltx_Math"><mi>b</mi></math> 先于 <math class="ltx_Math"><mi>a</mi></math>')
  })

  it('克隆与原节点独立，href 保留、id 剥除', () => {
    const p = el('<p class="ltx_p"><a class="ltx_ref" href="#S2" id="r1">2</a> <em id="e1">x</em></p>')
    const b = serialize(p)
    const frag = rehydrate(b.text.replace('>x<', '>y<'), b, document)
    const a = frag.querySelector('a')!
    expect(a.getAttribute('href')).toBe('#S2')
    expect(a.hasAttribute('id')).toBe(false)
    expect(frag.querySelector('em')?.hasAttribute('id')).toBe(false)
    expect(frag.querySelector('em')?.textContent).toBe('y')
    expect(p.querySelector('em')?.textContent).toBe('x')
    expect(p.querySelector('a')?.getAttribute('id')).toBe('r1')
  })

  it('解码模型输出里的实体', () => {
    const p = el('<p class="ltx_p">a</p>')
    const b = serialize(p)
    expect(htmlOf(rehydrate('&lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &#65;&#x42;&nbsp;e', b, document))).toBe('&lt;b&gt; &amp; "c" \'d\' AB&nbsp;e')
  })

  it('【已知行为，待 A03】序列化之后原节点被换掉，回填放回去的仍是当时那一份（独立审计 B12 / B18-mutate）', () => {
    // 槽位记的是**节点引用**，请求在飞的这段时间里页面把公式换了，回填不会察觉。
    // arXiv 是静态页、自带 JS 不改正文（RESEARCH §3.3），所以今天没有触发路径；
    // 这条把边界钉下来：真要修就是"序列化时留一份源快照、提交前复核"（研究审计的 A03），
    // 那时这条测试的期望要跟着改成"拒绝并标记为陈旧"，而不是悄悄换语义
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be positive.</p>')
    const b = serialize(p)
    const before = p.querySelector('math')!
    // 页面把 x 换成了 y（同一个位置、同一种标签）
    before.replaceWith(el('<math class="ltx_Math"><mi>y</mi></math>'))
    expect(p.querySelector('math')!.textContent).toBe('y')
    const out = htmlOf(rehydrate(b.text, b, document))
    // 回填用的是捕获时的那份，所以译文里是 x，不是页面上现在的 y
    expect(out).toContain('<mi>x</mi>')
    expect(out).not.toContain('<mi>y</mi>')
  })

  it('校验失败抛 PlaceholderIntegrityError', () => {
    const p = el('<p class="ltx_p">a <math class="ltx_Math"><mi>x</mi></math></p>')
    const b = serialize(p)
    expect(() => rehydrate('a', b, document)).toThrow(PlaceholderIntegrityError)
    try {
      rehydrate('a', b, document)
    } catch (e) {
      expect((e as PlaceholderIntegrityError).reason).toBe('missing')
    }
  })
})
