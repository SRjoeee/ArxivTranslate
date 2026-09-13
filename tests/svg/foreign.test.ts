// The labels of inline TikZ pictures (DESIGN §15.6): the text is HTML inside a foreignObject, the geometry its own rectangle
import { describe, expect, it } from 'vitest'
import { foreignLinesOf, pictureTexts } from '@/core/svg'
import { docOf } from '../renderer/helpers'

/** The shape LaTeXML draws a TikZ node in: two spans inside a foreignObject, the text innermost */
const node = (inner: string) =>
  `<foreignObject width="140" height="14" transform="matrix(1 0 0 -1 0 10)"><span class="ltx_foreignobject_container"><span class="ltx_foreignobject_content">${inner}</span></span></foreignObject>`

/** An inline TikZ picture; each label's rectangle is stubbed in the order of rects (happy-dom has no layout) */
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
  it('reads a label\'s text and its position in the picture (normalised to the picture\'s box)', () => {
    const picture = pictureOf(['(a) Imbalanced routing'], [[140, 70, 80, 20]])
    const [line] = foreignLinesOf(picture)
    expect(line!.text).toBe('(a) Imbalanced routing')
    expect(line!.conf).toBe(1)
    // The picture 400×200 from 100,50; the label 80×20 from 140,70 → top-left (0.1, 0.1), bottom-right (0.3, 0.2)
    expect(line!.quad).toEqual([[0.1, 0.1], [0.3, 0.1], [0.3, 0.2], [0.1, 0.2]])
  })

  it('a formula is sent along, because the white box covers it too', () => {
    // `Block n−1`: a word plus a symbol. Sent as `Block` alone, the drawn 「区块」 would cover the n−1
    const math = '<math class="ltx_Math"><semantics><mrow>n−1</mrow><annotation encoding="application/x-tex">n-1</annotation></semantics></math>'
    const picture = pictureOf([`Block ${math}`], [[140, 70, 80, 20]])
    expect(foreignLinesOf(picture)[0]!.text).toBe('Block n−1')
  })

  it('a formula-only node sends not one character: softmax is a word and a symbol too', () => {
    const math = (tex: string) => `<math class="ltx_Math"><semantics><mrow>${tex}</mrow><annotation encoding="application/x-tex">${tex}</annotation></semantics></math>`
    const picture = pictureOf([math('softmax'), math('E1'), 'Router'], [[140, 70, 80, 20], [140, 100, 20, 20], [200, 130, 40, 20]])
    expect(foreignLinesOf(picture).map(l => l.text)).toEqual(['Router'])
  })

  it('a node drawn twice in the same position counts once (the architecture diagram of 2607.24653v2 has four Stable LatentMoE)', () => {
    const picture = pictureOf(['Stable LatentMoE', 'Stable LatentMoE'], [[140, 70, 80, 20], [140, 70, 80, 20]])
    expect(foreignLinesOf(picture)).toHaveLength(1)
  })

  it('a wrapped label carries its line count, so the font size is not computed as for one line', () => {
    const picture = pictureOf(['A rather long node label that wraps'], [[140, 70, 80, 40]], [2])
    expect(foreignLinesOf(picture)[0]!.rows).toBe(2)
  })

  // Codex on #163: an identifier need not be <math> either; LaTeXML marks it .ltx_markedasmath.
  // Measured on the corpus: exactly one of the 507 labels inside figures (initMT of 2609.00246); past the word check it would be translated and covered by a white box
  it('an identifier marked as math is no word: initMT is not sent (2609.00246)', () => {
    const marked = (id: string) => `<span class="ltx_text ltx_markedasmath ltx_font_sansserif">${id}</span>`
    const picture = pictureOf([marked('initMT'), `start ${marked('initMT')}`, 'Router'], [[140, 70, 80, 20], [140, 100, 80, 20], [200, 130, 40, 20]])
    // One sandwiched between words is still sent whole (the white box covers the identifier too; sending start alone would blank it out)
    expect(foreignLinesOf(picture).map(l => l.text)).toEqual(['start initMT', 'Router'])
  })

  it('with no box to measure nothing is returned (the picture not laid out yet, or inside a hidden original)', () => {
    const picture = pictureOf(['Router'], [[0, 0, 0, 0]])
    expect(foreignLinesOf(picture)).toEqual([])
  })
})

describe('pictureTexts', () => {
  it('reads no geometry, only answers whether this picture has words — asked once for every picture of the paper', () => {
    const picture = pictureOf(['Router', '(a)'], [[0, 0, 0, 0], [0, 0, 0, 0]])
    expect(pictureTexts(picture)).toEqual(['Router'])
  })

  it('a picture holding only identifiers marked as math does not enter image translation at all', () => {
    const picture = pictureOf(['<span class="ltx_text ltx_markedasmath">initMT</span>'], [[0, 0, 0, 0]])
    expect(pictureTexts(picture)).toEqual([])
  })
})
