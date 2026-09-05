import { describe, expect, it } from 'vitest'
import { joinRuns, serialize, splitRuns } from '@/core/protector'
import { el, htmlOf, stripIds } from './helpers'

describe('runs 路径', () => {
  const para = () => el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>')

  it('以 void 切段，paired 文字并入所在段', () => {
    const layout = splitRuns(serialize(para()))
    expect(layout.runs).toEqual(['Let ', ' be bold per ', '.'])
    expect(layout.items).toEqual([
      { kind: 'text', run: 0 }, { kind: 'void', id: 1 }, { kind: 'text', run: 1 }, { kind: 'void', id: 3 }, { kind: 'text', run: 2 },
    ])
  })

  it('纯空白段不送翻译，原样保留', () => {
    const b = serialize(el('<p class="ltx_p"><math class="ltx_Math"><mi>a</mi></math> <math class="ltx_Math"><mi>b</mi></math></p>'))
    const layout = splitRuns(b)
    expect(layout.runs).toEqual([])
    expect(layout.items).toEqual([{ kind: 'void', id: 1 }, { kind: 'raw', text: ' ' }, { kind: 'void', id: 2 }])
  })

  it('拼回：恒等时样式丢失但文字齐全，void 位置不变', () => {
    const p = para()
    const b = serialize(p)
    const layout = splitRuns(b)
    const html = htmlOf(joinRuns(layout.runs, layout, b, document))
    expect(html).toBe(stripIds('Let <math class="ltx_Math"><mi>x</mi></math> be bold per <a class="ltx_ref" href="#S2">2</a>.'))
  })

  it('拼回译文，段落里的实体正确', () => {
    const b = serialize(el('<p class="ltx_p">a &lt; b <math class="ltx_Math"><mi>x</mi></math> c</p>'))
    const layout = splitRuns(b)
    expect(layout.runs).toEqual(['a < b ', ' c'])
    expect(htmlOf(joinRuns(['甲 < 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
  })

  it('译文段数不符时抛错', () => {
    const b = serialize(para())
    const layout = splitRuns(b)
    expect(() => joinRuns(['only one'], layout, b, document)).toThrow()
  })
})

describe('降级不能把可点击的内容变成纯文字（issue #44）', () => {
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

  it('普通链接整块保留，href 与文字都在，周围照常翻译', () => {
    const holder = render('<p class="ltx_p">Read <a href="https://example.org">the project</a> now.</p>')
    const link = holder.querySelector('a')
    expect(link).not.toBeNull()
    expect(link?.getAttribute('href')).toBe('https://example.org')
    expect(link?.textContent).toBe('the project')
    expect(holder.textContent).toContain('译[Read ]')
    expect(holder.textContent).toContain('译[ now.]')
  })

  it('链接内部的文字不进 runs：降级路径不翻它，但也不丢它', () => {
    const { layout } = runsOf('<p class="ltx_p">Read <a href="https://example.org">the project</a> now.</p>')
    expect(layout.runs).toEqual(['Read ', ' now.'])
  })

  it('链接里嵌套元素时整棵子树一起保留，不会被内层的结束标记提前收尾', () => {
    const holder = render('<p class="ltx_p">See <a href="/x"><em>this <b>paper</b></em></a> too.</p>')
    expect(holder.querySelector('a em b')?.textContent).toBe('paper')
    expect(holder.textContent).toContain('译[See ]')
    expect(holder.textContent).toContain('译[ too.]')
  })

  it('没有 href 的 <a> 仍按普通 paired 处理：它本来就不可点', () => {
    const { layout } = runsOf('<p class="ltx_p">Read <a name="anchor">the project</a> now.</p>')
    expect(layout.runs).toEqual(['Read the project now.'])
  })

  it('样式标签照旧并入文本（既定取舍：样式可丢，行为不可丢）', () => {
    const holder = render('<p class="ltx_p">We <em>follow</em> it.</p>')
    expect(holder.querySelector('em')).toBeNull()
    expect(holder.textContent).toBe('译[We follow it.]')
  })
})
