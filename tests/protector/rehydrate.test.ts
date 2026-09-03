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
