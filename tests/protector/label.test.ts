// A block's leading label under markers is put back around its translation (DESIGN §6.3, #150).
// On the window's own document: a `DOMParser` document breaks Range offsets in happy-dom.
import { describe, expect, it } from 'vitest'
import { indexSpans, nodeOffsetAt, rangesOf, rehydrate, serialize, spanAt, wireOffsetAt, type WireSpan } from '@/core/protector'

function markers(html: string, format: 'markers' | 'tags' = 'markers') {
  document.body.innerHTML = html
  const root = document.body.firstElementChild!
  return { root, block: serialize(root, format) }
}
const label = (f: DocumentFragment) => f.firstChild as Element | null
const text = (f: DocumentFragment) => Array.from(f.childNodes).map(n => n.textContent).join('')

/** Every wire offset maps to a node offset and back to itself, and the spans tile the text in order. */
function roundTrip(spans: WireSpan[], wire: string) {
  const index = indexSpans(spans)
  let last = 0
  for (const s of spans) {
    expect(s.from).toBe(last)
    last = s.to
  }
  expect(last).toBe(wire.length)
  for (let w = 0; w < wire.length; w++) {
    const s = spanAt(spans, w)!
    if (s.kind !== 'text') continue
    const k = nodeOffsetAt(s, w)
    expect(wireOffsetAt(index, s.node, k)).toBe(w)
  }
}

describe('leading label under markers (#150)', () => {
  it('puts a bold label with its colon back: 关键词：', () => {
    const { block } = markers('<p class="ltx_p"><span id="x" class="ltx_text ltx_font_bold">Keywords:</span> large language models, small.</p>')
    expect(block.text).toBe('Keywords: large language models, small.') // flattened: the bold is gone from the wire
    const t = '关键词：大型语言模型、小型。'
    const f = rehydrate(t, block, document)
    const shell = label(f)!
    expect(shell.nodeType).toBe(1)
    expect(shell.className).toBe('ltx_text ltx_font_bold')
    expect(shell.hasAttribute('id')).toBe(false)
    expect(shell.textContent).toBe('关键词：')
    expect(text(f)).toBe(t)
    // The offsets still describe the text, node split and all
    roundTrip(f.offsets, t)
    expect(rangesOf(f.offsets, 0, 4).map(String).join('')).toBe('关键词：')
    expect(rangesOf(f.offsets, 4, t.length).map(String).join('')).toBe('大型语言模型、小型。')
    expect(rangesOf(f.offsets, 2, 6).map(String).join('')).toBe('词：大型') // a range across the split
  })

  it('a colon outside the label stays outside: <em>MMLU</em>：', () => {
    const { block } = markers('<p class="ltx_p"><em class="ltx_emph">MMLU</em>: a benchmark.</p>')
    const t = 'MMLU：一个基准。'
    const f = rehydrate(t, block, document)
    expect(label(f)!.tagName).toBe('EM')
    expect(label(f)!.textContent).toBe('MMLU')
    expect(text(f)).toBe(t)
    roundTrip(f.offsets, t)
  })

  it('keeps a placeholder that sits inside the label', () => {
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">MMLU<a class="ltx_ref" href="#bib1">[23]</a>:</span> a benchmark.</p>')
    expect(block.text).toBe('MMLU@a#: a benchmark.')
    const t = 'MMLU@a#：一个基准。'
    const f = rehydrate(t, block, document)
    const shell = label(f)!
    expect(shell.className).toBe('ltx_text ltx_font_bold')
    expect(shell.querySelector('a.ltx_ref')?.textContent).toBe('[23]')
    expect(shell.textContent).toBe('MMLU[23]：')
    expect(f.querySelectorAll('a.ltx_ref')).toHaveLength(1)
    roundTrip(f.offsets, t)
  })

  it('a label ending in a period: Note. → 注意。', () => {
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Note.</span> The start is our paper.</p>')
    const t = '注意。起点是我们的论文。'
    const f = rehydrate(t, block, document)
    expect(label(f)!.textContent).toBe('注意。')
    expect(text(f)).toBe(t)
    roundTrip(f.offsets, t)
  })

  it('a block that is nothing but the label is wrapped whole', () => {
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_italic">All of it, in italics</span></p>')
    const t = '全部都是斜体'
    const f = rehydrate(t, block, document)
    expect(label(f)!.className).toBe('ltx_text ltx_font_italic')
    expect(label(f)!.textContent).toBe(t)
    expect(f.childNodes).toHaveLength(1)
    roundTrip(f.offsets, t)
  })

  it('leaves the translation alone when the separator is missing, far, or after a sentence end', () => {
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Note.</span> The start is our paper.</p>')
    for (const t of [
      '注意 起点是我们的论文', // no separator at all
      '注意，起点是我们的论文。', // the first 。 ends the sentence, far past the label
      '注意！起点。', // a terminator before the separator
    ]) {
      const f = rehydrate(t, block, document)
      expect(f.firstChild?.nodeType).toBe(3)
      expect(f.querySelector('.ltx_font_bold')).toBeNull()
      expect(text(f)).toBe(t)
      roundTrip(f.offsets, t)
    }
  })

  it('does nothing for a label that went out as a placeholder, or one that is not first', () => {
    const maths = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold"><math><mi>x</mi></math></span>: a value.</p>')
    expect(maths.block.text).toBe('@a#: a value.')
    const f1 = rehydrate('@a#：一个值。', maths.block, document)
    // The whole span was the placeholder and comes back as itself: one bold, holding the maths, no second shell
    expect(f1.querySelectorAll('.ltx_font_bold')).toHaveLength(1)
    expect(f1.querySelector('.ltx_font_bold math')).not.toBeNull()
    expect(f1.querySelector('.ltx_font_bold')!.textContent).toBe('x')

    const later = markers('<p class="ltx_p">See <span class="ltx_text ltx_font_bold">Note:</span> the start.</p>')
    const f2 = rehydrate('见 注意：起点。', later.block, document)
    expect(f2.querySelector('.ltx_font_bold')).toBeNull()
  })

  it('a label longer than eight words is not a label', () => {
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_italic">For each integer k we have the following bound on the quantity:</span> proof.</p>')
    const f = rehydrate('对于每个整数 k，我们有以下关于该量的界：证明。', block, document)
    expect(f.querySelector('.ltx_font_italic')).toBeNull()
  })

  it('the tags format keeps the label natively and gets no second shell', () => {
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Keywords:</span> large.</p>', 'tags')
    expect(block.text).toBe('<t id="1">Keywords:</t> large.')
    const f = rehydrate('<t id="1">关键词：</t>大型。', block, document)
    expect(f.querySelectorAll('.ltx_font_bold')).toHaveLength(1)
    expect(f.querySelector('.ltx_font_bold')!.textContent).toBe('关键词：')
  })
})
