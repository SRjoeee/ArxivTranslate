import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extract, markBlocks, type Block } from '@/core/extractor'
import { DEFAULT_PRELOAD, createLazyScheduler } from '@/core/scheduler/lazy'

/** happy-dom 没有 IntersectionObserver：用假的记录 observe / unobserve，测试里手动 emit */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  observed = new Set<Element>()
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) { this.observed.add(el) }
  unobserve(el: Element) { this.observed.delete(el) }
  disconnect() { this.observed.clear() }
  takeRecords() { return [] }
  /** 照真实 entry 的形状给字段：调度器要读 intersectionRatio / rootBounds / boundingClientRect */
  emit(targets: Element[], ratio = 1, rootHeight = 900 + 2 * DEFAULT_PRELOAD.margin) {
    this.callback(targets.map(target => ({
      target,
      isIntersecting: true,
      intersectionRatio: ratio,
      rootBounds: { height: rootHeight } as DOMRectReadOnly,
      boundingClientRect: target.getBoundingClientRect(),
    })) as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

const PAGE = '<article class="ltx_document">'
  + '<p class="ltx_p" id="a">A.</p><p class="ltx_p" id="b">B.</p>'
  + '<p class="ltx_p" id="c">C<span class="ltx_note"><span class="ltx_note_outer"><span class="ltx_note_content" id="n">Note.</span></span></span></p>'
  + '<p class="ltx_p" id="d">D.</p></article>'

/** 给元素一个布局盒：happy-dom 的 getBoundingClientRect 全是 0 */
function layout(el: Element, top: number, height = 20) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON: () => ({}) })
}

function setup(): { blocks: Block[]; entered: Block[][]; io: FakeIntersectionObserver; by: Record<string, Block> } {
  document.body.innerHTML = PAGE
  const blocks = extract(document)
  markBlocks(blocks)
  const by = Object.fromEntries(blocks.map(b => [b.id, b]))
  // a 在首屏，b 在边距内，c / d 在很远处；脚注 n 没有布局盒
  layout(by.a!.el, 100)
  layout(by.b!.el, 900 + 500)
  layout(by.c!.el, 5000)
  layout(by.d!.el, 5100)
  const entered: Block[][] = []
  createLazyScheduler(blocks, { ...DEFAULT_PRELOAD, onEnter: picked => entered.push(picked) })
  return { blocks, entered, io: FakeIntersectionObserver.instances[0]!, by }
}

describe('createLazyScheduler', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    g.IntersectionObserver = FakeIntersectionObserver
    g.innerHeight = 800
  })
  afterEach(() => {
    delete g.IntersectionObserver
    document.body.innerHTML = ''
  })

  it('参数照 Read Frog：rootMargin 取预翻译距离、threshold 取可见阈值', () => {
    const { io } = setup()
    expect(io.options).toEqual({ rootMargin: '1000px 0px', threshold: 0 })
  })

  it('播种：首屏与预翻译距离内的块同步进入、作一批；远处的交给观察器', () => {
    const { entered, io, by } = setup()
    expect(entered).toHaveLength(1)
    expect(entered[0]!.map(b => b.id)).toEqual(['a', 'b'])
    expect(io.observed.has(by.c!.el)).toBe(true)
    expect(io.observed.has(by.d!.el)).toBe(true)
    expect(io.observed.has(by.a!.el)).toBe(false)
  })

  it('进入即 unobserve、一次性；同一次回调里的块攒成一批', () => {
    const { entered, io, by } = setup()
    io.emit([by.c!.el, by.d!.el])
    expect(entered).toHaveLength(2)
    expect(entered[1]!.map(b => b.id)).toEqual(['c', 'n', 'd'])
    expect(io.observed.size).toBe(0)
    io.emit([by.c!.el])
    expect(entered).toHaveLength(2)
  })

  it('没有布局盒的脚注块挂在所在段落上，段落进入时一起进入', () => {
    const { io, by } = setup()
    expect(io.observed.has(by.n!.el)).toBe(false)
    expect(io.observed.has(by.c!.el)).toBe(true)
  })

  it('trigger：手动交出去的块不再等观察器；waiting 随之减少；disconnect 后清空', () => {
    document.body.innerHTML = PAGE
    const blocks = extract(document)
    markBlocks(blocks)
    const entered: Block[][] = []
    const scheduler = createLazyScheduler(blocks, { ...DEFAULT_PRELOAD, onEnter: picked => entered.push(picked) })
    // 全是零布局盒：谁都没播种；p 各自观察自己，脚注挂在 c 上
    expect(entered).toHaveLength(0)
    expect(scheduler.waiting()).toBe(blocks.length)
    scheduler.trigger([blocks[0]!])
    expect(entered[0]!.map(b => b.id)).toEqual(['a'])
    expect(scheduler.waiting()).toBe(blocks.length - 1)
    scheduler.trigger([blocks[0]!])
    expect(entered).toHaveLength(1)
    scheduler.disconnect()
    expect(scheduler.waiting()).toBe(0)
    expect(FakeIntersectionObserver.instances[0]!.observed.size).toBe(0)
  })

  it('没有 IntersectionObserver 的环境：只播种，其余靠 trigger', () => {
    delete g.IntersectionObserver
    document.body.innerHTML = PAGE
    const blocks = extract(document)
    markBlocks(blocks)
    layout(blocks[0]!.el, 10)
    const entered: Block[][] = []
    const scheduler = createLazyScheduler(blocks, { ...DEFAULT_PRELOAD, onEnter: picked => entered.push(picked) })
    expect(entered[0]!.map(b => b.id)).toEqual(['a'])
    scheduler.trigger(blocks)
    expect(scheduler.waiting()).toBe(0)
  })
})

describe('播种与观察器用同一个 threshold（Codex 在 #35 指出）', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => {
    FakeIntersectionObserver.instances = []
    g.IntersectionObserver = FakeIntersectionObserver
    g.innerHeight = 800
  })
  afterEach(() => {
    delete g.IntersectionObserver
    document.body.innerHTML = ''
  })

  /** 造一个块，让它按给定的可见比例卡在边距边界上 */
  function seedWith(threshold: number, visibleRatio: number) {
    document.body.innerHTML = PAGE
    const blocks = extract(document)
    markBlocks(blocks)
    const by = Object.fromEntries(blocks.map(b => [b.id, b]))
    const height = 200
    // 边距下沿是 innerHeight + margin = 800 + 1000 = 1800；让块只露出 visibleRatio 的高度
    const top = 1800 - height * visibleRatio
    layout(by.a!.el, top, height)
    for (const id of ['b', 'c', 'd']) layout(by[id]!.el, 9000)
    const entered: Block[][] = []
    createLazyScheduler(blocks, { margin: 1000, threshold, onEnter: picked => entered.push(picked) })
    const io = FakeIntersectionObserver.instances[0]!
    return { seeded: entered.flat().some(b => b.id === 'a'), observed: io.observed.has(by.a!.el) }
  }

  it('threshold 0：擦到边就播种（默认行为不变）', () => {
    expect(seedWith(0, 0.05)).toEqual({ seeded: true, observed: false })
  })

  it('threshold 0.5：只露出 20% 的块不播种，交给观察器按比例判', () => {
    expect(seedWith(0.5, 0.2)).toEqual({ seeded: false, observed: true })
  })

  it('threshold 0.5：露出 80% 的块照常播种', () => {
    expect(seedWith(0.5, 0.8)).toEqual({ seeded: true, observed: false })
  })
})

describe('可见比例阈值真的起作用（Codex 在 #32 / #36 指出）', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver; g.innerHeight = 900 })
  afterEach(() => { delete g.IntersectionObserver; document.body.innerHTML = '' })

  /** 一个块，高度可控，起始位置在很远处（只能走观察器） */
  function one(height: number, threshold: number) {
    document.body.innerHTML = '<article class="ltx_document"><p class="ltx_p" id="a">A.</p></article>'
    const blocks = extract(document)
    markBlocks(blocks)
    layout(blocks[0]!.el, 5000, height)
    const entered: Block[][] = []
    createLazyScheduler(blocks, { margin: 0, threshold, onEnter: picked => entered.push(picked) })
    return { io: FakeIntersectionObserver.instances[0]!, entered, el: blocks[0]!.el }
  }

  it('比例不够就不翻：threshold 0.5 时露出一成的块不该被触发', () => {
    const { io, entered, el } = one(200, 0.5)
    // 初始通知：isIntersecting 为真（定义是"比例 > 0"），但比例只有 0.1
    io.emit([el], 0.1, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.6, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('比视口还高的块用够得着的阈值：threshold 1 也要能翻，否则那张大表一辈子不翻', () => {
    // 元素 3000 高、root 只有 900：比例封顶在 0.3，要求 1 的话永远不满足
    const { io, entered, el } = one(3000, 1)
    io.emit([el], 0.3, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('够得着的块仍然按原阈值要求：不是所有块都放行', () => {
    const { io, entered, el } = one(300, 1)
    io.emit([el], 0.9, 900)
    expect(entered).toEqual([])
    io.emit([el], 1, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('threshold 0（默认）时行为不变：任何相交都触发', () => {
    const { io, entered, el } = one(200, 0)
    io.emit([el], 0.01, 900)
    expect(entered.flat()).toHaveLength(1)
  })
})

