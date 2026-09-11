// 内联 TikZ 图的标签（DESIGN §15.6）：文字是 foreignObject 里的 HTML，几何是它自己的矩形
import { describe, expect, it } from 'vitest'
import { foreignLinesOf, pictureTexts } from '@/core/svg'
import { docOf } from '../renderer/helpers'

/** LaTeXML 画 TikZ 节点的形状：foreignObject 里两层 span，文字在最里面 */
const node = (inner: string) =>
  `<foreignObject width="140" height="14" transform="matrix(1 0 0 -1 0 10)"><span class="ltx_foreignobject_container"><span class="ltx_foreignobject_content">${inner}</span></span></foreignObject>`

/** 一个行内 TikZ 图；每个标签的矩形按 rects 里的顺序打桩（happy-dom 没有布局） */
function pictureOf(inners: string[], rects: Array<[number, number, number, number]>, rows: number[] = []) {
  const doc = docOf(`<figure class="ltx_figure"><span class="ltx_inline-block"><svg id="pic" class="ltx_picture" width="400" height="200" viewBox="0 0 400 200">${inners.map(node).join('')}</svg></span></figure>`)
  const picture = doc.getElementById('pic')!
  const rect = (x: number, y: number, w: number, h: number) => ({ left: x, top: y, right: x + w, bottom: y + h, width: w, height: h, x, y, toJSON: () => ({}) }) as DOMRect
  picture.getBoundingClientRect = () => rect(100, 50, 400, 200)
  const labels = Array.from(doc.querySelectorAll('.ltx_foreignobject_content')) as HTMLElement[]
  labels.forEach((label, i) => {
    const r = rects[i]
    label.getBoundingClientRect = () => (r ? rect(...r) : rect(0, 0, 0, 0))
    label.getClientRects = () => Array.from({ length: rows[i] ?? 1 }, () => rect(...(r ?? [0, 0, 0, 0]))) as unknown as DOMRectList
  })
  return picture
}

describe('foreignLinesOf', () => {
  it('读出标签的文字与它在图里的位置（归一化到图的盒子）', () => {
    const picture = pictureOf(['(a) Imbalanced routing'], [[140, 70, 80, 20]])
    const [line] = foreignLinesOf(picture)
    expect(line!.text).toBe('(a) Imbalanced routing')
    expect(line!.conf).toBe(1)
    // 图 100,50 起 400×200；标签 140,70 起 80×20 → 左上 (0.1, 0.1)、右下 (0.3, 0.2)
    expect(line!.quad).toEqual([[0.1, 0.1], [0.3, 0.1], [0.3, 0.2], [0.1, 0.2]])
  })

  it('公式照样送过去，因为白框会把它一起盖住', () => {
    // `Block n−1`：词加符号。只送 `Block` 的话，画出来的「区块」会把 n−1 盖掉
    const math = '<math class="ltx_Math"><semantics><mrow>n−1</mrow><annotation encoding="application/x-tex">n-1</annotation></semantics></math>'
    const picture = pictureOf([`Block ${math}`], [[140, 70, 80, 20]])
    expect(foreignLinesOf(picture)[0]!.text).toBe('Block n−1')
  })

  it('纯公式的节点一个字都不送：softmax 是词，也是符号', () => {
    const math = (tex: string) => `<math class="ltx_Math"><semantics><mrow>${tex}</mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`
    const picture = pictureOf([math('softmax'), math('E1'), 'Router'], [[140, 70, 80, 20], [140, 100, 20, 20], [200, 130, 40, 20]])
    expect(foreignLinesOf(picture).map(l => l.text)).toEqual(['Router'])
  })

  it('同一个位置画两遍的节点只算一次（2607.24653v2 的架构图有四个 Stable LatentMoE）', () => {
    const picture = pictureOf(['Stable LatentMoE', 'Stable LatentMoE'], [[140, 70, 80, 20], [140, 70, 80, 20]])
    expect(foreignLinesOf(picture)).toHaveLength(1)
  })

  it('折行的标签带上行数，字号才不会按一行去算', () => {
    const picture = pictureOf(['A rather long node label that wraps'], [[140, 70, 80, 40]], [2])
    expect(foreignLinesOf(picture)[0]!.rows).toBe(2)
  })

  it('量不到盒子就什么都不返回（图还没排版、或在隐藏的原件里）', () => {
    const picture = pictureOf(['Router'], [[0, 0, 0, 0]])
    expect(foreignLinesOf(picture)).toEqual([])
  })
})

describe('pictureTexts', () => {
  it('不读几何，只回答这张图里有没有词——整篇每张图都要问一遍', () => {
    const picture = pictureOf(['Router', '(a)'], [[0, 0, 0, 0], [0, 0, 0, 0]])
    expect(pictureTexts(picture)).toEqual(['Router'])
  })
})
