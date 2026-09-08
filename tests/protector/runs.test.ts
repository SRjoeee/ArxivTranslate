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

  it('送出去的段保持线上形态，回来的实体在拼回时解开（issue #111）', () => {
    const b = serialize(el('<p class="ltx_p">a &lt; b <math class="ltx_Math"><mi>x</mi></math> c</p>'))
    const layout = splitRuns(b)
    // 不在这里反转义：google-web 的端点是 translateHtml，会把请求体当 HTML 解析，
    // `a < b` 发过去 `<` 会被当成标签开头
    expect(layout.runs).toEqual(['a &lt; b ', ' c'])
    // 引擎把 < 归一成实体返回：拼回时解开，读者看到的是 <，不是 &lt;
    expect(htmlOf(joinRuns(['甲 &lt; 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
    // 引擎原样返回裸 < 也照样对：解实体是恒等的
    expect(htmlOf(joinRuns(['甲 < 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
  })

  it('恒等往返：原文里字面写着 &amp; 的段落不会被多解一次', () => {
    // splitRuns 反转义、joinRuns 不解的旧写法下，`&amp;` 会在送出去时变成 `&`，
    // 再拼回就成了 `&`——少了一层。收发对称之后这条恒等成立
    const b = serialize(el('<p class="ltx_p">写作 &amp;amp; 时 <math class="ltx_Math"><mi>x</mi></math> 成立</p>'))
    const layout = splitRuns(b)
    expect(htmlOf(joinRuns(layout.runs, layout, b, document)))
      .toBe('写作 &amp;amp; 时 <math class="ltx_Math"><mi>x</mi></math> 成立')
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

describe('runs 路径（markers）', () => {
  // markers 只有 void，成对占位符在序列化时就拍平了，所以切段结果比 tags 少一个槽位
  const para = () => el('<p class="ltx_p">Let <math class="ltx_Math"><mi>x</mi></math> be <em class="ltx_emph">bold</em> per <a class="ltx_ref" href="#S2">2</a>.</p>')

  it('以 void 切段：<em> 已被拍平，链接仍是 void', () => {
    const layout = splitRuns(serialize(para(), 'markers'))
    expect(layout.runs).toEqual(['Let ', ' be bold per ', '.'])
    expect(layout.items).toEqual([
      { kind: 'text', run: 0 }, { kind: 'void', id: 1 }, { kind: 'text', run: 1 }, { kind: 'void', id: 2 }, { kind: 'text', run: 2 },
    ])
  })

  it('切段时还原 @@：转义不该漏进送翻译的文本', () => {
    const b = serialize(el('<p class="ltx_p">a@b.com <math class="ltx_Math"><mi>x</mi></math> @c#</p>'), 'markers')
    expect(b.text).toBe('a@@b.com @a# @@c#')
    const layout = splitRuns(b)
    expect(layout.runs).toEqual(['a@b.com ', ' @c#'])
  })

  it('拼回：文字齐全、void 原样，markers 不解 HTML 实体之外的东西', () => {
    const p = para()
    const b = serialize(p, 'markers')
    const layout = splitRuns(b)
    const html = htmlOf(joinRuns(layout.runs, layout, b, document))
    expect(html).toBe(stripIds('Let <math class="ltx_Math"><mi>x</mi></math> be bold per <a class="ltx_ref" href="#S2">2</a>.'))
  })

  it('拼回译文时实体解回来：markers 也转义 & < >', () => {
    const b = serialize(el('<p class="ltx_p">a &lt; b <math class="ltx_Math"><mi>x</mi></math> c</p>'), 'markers')
    expect(b.text).toBe('a &lt; b @a# c')
    const layout = splitRuns(b)
    // 送出去的段保持线上形态（issue #111）：markers 与 tags 在这一点上一致
    expect(layout.runs).toEqual(['a &lt; b ', ' c'])
    expect(htmlOf(joinRuns(['甲 &lt; 乙 ', ' 丙'], layout, b, document))).toBe('甲 &lt; 乙 <math class="ltx_Math"><mi>x</mi></math> 丙')
  })
})
