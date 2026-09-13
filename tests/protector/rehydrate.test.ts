import { describe, expect, it } from 'vitest'
import { PlaceholderIntegrityError, rehydrate, serialize } from '@/core/protector'
import { el, htmlOf, stripIds } from './helpers'

describe('rehydrate', () => {
  it('an identity translation rehydrates equal to the original (ids stripped)', () => {
    const p = el(
      '<p class="ltx_p" id="p1">Let <math class="ltx_Math" id="m1" alttext="x"><semantics><mi>x</mi><annotation encoding="application/x-tex">x</annotation></semantics></math>'
      + ' be <em class="ltx_emph ltx_font_italic" id="e1">bold</em> per <a class="ltx_ref" href="#S2" id="r1"><span class="ltx_text ltx_ref_tag">2</span></a> &lt;&amp;&gt;.</p>',
    )
    const b = serialize(p)
    expect(htmlOf(rehydrate(b.text, b, document))).toBe(stripIds(p.innerHTML))
  })

  it('placeholders are placed in the translation\'s order', () => {
    const p = el('<p class="ltx_p"><math class="ltx_Math"><mi>a</mi></math> then <math class="ltx_Math"><mi>b</mi></math></p>')
    const b = serialize(p)
    const html = htmlOf(rehydrate('<x id="2"/> 先于 <x id="1"/>', b, document))
    expect(html).toBe('<math class="ltx_Math"><mi>b</mi></math> 先于 <math class="ltx_Math"><mi>a</mi></math>')
  })

  it('the clone is independent of the original node, href kept, id stripped', () => {
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

  it('decodes entities in the model output', () => {
    const p = el('<p class="ltx_p">a</p>')
    const b = serialize(p)
    expect(htmlOf(rehydrate('&lt;b&gt; &amp; &quot;c&quot; &#39;d&#39; &#65;&#x42;&nbsp;e', b, document))).toBe('&lt;b&gt; &amp; "c" \'d\' AB&nbsp;e')
  })

  it('[known behaviour, pending A03] a node replaced after serialisation: rehydration puts back the copy captured then (independent audit B12 / B18-mutate)', () => {
    // The slots record **node references**; if the page swaps the formula while the request is in flight, rehydration does not notice.
    // arXiv is a static page and its own JS does not change the body (RESEARCH §3.3), so there is no trigger path today;
    // this pins the boundary down: the real fix would be “keep a source snapshot at serialisation, re-check before committing” (A03 of the research audit),
    // and then this test's expectation changes to “refuse and mark stale”, not a silent change of semantics
    const p = el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be positive.</p>')
    const b = serialize(p)
    const before = p.querySelector('math')!
    // The page swapped x for y (same position, same tag)
    before.replaceWith(el('<math class="ltx_Math"><mi>y</mi></math>'))
    expect(p.querySelector('math')!.textContent).toBe('y')
    const out = htmlOf(rehydrate(b.text, b, document))
    // Rehydration uses the copy captured then, so the translation shows x, not the y now on the page
    expect(out).toContain('<mi>x</mi>')
    expect(out).not.toContain('<mi>y</mi>')
  })

  it('a validation failure throws PlaceholderIntegrityError', () => {
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
