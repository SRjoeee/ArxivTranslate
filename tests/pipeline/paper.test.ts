import { describe, expect, it } from 'vitest'
import { paperIdFromUrl } from '@/core/pipeline/paper'

describe('paperIdFromUrl', () => {
  it('takes the arXiv id from /html/<id>, keeping the version', () => {
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260')).toBe('2410.00260')
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260v2#axt-debug')).toBe('2410.00260v2')
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260?x=1')).toBe('2410.00260')
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260/')).toBe('2410.00260')
  })

  it('a non-html path returns null', () => {
    expect(paperIdFromUrl('https://arxiv.org/abs/2410.00260')).toBeNull()
    expect(paperIdFromUrl('https://arxiv.org/html/')).toBeNull()
    expect(paperIdFromUrl('not a url')).toBeNull()
  })

  it('old-style ids (archive/YYMMNNN, possibly with subject and version): arXiv has generated HTML for old papers (measured: /html/hep-th/9901001; Codex on #9)', () => {
    expect(paperIdFromUrl('https://arxiv.org/html/hep-th/9901001')).toBe('hep-th/9901001')
    expect(paperIdFromUrl('https://arxiv.org/html/math.GT/0601001v2')).toBe('math.GT/0601001v2')
    expect(paperIdFromUrl('https://arxiv.org/html/cond-mat.mes-hall/0601001/')).toBe('cond-mat.mes-hall/0601001')
    expect(paperIdFromUrl('https://arxiv.org/html/hep-th/99010')).toBeNull()
  })
})
