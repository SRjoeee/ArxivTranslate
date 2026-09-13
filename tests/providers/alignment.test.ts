import { describe, expect, it } from 'vitest'
import { boundariesOf, sentencePairs, verifyAlignment } from '@/providers/alignment'

describe('alignment verification (#105)', () => {
  const src = 'One sentence. Two here.'
  const tgt = '第一句。第二句。'
  const good = { source: [14, 9], target: [4, 4] }

  it('accepts an alignment that partitions both texts exactly', () => {
    // Equal by value, not the same object: the gate snaps a boundary off by a character or two back to the final punctuation (below),
    // and what comes back may be the corrected copy
    expect(verifyAlignment(good, src, tgt)).toEqual(good)
    expect(good.source.reduce((a, b) => a + b, 0)).toBe(src.length)
    expect(good.target.reduce((a, b) => a + b, 0)).toBe(tgt.length)
  })

  it('nudges a boundary that missed its sentence end by a character', () => {
    // The engine reports the sentence boundaries as it sees them, occasionally off by a character or two: Microsoft on arxiv.org/html/2509.10652v3 reported
    // `…对话式工作流程。这|种新兴的…`, counting the next sentence's first character into the previous one (the owner's report of 2026-09-09, reproduced).
    // The division itself is exact, so no gate downstream can catch it; only the reader sees it
    const source = 'A workflow. This emerging style.'
    const target = '工作流程。这种新兴的风格。'
    expect(verifyAlignment({ source: [12, 20], target: [6, 7] }, source, target)).toEqual({ source: [12, 20], target: [5, 8] })
  })

  it('does not reach across a clause to find a sentence end', () => {
    // The window is only wide enough to cross the punctuation itself, not a phrase. The engine's shifts measured are all a character or two; a wider window
    // would fix not one more boundary, only pull over boundaries that “happen to have a full stop nearby”
    const source = 'A workflow. This emerging style.'
    const target = '工作流程。这种新兴的风格。'
    const given = { source: [12, 20], target: [9, 4] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('leaves a boundary alone when there is no sentence end to snap to', () => {
    // An author list in the references: the “sentence” the engine reports is no sentence at all, there is no final punctuation nearby, and it must be left alone
    const source = 'Smith, Lee, Wong and Chan'
    const target = '史密斯、李、黄和陈'
    const given = { source: [11, 14], target: [4, 5] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('leaves a boundary that already sits after a placeholder alone', () => {
    // A placeholder or whitespace does not count as “not at a sentence end”: a boundary right after them is in the correct position already,
    // and taking it for shifted would move a correct boundary — exactly what this rule must avoid
    const source = 'Done. See it. Next.'
    const target = '完成。<x id="1"/>接着说。'
    const given = { source: [6, 8, 5], target: [3, 11, 4] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('refuses a snap that would leave a sentence with nothing visible in it', () => {
    // Snapping to the final punctuation would leave the last sentence with a closing tag only: that is no “sentence”, better to leave the boundary where it is.
    // Measured: with this guard removed, the same batch grew 3 sentences with no visible text from nowhere
    const source = 'It holds. It is sound.'
    const target = '谓词<x id="2"/>声音。</t>'
    const given = { source: [10, 12], target: [13, 7] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('counts every spelling of a placeholder as filler, not as visible text', () => {
    // The engine may write a placeholder as `<x id='1' />` or `<x id=1></x>`; `validate` takes these for the same placeholder.
    // Recognised by a narrower spelling, those variants count as “visible text” and the “no empty sentence left” guard is bypassed
    // (Codex on #145)
    const source = 'A. B.'
    const target = "甲。<x id='1' />"
    const given = { source: [3, 2], target: [1, target.length - 1] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('does not snap onto the period of an abbreviation or a decimal', () => {
    // `Vol. 2` and `3.5` both end in a full stop; snapping there splits the volume number and the figure apart (Codex on #145).
    // The criterion is whether the full stop is followed by a lowercase letter or a digit — then it is no sentence end
    const source = 'Vol. 2 Publisher. Next.'
    const target = '第一。第二。'
    // The cut falls after `Vol. 2` — not itself at a sentence end, so it **does** look for candidates; the only one in reach is the full stop of `Vol.`,
    // which must be rejected. (Cut after `Vol. ` it would be settled on its own and never reach this check)
    const cut = source.indexOf('2') + 1
    const given = { source: [cut, source.length - cut], target: [3, 3] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('snaps past the whole terminator, not just its first character', () => {
    // `。”` and `...` are one ending. Stopping inside, the remaining half of the punctuation runs off to open the next sentence (Codex on #145)
    const source = 'He spoke. Then more.'
    const target = '他说完了。”接着说。'
    expect(verifyAlignment({ source: [10, 10], target: [4, 6] }, source, target))
      .toEqual({ source: [10, 10], target: [6, 4] })
  })

  it('does not second-guess a boundary that already sits after punctuation', () => {
    // The `…（为什么？）|接着用它` kind: settled on punctuation, so not ours to change. Applying the strict “may it snap over” criterion
    // to “is it right as it is” would split `?)` down the middle instead — it really happened once in the measured corpus
    const source = 'Ask (why?) using it. Next.'
    const target = '第一。第二。'
    const given = { source: [source.indexOf('using'), source.length - source.indexOf('using')], target: [3, 3] }
    expect(verifyAlignment(given, source, target)).toEqual(given)
  })

  it('moves a boundary that stopped inside a terminator to the end of it', () => {
    // The quotation mark in `甲。|”乙` belongs to the previous sentence. The cut already falls after the final punctuation but stops in the middle of a multi-character terminator
    // (Codex on #145: this case never reaches the forward search below)
    expect(verifyAlignment({ source: [3, 2], target: [2, 3] }, 'A. B.', '甲。”乙。'))
      .toEqual({ source: [3, 2], target: [3, 2] })
  })

  it('does not snap onto the period of an acronym before a capitalised word', () => {
    // `U.S. D|epartment`: followed by a capital, so the “not followed by lowercase or a digit” rule sees nothing. Judged by the abbreviation table
    // the sentence splitter was measured with (Codex on #145)
    const source = 'U.S. Department. Next.'
    const cut = source.indexOf('D') + 1
    const given = { source: [cut, source.length - cut], target: [3, 3] }
    expect(verifyAlignment(given, source, '第一。第二。')).toEqual(given)
  })

  it('leaves a sentence-opening placeholder with the sentence it opens', () => {
    // A placeholder sits between the punctuation and the cut, so the next sentence begins with protected content (a formula or the like). Pulling the boundary behind it
    // assigns that formula to the previous sentence, and a pointer landing in the formula would pick the wrong pair (Codex on #145)
    const target = '甲。<x id="1"/>乙。'
    const cut = target.indexOf('乙') + 1
    const given = { source: [3, 2], target: [cut, target.length - cut] }
    expect(verifyAlignment(given, 'A. B.', target)).toEqual(given)
  })

  it('leaves the whole side alone when two boundaries want the same spot', () => {
    // Backing off one by one makes the result depend on iteration order: the earlier one returns to its place after hitting its neighbour, the later one then takes that
    // already-returned value as its neighbour to check, and the cut comes out misaligned as `[1, 2, 4]` — the middle sentence pairs only with `。”` (Codex on #145)
    const given = { source: [3, 3, 2], target: [1, 3, 3] }
    expect(verifyAlignment(given, 'A. B. C.', '甲。”乙。丙。')).toEqual(given)
  })

  it('does not eat a straight quote that opens the next sentence', () => {
    // `"` and `'` both close and open. The quotation mark in `甲。|"乙。"` opens the next sentence; taken for a closer it goes to the previous one
    // (Codex on #145)
    const target = '甲。"乙。"'
    const given = { source: [3, 2], target: [2, target.length - 2] }
    expect(verifyAlignment(given, 'A. B.', target)).toEqual(given)
  })

  it('walks across a repeated terminator, not just closers', () => {
    // `甲…|…乙。` and `甲.|..乙。`: the cut stops in the middle of an ellipsis, and crossing quotation marks and brackets alone cannot get out (Codex on #145)
    expect(verifyAlignment({ source: [3, 2], target: [2, 3] }, 'A. B.', '甲……乙。'))
      .toEqual({ source: [3, 2], target: [3, 2] })
  })

  it('lets an abbreviation that really ends a sentence be snapped to', () => {
    // `etc.` and `al.` can end a sentence; the splitter judges these two by “what follows”. Rejected outright,
    // `Tools, etc. T|he next` could not be repaired (Codex on #145)
    const source = 'Tools, etc. The next topic. Done.'
    const cut = source.indexOf('The') + 1
    expect(verifyAlignment({ source: [cut, source.length - cut], target: [3, 3] }, source, '第一。第二。'))
      .toEqual({ source: [source.indexOf('The'), source.length - source.indexOf('The')], target: [3, 3] })
  })

  it('stops the forward walk before a quote that opens the next sentence', () => {
    // The forward branch used to look at `snappable` only, and `甲。"` was “after final punctuation” in its eyes, so it crossed all the same —
    // removing the straight quote from the terminators does not protect this path (Codex on #145)
    const target = '甲。"乙。"'
    expect(verifyAlignment({ source: [3, 2], target: [1, target.length - 1] }, 'A. B.', target))
      .toEqual({ source: [3, 2], target: [2, target.length - 2] })
  })

  it('reads an opening bracket after et al. as a continuation', () => {
    // `by Smith et al. [|GHSY12]` is one sentence. The splitter's `CONTINUES` admits `[` and `(` specifically for this measured case;
    // missing them here would snap the boundary back behind `al. ` (Codex on #145)
    const source = 'by Smith et al. [GHSY12], which reduces to it. Next.'
    const cut = source.indexOf('[') + 1
    const given = { source: [cut, source.length - cut], target: [3, 3] }
    expect(verifyAlignment(given, source, '第一。第二。')).toEqual(given)
  })

  it('lands at the end of a punctuation run, and stays there on a second pass', () => {
    // **Idempotent**: `verifyAlignment` runs more than once (once in the provider, once in the service layer, once more on a cache hit),
    // and a result landing in the middle of a punctuation run would move one more step next time, the same alignment giving a different highlight depending on the path
    // (Codex on #145)
    const source = 'Wait... and then. Next.'
    const cut = source.indexOf('and') + 1
    const once = verifyAlignment({ source: [cut, source.length - cut], target: [3, 3] }, source, '第一。第二。')!
    expect(once.source[0]).toBe(source.indexOf(' and'))
    expect(verifyAlignment(once, source, '第一。第二。')).toEqual(once)
  })

  it('leaves the side alone when a boundary is equally close to two sentence ends', () => {
    // Equally near on both sides, no evidence for either. And the boundaries are related — leaving one in place while its neighbour moves
    // gives a division worse than the engine's (Codex on #145)
    const given = { source: [3, 2], target: [3, 3] }
    expect(verifyAlignment(given, 'A. B.', '甲。乙。丙。')).toEqual(given)
  })

  it('rejects a source partition that does not add up to the text', () => {
    // The engine reporting boundaries for a string other than the one we sent is the failure this
    // catches — trusting it would put the highlight on the wrong characters.
    expect(verifyAlignment({ source: [14, 8], target: [4, 4] }, src, tgt)).toBeUndefined()
  })

  it('rejects a target partition that does not add up', () => {
    expect(verifyAlignment({ source: [14, 9], target: [4, 5] }, src, tgt)).toBeUndefined()
  })

  it('rejects unequal sentence counts, which have no pairing to offer', () => {
    // The highlight pairs sentence i with sentence i. An engine that merged two source sentences
    // into one target sentence cannot be paired, so the honest answer is no highlight.
    expect(verifyAlignment({ source: [14, 9], target: [8] }, src, tgt)).toBeUndefined()
  })

  it('rejects empty, zero-length and non-integer entries', () => {
    expect(verifyAlignment({ source: [], target: [] }, '', '')).toBeUndefined()
    expect(verifyAlignment({ source: [23, 0], target: [8, 0] }, src, tgt)).toBeUndefined()
    expect(verifyAlignment({ source: [14.5, 8.5], target: [4, 4] }, src, tgt)).toBeUndefined()
  })

  it('rejects nothing at all', () => {
    expect(verifyAlignment(undefined, src, tgt)).toBeUndefined()
  })

  it('expands into per-sentence intervals that tile each text', () => {
    expect(boundariesOf([14, 9])).toEqual([0, 14, 23])
    expect(sentencePairs(good)).toEqual([
      { index: 0, source: { from: 0, to: 14 }, target: { from: 0, to: 4 } },
      { index: 1, source: { from: 14, to: 23 }, target: { from: 4, to: 8 } },
    ])
    expect(src.slice(0, 14)).toBe('One sentence. ')
    expect(tgt.slice(4, 8)).toBe('第二句。')
  })
})
