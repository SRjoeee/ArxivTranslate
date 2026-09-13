import { describe, expect, it } from 'vitest'
import { joinRuns, serialize, splitRuns } from '@/core/protector'
import { el, htmlOf, stripIds } from './helpers'

describe('the runs path', () => {
  const para = () => el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>')

  it('split at voids, paired text folded into its run', () => {
    const layout = splitRuns(serialize(para()))
    expect(layout.runs).toEqual(['Let ', ' be bold per ', '.'])
    expect(layout.items).toEqual([
      { kind: 'text', run: 0 }, { kind: 'void', id: 1 }, { kind: 'text', run: 1 }, { kind: 'void', id: 3 }, { kind: 'text', run: 2 },
    ])
  })

  it('whitespace-only runs are not sent for translation and kept as they are', () => {
    const b = serialize(el('<p class="ltx_p"><math class="ltx_Math"><mi>a</mi></math> <math class="ltx_Math"><mi>b</mi></math></p>'))
    const layout = splitRuns(b)
    expect(layout.runs).toEqual([])
    expect(layout.items).toEqual([{ kind: 'void', id: 1 }, { kind: 'raw', text: ' ' }, { kind: 'void', id: 2 }])
  })

  it('joined back: on identity the styling is lost but the text is complete, the voids in place', () => {
    const p = para()
    const b = serialize(p)
    const layout = splitRuns(b)
    const html = htmlOf(joinRuns(layout.runs, layout, b, document))
    expect(html).toBe(stripIds('Let <math class="ltx_Math"><mi>x</mi></math> be bold per <a class="ltx_ref" href="#S2">2</a>.'))
  })

  it('runs go out in their wire form, and entities coming back are decoded when joining (issue #111)', () => {
    const b = serialize(el('<p class="ltx_p">a &lt; b <math class="ltx_Math"><mi>x</mi></math> c</p>'))
    const layout = splitRuns(b)
    // Not unescaped here: google-web's endpoint is translateHtml, which parses the request body as HTML,
    // and the `<` of `a < b` sent would be taken for the start of a tag
    expect(layout.runs).toEqual(['a &lt; b ', ' c'])
    // The engine normalises < to an entity: decoded when joining, the reader sees <, not &lt;
    expect(htmlOf(joinRuns(['甲 &lt; 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
    // An engine returning the bare < is right too: decoding entities is idempotent
    expect(htmlOf(joinRuns(['甲 < 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
  })

  it('identity round trip: a paragraph with a literal &amp; is not decoded one time too many', () => {
    // With the old splitRuns-unescapes / joinRuns-does-not-decode arrangement, `&amp;` became `&` on the way out
    // and `&` when joined back — one level short. With sending and receiving symmetric this identity holds
    const b = serialize(el('<p class="ltx_p">写作 &amp;amp; 时 <math class="ltx_Math"><mi>x</mi></math> 成立</p>'))
    const layout = splitRuns(b)
    expect(htmlOf(joinRuns(layout.runs, layout, b, document)))
      .toBe('写作 &amp;amp; 时 <math class="ltx_Math"><mi>x</mi></math> 成立')
  })

  it('a mismatched run count throws', () => {
    const b = serialize(para())
    const layout = splitRuns(b)
    expect(() => joinRuns(['only one'], layout, b, document)).toThrow()
  })
})

describe('the fallback must not turn clickable content into plain text (issue #44)', () => {
  const runsOf = (html: string) => {
    const node = el(html)
    const block = serialize(node)
    return { block, layout: splitRuns(block), doc: node.ownerDocument }
  }
  const render = (html: string, translate: (r: string) => string = r => `译[${r}]`) => {
    const { block, layout, doc } = runsOf(html)
    const holder = doc.createElement('div')
    holder.append(joinRuns(layout.runs.map(translate), layout, block, doc))
    return holder
  }

  it('an ordinary link is kept whole, href and text both there, the surroundings translated as usual', () => {
    const holder = render('<p class="ltx_p">Read <a href="https://example.org">the project</a> now.</p>')
    const link = holder.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('https://example.org')
    expect(link?.textContent).toBe('the project')
    expect(holder.textContent).toContain('译[Read ]')
    expect(holder.textContent).toContain('译[ now.]')
  })

  it('the text inside a link does not enter the runs: the fallback path does not translate it, but does not lose it either', () => {
    const { layout } = runsOf('<p class="ltx_p">Read <a href="https://example.org">the project</a> now.</p>')
    expect(layout.runs).toEqual(['Read ', ' now.'])
  })

  it('a link with nested elements keeps the whole subtree, not ended early by an inner closing marker', () => {
    const holder = render('<p class="ltx_p">See <a href="/x"><em>this <b>paper</b></em></a> too.</p>')
    expect(holder.querySelector('a em b')?.textContent).toBe('paper')
    expect(holder.textContent).toContain('译[See ]')
    expect(holder.textContent).toContain('译[ too.]')
  })

  it('an <a> without href is still treated as ordinary paired: it was never clickable', () => {
    const { layout } = runsOf('<p class="ltx_p">Read <a name="anchor">the project</a> now.</p>')
    expect(layout.runs).toEqual(['Read the project now.'])
  })

  it('style tags are still folded into the text (the settled trade-off: style may be lost, behaviour may not)', () => {
    const holder = render('<p class="ltx_p">We <em>follow</em> it.</p>')
    expect(holder.querySelector('em')).toBeNull()
    expect(holder.textContent).toBe('译[We follow it.]')
  })
})

describe('the runs path (markers)', () => {
  // markers have voids only, paired placeholders flattened at serialisation, so the split has one slot fewer than tags
  const para = () => el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>')

  it('split at voids: <em> already flattened, the link still a void', () => {
    const layout = splitRuns(serialize(para(), 'markers'))
    expect(layout.runs).toEqual(['Let ', ' be bold per ', '.'])
    expect(layout.items).toEqual([
      { kind: 'text', run: 0 }, { kind: 'void', id: 1 }, { kind: 'text', run: 1 }, { kind: 'void', id: 2 }, { kind: 'text', run: 2 },
    ])
  })

  it('the split restores @@: escaping must not leak into the text sent for translation', () => {
    const b = serialize(el('<p class="ltx_p">a@b.com <math class="ltx_Math"><mi>x</mi></math> @c#</p>'), 'markers')
    expect(b.text).toBe('a@@b.com @a# @@c#')
    const layout = splitRuns(b)
    expect(layout.runs).toEqual(['a@b.com ', ' @c#'])
  })

  it('joined back: the text complete, the voids as they were; markers decode nothing beyond HTML entities', () => {
    const p = para()
    const b = serialize(p, 'markers')
    const layout = splitRuns(b)
    const html = htmlOf(joinRuns(layout.runs, layout, b, document))
    expect(html).toBe(stripIds('Let <math class="ltx_Math"><mi>x</mi></math> be bold per <a class="ltx_ref" href="#S2">2</a>.'))
  })

  it('entities are decoded when joining the translation: markers escape & < > too', () => {
    const b = serialize(el('<p class="ltx_p">a &lt; b <math class="ltx_Math"><mi>x</mi></math> c</p>'), 'markers')
    expect(b.text).toBe('a &lt; b @a# c')
    const layout = splitRuns(b)
    // Runs go out in their wire form (issue #111): markers and tags agree on this
    expect(layout.runs).toEqual(['a &lt; b ', ' c'])
    expect(htmlOf(joinRuns(['甲 &lt; 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
  })
})
