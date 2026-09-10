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

/**
 * Every wire offset maps to a node offset and back to itself, and the spans tile the text in order.
 * Offsets inside an entity are skipped: `nodeOffsetAt` snaps them to the position after the
 * character the entity encodes, by design, so they do not round-trip.
 */
function roundTrip(spans: WireSpan[], wire: string) {
  const index = indexSpans(spans)
  let last = 0
  for (const s of spans) {
    expect(s.from).toBe(last)
    last = s.to
  }
  expect(last).toBe(wire.length)
  const inEntity = new Set<number>()
  for (const m of wire.matchAll(/&[#\w]+;/g)) for (let i = m.index!; i < m.index! + m[0].length; i++) inEntity.add(i)
  for (let w = 0; w < wire.length; w++) {
    if (inEntity.has(w)) continue
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
    // The span was flattened (its only text is inside the formula) and the formula is the
    // placeholder: nothing comes back bold, and no shell is invented for a label with no text
    expect(f1.querySelectorAll('.ltx_font_bold')).toHaveLength(0)
    expect(f1.querySelector('math')).not.toBeNull()

    const later = markers('<p class="ltx_p">See <span class="ltx_text ltx_font_bold">Note:</span> the start.</p>')
    const f2 = rehydrate('见 注意：起点。', later.block, document)
    expect(f2.querySelector('.ltx_font_bold')).toBeNull()
  })

  it('a label carrying its separator inside is not a label: J. Symbolic Comput.', () => {
    // The translation's first separator would cut it at the abbreviation, italicising `J.` alone
    const journal = markers('<p class="ltx_bibblock"><em class="ltx_emph">J. Symbolic Comput.</em>, 12(3):1–20, 1991.</p>')
    const f1 = rehydrate('J. Symbolic Comput., 12(3):1–20, 1991.', journal.block, document)
    expect(f1.querySelector('em')).toBeNull()
    expect(f1.firstChild?.nodeType).toBe(3)
    // A colon inside a colon label, or in a label followed by one, the same
    const inner = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Step 1: setup:</span> do it.</p>')
    expect(rehydrate('步骤 1：设置：做它。', inner.block, document).querySelector('.ltx_font_bold')).toBeNull()
    const after = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Step 1: setup</span>: do it.</p>')
    expect(rehydrate('步骤 1：设置：做它。', after.block, document).querySelector('.ltx_font_bold')).toBeNull()
    // A period without a space after it is not an abbreviation: v1.2. stays a label
    const version = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">v1.2.</span> Changes.</p>')
    expect(rehydrate('v1.2。变更。', version.block, document).querySelector('.ltx_font_bold')?.textContent).toBe('v1.2。')
  })

  it('the prefix must carry every placeholder of the label', () => {
    // The engine put the separator among the label's formulas: a cut after the first one would
    // italicise a fragment of the statement
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_italic">Let <math><mi>p</mi></math> and <math><mi>q</mi></math> be primes.</span> Then it holds.</p>')
    expect(block.text).toBe('Let @a# and @b# be primes. Then it holds.')
    const f = rehydrate('设@a#。且@b#为素数。那么成立。', block, document)
    expect(f.querySelector('.ltx_font_italic')).toBeNull()
    // With both in front of the separator, the label is restored
    const g = rehydrate('设@a#和@b#为素数。那么成立。', block, document)
    expect(g.querySelector('.ltx_font_italic')?.textContent).toBe('设p和q为素数。')
    expect(g.querySelectorAll('math')).toHaveLength(2)
  })

  it('the placeholders in front of the cut must be the label\'s own, not merely as many', () => {
    // validate() lets the engine reorder placeholders, so a body formula can stand where the label's was
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Let <math><mi>p</mi></math>:</span> then <math><mi>q</mi></math> holds.</p>')
    expect(block.text).toBe('Let @a#: then @b# holds.')
    const swapped = rehydrate('设@b#：那么@a#成立。', block, document)
    expect(swapped.querySelector('.ltx_font_bold')).toBeNull()
    const kept = rehydrate('设@a#：那么@b#成立。', block, document)
    expect(kept.querySelector('.ltx_font_bold')?.textContent).toBe('设p：')
  })

  it('a script that runs longer than English gets a wider bound: Avertissement :', () => {
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Warning:</span> do not.</p>')
    const fr = rehydrate('Avertissement : ne pas.', block, document)
    expect(fr.querySelector('.ltx_font_bold')?.textContent).toBe('Avertissement :')
    // Han still gets the tight bound: a separator that wandered off is left alone
    const far = rehydrate('警告，不要这样做，绝对不要：真的。', block, document)
    expect(far.querySelector('.ltx_font_bold')).toBeNull()
  })

  it('keeps the anchor that coincides with the cut, so the head\'s end still maps to the wire', () => {
    // The separator itself is entity-encoded on the wire: the cut lands right after the entity
    const { block } = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Note &amp; more:</span> body.</p>')
    expect(block.text).toBe('Note &amp; more: body.')
    const t = '注意 &amp; 更多：正文。'
    const f = rehydrate(t, block, document)
    expect(label(f)!.textContent).toBe('注意 & 更多：')
    roundTrip(f.offsets, t)
    // Every text span's end still maps back to its wire end — the split head included, whose last
    // offset sits right after the entity
    const index = indexSpans(f.offsets)
    for (const s of f.offsets) if (s.kind === 'text') expect(wireOffsetAt(index, s.node, s.node.data.length)).toBe(s.to)
  })

  it('measures the label by what goes over the wire, not by a formula\'s hidden annotation', () => {
    const tex = 'x'.repeat(200)
    const { block } = markers(`<p class="ltx_p"><span class="ltx_text ltx_font_italic">Let <math><semantics><mi>p</mi><annotation encoding="application/x-tex">${tex}</annotation></semantics></math> be prime.</span> Then it holds. Or not.</p>`)
    expect(block.text).toBe('Let @a# be prime. Then it holds. Or not.')
    // The engine dropped the label's period: measured through the wire the label is 13 characters
    // and the body's first period is far past the bound; measured with the TeX it would pass
    const f = rehydrate('设@a#为素数 那么这个命题在所有情况下都成立。或者不。', block, document)
    expect(f.querySelector('.ltx_font_italic')).toBeNull()
    // With the period kept, the label is restored, formula included (its textContent carries the
    // hidden annotation too, so the visible parts are checked around it)
    const g = rehydrate('设@a#为素数。那么成立。', block, document)
    const shell = g.querySelector('.ltx_font_italic')!
    expect(shell.querySelector('math')).not.toBeNull()
    expect(shell.textContent?.startsWith('设p')).toBe(true)
    expect(shell.textContent?.endsWith('为素数。')).toBe(true)
    expect(g.textContent?.endsWith('那么成立。')).toBe(true)
  })

  it('a separator of the other kind before the candidate means the engine changed it: left alone', () => {
    const note = markers('<p class="ltx_p"><span class="ltx_text ltx_font_italic">Note.</span> Stop now. Later.</p>')
    expect(rehydrate('注意：停止。后文。', note.block, document).querySelector('.ltx_font_italic')).toBeNull()
    const warn = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Warning:</span> Stop. Why: unsafe.</p>')
    expect(rehydrate('警告 停止。为何：不安全。', warn.block, document).querySelector('.ltx_font_bold')).toBeNull()
    // A colon the label carries itself is expected, not a change of separator
    const step = markers('<p class="ltx_p"><span class="ltx_text ltx_font_bold">Step 3: Conclusion.</span> We are done.</p>')
    expect(rehydrate('第三步：结论。我们完成了。', step.block, document).querySelector('.ltx_font_bold')?.textContent).toBe('第三步：结论。')
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
