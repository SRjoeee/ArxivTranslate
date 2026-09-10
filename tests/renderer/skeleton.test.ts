import { afterEach, describe, expect, it } from 'vitest'
import {
  MAX_ANIMATED_SKELETONS, SKELETON_CLASS, SKELETON_LINE_CLASS, activeSkeletonAnimations, cancelSkeletonAnimation,
  cancelSkeletonsIn, createSkeleton, createSkeletonInside, skeletonLines,
} from '@/core/renderer/skeleton'

// 骨架屏保留了 Read Frog 圆环的性能做法：WAAPI、最多 60 个在动、句柄可取消（§7.6）。
// happy-dom 是否有 Element.animate 决定走哪个分支
const canAnimate = typeof HTMLElement.prototype.animate === 'function'

afterEach(() => {
  for (const skeleton of Array.from(document.querySelectorAll<HTMLElement>(`.${SKELETON_CLASS}`))) cancelSkeletonAnimation(skeleton)
  document.body.innerHTML = ''
})

describe('skeleton', () => {
  it('是几条按论文字号排的条，条宽写在节点上、其余样式交给 modes.css', () => {
    const skeleton = createSkeleton(document, { chars: 40 })
    expect(skeleton.tagName).toBe('SPAN')
    expect(skeleton.className).toBe(SKELETON_CLASS)
    const lines = skeleton.querySelectorAll(`.${SKELETON_LINE_CLASS}`)
    expect(lines).toHaveLength(1)
    expect((lines[0] as HTMLElement).style.width).toBe('62%')
    cancelSkeletonAnimation(skeleton) // 没挂进文档的 afterEach 够不着，自己收
  })

  it('行数按原文长度估，最后一条短：读起来像一段话，不是一个方块', () => {
    expect(skeletonLines(0)).toBe(1)
    expect(skeletonLines(119)).toBe(1)
    expect(skeletonLines(120)).toBe(2)
    expect(skeletonLines(319)).toBe(2)
    expect(skeletonLines(320)).toBe(3)
    const long = createSkeleton(document, { chars: 900 })
    const widths = Array.from(long.querySelectorAll<HTMLElement>(`.${SKELETON_LINE_CLASS}`), l => l.style.width)
    expect(widths).toEqual(['100%', '100%', '55%'])
    // 末行明显短于整行：这是"像文字"的那一下
    expect(Number.parseInt(widths[2]!, 10)).toBeLessThan(70)
    cancelSkeletonAnimation(long)
  })

  it('同行的短标题（§7.3）只放一条，宽度按字号走', () => {
    const inline = createSkeleton(document, { chars: 900, inline: true })
    expect(inline.hasAttribute('data-axt-inline')).toBe(true)
    const lines = inline.querySelectorAll<HTMLElement>(`.${SKELETON_LINE_CLASS}`)
    expect(lines).toHaveLength(1)
    expect(lines[0]!.style.width).toBe('4.5em')
    cancelSkeletonAnimation(inline)
  })

  it('纯装饰：aria-hidden，等待状态由 popup 的进度承担，不逐块念出来', () => {
    const skeleton = createSkeleton(document)
    expect(skeleton.getAttribute('aria-hidden')).toBe('true')
    cancelSkeletonAnimation(skeleton)
  })

  it('createSkeletonInside 放在宿主末尾', () => {
    const host = document.createElement('p')
    host.textContent = 'x'
    document.body.append(host)
    const skeleton = createSkeletonInside(host)
    expect(host.lastElementChild).toBe(skeleton)
    cancelSkeletonAnimation(skeleton)
  })

  it(`最多 ${MAX_ANIMATED_SKELETONS} 块在呼吸，超出的静止；取消后名额释放`, () => {
    const many = Array.from({ length: MAX_ANIMATED_SKELETONS + 1 }, () => createSkeleton(document))
    if (canAnimate) {
      expect(activeSkeletonAnimations()).toBe(MAX_ANIMATED_SKELETONS)
      // 第 61 块没有动画，静止的骨架屏一样看得出在等
      expect(many[MAX_ANIMATED_SKELETONS]!.getAnimations?.() ?? []).toHaveLength(0)
      cancelSkeletonAnimation(many[0]!)
      expect(activeSkeletonAnimations()).toBe(MAX_ANIMATED_SKELETONS - 1)
    } else {
      // 没有 WAAPI（happy-dom）：全部静止，计数不动
      expect(activeSkeletonAnimations()).toBe(0)
    }
    many.forEach(cancelSkeletonAnimation)
    expect(activeSkeletonAnimations()).toBe(0)
  })

  it('只动 opacity：合成器跑得完，不重排也不重绘（§7.6 的取舍）', () => {
    if (!canAnimate) return
    const skeleton = createSkeleton(document)
    const frames = skeleton.getAnimations?.()[0]
    expect(frames).toBeDefined()
    cancelSkeletonAnimation(skeleton)
  })

  it('cancelSkeletonsIn：删子树前把里面（含根自己）的动画全部取消，不抛错', () => {
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
