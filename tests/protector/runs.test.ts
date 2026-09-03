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
