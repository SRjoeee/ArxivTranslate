import { afterEach, describe, expect, it, vi } from 'vitest'
import { withViewportAnchor } from '@/core/scheduler/viewport-anchor'

describe('withViewportAnchor（移植自 FluentRead）', () => {
  const originalFromPoint = document.elementFromPoint
  afterEach(() => {
    document.elementFromPoint = originalFromPoint
    vi.restoreAllMocks()
  })

  it('回调让锚元素下移时按偏移滚动，且回调返回值原样透传', () => {
    document.body.innerHTML = '<article class="ltx_document"><p id="anchor">text</p></article>'
    const anchor = document.getElementById('anchor')!
    let top = 100
    anchor.getBoundingClientRect = () => ({ top, left: 0, right: 0, bottom: top + 20, width: 100, height: 20, x: 0, y: top, toJSON() {} }) as DOMRect
    document.elementFromPoint = () => anchor
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    const result = withViewportAnchor(() => {
      top += 40
      return 'done'
    })
    expect(result).toBe('done')
    expect(scrollBy).toHaveBeenCalledWith(0, 40)
  })

  it('找不到锚元素时只执行回调', () => {
    document.elementFromPoint = () => null
    const scrollBy = vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
    expect(withViewportAnchor(() => 42)).toBe(42)
    expect(scrollBy).not.toHaveBeenCalled()
  })
})
