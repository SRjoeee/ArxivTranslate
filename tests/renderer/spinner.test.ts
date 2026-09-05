import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_ANIMATED_SPINNERS, SPINNER_CLASS, activeSpinnerAnimations, cancelSpinnerAnimation, cancelSpinnersIn,
  createLightweightSpinner, createSpinnerInside,
} from '@/core/renderer/spinner'

// 圆环照搬 Read Frog：内联样式、WAAPI 旋转、最多 60 个在转（§7.6）。happy-dom 是否有 Element.animate 决定走哪个分支
const canAnimate = typeof HTMLElement.prototype.animate === 'function'

afterEach(() => {
  for (const spinner of Array.from(document.querySelectorAll<HTMLElement>(`.${SPINNER_CLASS}`))) cancelSpinnerAnimation(spinner)
  document.body.innerHTML = ''
})

describe('spinner', () => {
  it('是一个 6px 的行内小环，样式内联且带 !important，站点 CSS 盖不掉', () => {
    const spinner = createLightweightSpinner(document)
    expect(spinner.tagName).toBe('SPAN')
    expect(spinner.className).toBe(SPINNER_CLASS)
    expect(spinner.style.cssText).toContain('width: 6px')
    expect(spinner.style.cssText).toContain('important')
    expect(spinner.style.cssText).toContain('--axt-muted')
    cancelSpinnerAnimation(spinner) // 没挂进文档的圆环 afterEach 够不着，自己收
  })

  it('createSpinnerInside 放在宿主末尾', () => {
    const host = document.createElement('p')
    host.textContent = 'x'
    document.body.append(host)
    const spinner = createSpinnerInside(host)
    expect(host.lastElementChild).toBe(spinner)
    cancelSpinnerAnimation(spinner)
  })

  it(`最多 ${MAX_ANIMATED_SPINNERS} 个在转，超出的是静止环；取消后名额释放`, () => {
    const spinners = Array.from({ length: MAX_ANIMATED_SPINNERS + 1 }, () => createLightweightSpinner(document))
    if (canAnimate) {
      expect(activeSpinnerAnimations()).toBe(MAX_ANIMATED_SPINNERS)
      // 第 61 个没有动画，靠静止的灰弧表示等待
      expect(spinners[MAX_ANIMATED_SPINNERS]!.style.borderTopColor).toContain('--axt-muted')
      cancelSpinnerAnimation(spinners[0]!)
      expect(activeSpinnerAnimations()).toBe(MAX_ANIMATED_SPINNERS - 1)
    } else {
      // 没有 WAAPI（happy-dom）：全部静止，计数不动
      expect(activeSpinnerAnimations()).toBe(0)
      expect(spinners.every(s => s.style.borderTopColor.includes('--axt-muted'))).toBe(true)
    }
    spinners.forEach(cancelSpinnerAnimation)
    expect(activeSpinnerAnimations()).toBe(0)
  })

  it('cancelSpinnersIn：删子树前把里面的圆环（含根自己）全部取消，不抛错', () => {
    const wrap = document.createElement('div')
    document.body.append(wrap)
    createSpinnerInside(wrap)
    createSpinnerInside(wrap)
    expect(() => cancelSpinnersIn(wrap)).not.toThrow()
    expect(activeSpinnerAnimations()).toBe(0)
    const lone = createLightweightSpinner(document)
    expect(() => cancelSpinnersIn(lone)).not.toThrow()
  })
})
