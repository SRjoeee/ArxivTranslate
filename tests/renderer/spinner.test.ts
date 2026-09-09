import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_ANIMATED_SPINNERS, SPINNER_CLASS, activeSpinnerAnimations, cancelSpinnerAnimation, cancelSpinnersIn,
  createLightweightSpinner, createSpinnerInside,
} from '@/core/renderer/spinner'

// Read Frog spinners: inline styles, WAAPI rotation, and at most 60 animated spinners (§7.6). Element.animate availability selects the branch.
const canAnimate = typeof HTMLElement.prototype.animate === 'function'

afterEach(() => {
  for (const spinner of Array.from(document.querySelectorAll<HTMLElement>(`.${SPINNER_CLASS}`))) cancelSpinnerAnimation(spinner)
  document.body.innerHTML = ''
})

describe('spinner', () => {
  it('a 6px inline spinner uses important inline styles that site CSS cannot override', () => {
    const spinner = createLightweightSpinner(document)
    expect(spinner.tagName).toBe('SPAN')
    expect(spinner.className).toBe(SPINNER_CLASS)
    expect(spinner.style.cssText).toContain('width: 6px')
    expect(spinner.style.cssText).toContain('important')
    expect(spinner.style.cssText).toContain('--axt-muted')
    cancelSpinnerAnimation(spinner) // afterEach cannot reach detached spinners; clean them up explicitly.
  })

  it('createSpinnerInside appends to the host', () => {
    const host = document.createElement('p')
    host.textContent = 'x'
    document.body.append(host)
    const spinner = createSpinnerInside(host)
    expect(host.lastElementChild).toBe(spinner)
    cancelSpinnerAnimation(spinner)
  })

  it(`animates at most ${MAX_ANIMATED_SPINNERS} spinners; excess spinners stay static and cancellation releases slots`, () => {
    const spinners = Array.from({ length: MAX_ANIMATED_SPINNERS + 1 }, () => createLightweightSpinner(document))
    if (canAnimate) {
      expect(activeSpinnerAnimations()).toBe(MAX_ANIMATED_SPINNERS)
      // the 61st spinner has no animation and shows a static gray waiting arc
      expect(spinners[MAX_ANIMATED_SPINNERS]!.style.borderTopColor).toContain('--axt-muted')
      cancelSpinnerAnimation(spinners[0]!)
      expect(activeSpinnerAnimations()).toBe(MAX_ANIMATED_SPINNERS - 1)
    } else {
      // without WAAPI in happy-dom, all spinners remain static and the count does not change
      expect(activeSpinnerAnimations()).toBe(0)
      expect(spinners.every(s => s.style.borderTopColor.includes('--axt-muted'))).toBe(true)
    }
    spinners.forEach(cancelSpinnerAnimation)
    expect(activeSpinnerAnimations()).toBe(0)
  })

  it('cancelSpinnersIn cancels every spinner in a subtree including its root before removal, without throwing', () => {
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
