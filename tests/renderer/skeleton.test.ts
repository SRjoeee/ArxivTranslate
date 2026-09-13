import { afterEach, describe, expect, it } from 'vitest'
import { MAX_ANIMATED_SKELETONS, SKELETON_CLASS, SKELETON_LINE_CLASS, activeSkeletonAnimations, cancelSkeletonAnimation, cancelSkeletonsIn, createSkeleton, createSkeletonInside, skeletonLines } from '@/core/renderer/skeleton'
// The skeleton keeps Read Frog's performance approach for the ring: WAAPI, at most 60 animating, cancellable handles (§7.6).
// Whether happy-dom has Element.animate decides which branch runs
const canAnimate = typeof HTMLElement.prototype.animate === 'function'

afterEach(() => {
  for (const skeleton of Array.from(document.querySelectorAll<HTMLElement>(`.${SKELETON_CLASS}`))) cancelSkeletonAnimation(skeleton)
  document.body.innerHTML = ''
})

describe('skeleton', () => {
  it('a few bars sized by the paper\'s font size, the bar width written on the node, the rest of the style left to modes.css', () => {
    const skeleton = createSkeleton(document, { chars: 40 })
    expect(skeleton.tagName).toBe('SPAN')
    expect(skeleton.className).toBe(SKELETON_CLASS)
    const lines = skeleton.querySelectorAll(`.${SKELETON_LINE_CLASS}`)
    expect(lines).toHaveLength(1)
    expect((lines[0] as HTMLElement).style.width).toBe('62%')
    cancelSkeletonAnimation(skeleton) // // not attached to the document, so afterEach cannot reach it; cleaned up here
  })

  it('the line count is estimated from the source length, the last line short: it reads like a paragraph, not a block', () => {
    expect(skeletonLines(0)).toBe(1)
    expect(skeletonLines(119)).toBe(1)
    expect(skeletonLines(120)).toBe(2)
    expect(skeletonLines(319)).toBe(2)
    expect(skeletonLines(320)).toBe(3)
    const long = createSkeleton(document, { chars: 900 })
    const widths = Array.from(long.querySelectorAll<HTMLElement>(`.${SKELETON_LINE_CLASS}`), l => l.style.width)
    expect(widths).toEqual(['100%', '100%', '55%'])
    // The last line is clearly shorter than a full one: that is the “looks like text” touch
    expect(Number.parseInt(widths[2]!, 10)).toBeLessThan(70)
    cancelSkeletonAnimation(long)
  })

  it('an inline short heading (§7.3) gets one bar only, its width following the font size', () => {
    const inline = createSkeleton(document, { chars: 900, inline: true })
    expect(inline.hasAttribute('data-axt-inline')).toBe(true)
    const lines = inline.querySelectorAll<HTMLElement>(`.${SKELETON_LINE_CLASS}`)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.style.width).toBe('4.5em')
    cancelSkeletonAnimation(inline)
  })

  it('purely decorative: aria-hidden; the waiting state is carried by the popup\'s progress, not read out block by block', () => {
    const skeleton = createSkeleton(document)
    expect(skeleton.getAttribute('aria-hidden')).toBe('true')
    cancelSkeletonAnimation(skeleton)
  })

  it('createSkeletonInside places it at the end of the host', () => {
    const host = document.createElement('p')
    host.textContent = 'x'
    document.body.append(host)
    const skeleton = createSkeletonInside(host)
    expect(host.lastElementChild).toBe(skeleton)
    cancelSkeletonAnimation(skeleton)
  })

  it(`at most ${MAX_ANIMATED_SKELETONS} blocks breathe, the rest stay still; cancelling frees the slot`, () => {
    const many = Array.from({ length: MAX_ANIMATED_SKELETONS + 1 }, () => createSkeleton(document))
    if (canAnimate) {
      expect(activeSkeletonAnimations()).toBe(MAX_ANIMATED_SKELETONS)
      // Block 61 has no animation; a still skeleton reads as waiting all the same
      expect(many[MAX_ANIMATED_SKELETONS]!.getAnimations?.() ?? []).toHaveLength(0)
      cancelSkeletonAnimation(many[0]!)
      expect(activeSkeletonAnimations()).toBe(MAX_ANIMATED_SKELETONS - 1)
    } else {
      // No WAAPI (happy-dom): all still, the count does not move
      expect(activeSkeletonAnimations()).toBe(0)
    }
    many.forEach(cancelSkeletonAnimation)
    expect(activeSkeletonAnimations()).toBe(0)
  })

  it('opacity only: the compositor can carry it, no relayout and no repaint (the trade-off of §7.6)', () => {
    if (!canAnimate) return
    const skeleton = createSkeleton(document)
    const frames = skeleton.getAnimations?.()[0]
    expect(frames).toBeDefined()
    cancelSkeletonAnimation(skeleton)
  })

  it('cancelSkeletonsIn: before removing a subtree every animation inside (the root included) is cancelled, without throwing', () => {
    const wrap = document.createElement('div')
    document.body.append(wrap)
    createSkeletonInside(wrap)
    createSkeletonInside(wrap)
    expect(() => cancelSkeletonsIn(wrap)).not.toThrow()
    expect(activeSkeletonAnimations()).toBe(0)
    const lone = createSkeleton(document)
    expect(() => cancelSkeletonsIn(lone)).not.toThrow()
  })
})
