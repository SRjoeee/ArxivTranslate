import { describe, expect, it } from 'vitest'
import { boundariesOf, sentencePairs, verifyAlignment } from '@/providers/alignment'

describe('alignment verification (#105)', () => {
  const src = 'One sentence. Two here.'
  const tgt = '第一句。第二句。'
  const good = { source: [14, 9], target: [4, 4] }

  it('accepts an alignment that partitions both texts exactly', () => {
    expect(verifyAlignment(good, src, tgt)).toBe(good)
    expect(good.source.reduce((a, b) => a + b, 0)).toBe(src.length)
    expect(good.target.reduce((a, b) => a + b, 0)).toBe(tgt.length)
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
