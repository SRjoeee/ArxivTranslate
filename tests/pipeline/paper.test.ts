import { describe, expect, it } from 'vitest'
import { paperIdFromUrl } from '@/core/pipeline/paper'

describe('paperIdFromUrl', () => {
  it('从 /html/<id> 取 arXiv id，保留版本号', () => {
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260')).toBe('2410.00260')
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260v2#axt-debug')).toBe('2410.00260v2')
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260?x=1')).toBe('2410.00260')
    expect(paperIdFromUrl('https://arxiv.org/html/2410.00260/')).toBe('2410.00260')
  })

  it('非 html 路径返回 null', () => {
    expect(paperIdFromUrl('https://arxiv.org/abs/2410.00260')).toBeNull()
    expect(paperIdFromUrl('https://arxiv.org/html/')).toBeNull()
    expect(paperIdFromUrl('not a url')).toBeNull()
  })
})
