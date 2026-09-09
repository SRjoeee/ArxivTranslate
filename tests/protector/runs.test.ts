import { describe, expect, it } from 'vitest'
import { joinRuns, serialize, splitRuns } from '@/core/protector'
import { el, htmlOf, stripIds } from './helpers'

describe('runs path', () => {
  const para = () => el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>')

  it('splits at void slots and includes paired text in its surrounding run', () => {
    const layout = splitRuns(serialize(para()))
    expect(layout.runs).toEqual(['Let ', ' be bold per ', '.'])
    expect(layout.items).toEqual([
      { kind: 'text', run: 0 }, { kind: 'void', id: 1 }, { kind: 'text', run: 1 }, { kind: 'void', id: 3 }, { kind: 'text', run: 2 },
    ])
  })

  it('preserves whitespace-only runs without translation', () => {
    const b = serialize(el('<p class="ltx_p"><math class="ltx_Math"><mi>a</mi></math> <math class="ltx_Math"><mi>b</mi></math></p>'))
    const layout = splitRuns(b)
    expect(layout.runs).toEqual([])
    expect(layout.items).toEqual([{ kind: 'void', id: 1 }, { kind: 'raw', text: ' ' }, { kind: 'void', id: 2 }])
  })

  it('identity reconstruction loses styling but preserves all text and void positions', () => {
    const p = para()
    const b = serialize(p)
    const layout = splitRuns(b)
    const html = htmlOf(joinRuns(layout.runs, layout, b, document))
    expect(html).toBe(stripIds('Let <math class="ltx_Math"><mi>x</mi></math> be bold per <a class="ltx_ref" href="#S2">2</a>.'))
  })

  it('reconstructs translated runs with correct paragraph entities', () => {
    const b = serialize(el('<p class="ltx_p">a &lt; b <math class="ltx_Math"><mi>x</mi></math> c</p>'))
    const layout = splitRuns(b)
    expect(layout.runs).toEqual(['a < b ', ' c'])
    expect(htmlOf(joinRuns(['甲 < 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
  })

  it('throws on a mismatched translated-run count', () => {
    const b = serialize(para())
    const layout = splitRuns(b)
    expect(() => joinRuns(['only one'], layout, b, document)).toThrow()
  })
})

describe('fallback must not turn clickable content into plain text (issue #44)', () => {
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

  it('preserves whole links including href and text while translating surrounding content', () => {
    const holder = render('<p class="ltx_p">Read <a href="https://example.org">the project</a> now.</p>')
    const link = holder.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('https://example.org')
    expect(link?.textContent).toBe('the project')
    expect(holder.textContent).toContain('译[Read ]')
    expect(holder.textContent).toContain('译[ now.]')
  })

  it('link text stays outside runs: fallback neither translates nor drops it', () => {
    const { layout } = runsOf('<p class="ltx_p">Read <a href="https://example.org">the project</a> now.</p>')
    expect(layout.runs).toEqual(['Read ', ' now.'])
  })

  it('preserves entire nested link subtrees without ending at an inner closing tag', () => {
    const holder = render('<p class="ltx_p">See <a href="/x"><em>this <b>paper</b></em></a> too.</p>')
    expect(holder.querySelector('a em b')?.textContent).toBe('paper')
    expect(holder.textContent).toContain('译[See ]')
    expect(holder.textContent).toContain('译[ too.]')
  })

  it('anchors without href remain ordinary paired slots because they are not clickable', () => {
    const { layout } = runsOf('<p class="ltx_p">Read <a name="anchor">the project</a> now.</p>')
    expect(layout.runs).toEqual(['Read the project now.'])
  })

  it('style tags still merge into text: the accepted tradeoff permits losing styling, never behavior', () => {
    const holder = render('<p class="ltx_p">We <em>follow</em> it.</p>')
    expect(holder.querySelector('em')).toBeNull()
    expect(holder.textContent).toBe('译[We follow it.]')
  })
})
