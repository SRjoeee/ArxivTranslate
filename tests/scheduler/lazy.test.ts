import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extract, markBlocks, type Block } from '@/core/extractor'
import { DEFAULT_PRELOAD, THRESHOLD_STEP, createLazyScheduler, observerThresholds, quantizeThreshold } from '@/core/scheduler/lazy'

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

/** 一个块，高度可控，起始位置在很远处（只能走观察器） */
function oneWith(height: number, threshold: number) {
  document.body.innerHTML = '<article class="ltx_document"><p class="ltx_p" id="a">A.</p></article>'
  const blocks = extract(document)
  markBlocks(blocks)
  layout(blocks[0]!.el, 5000, height)
  const entered: Block[][] = []
  createLazyScheduler(blocks, { margin: 0, threshold, onEnter: picked => entered.push(picked) })
  return { io: FakeIntersectionObserver.instances[0]!, entered, el: blocks[0]!.el }
}

describe('可见比例阈值真的起作用（Codex 在 #32 / #36 指出）', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver; g.innerHeight = 900 })
  afterEach(() => { delete g.IntersectionObserver; document.body.innerHTML = '' })

  const one = oneWith

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

describe('注册给观察器的比例点要覆盖钳过的阈值（Codex 在 #76 指出）', () => {
  // 观察器**只在跨越注册值时**回调。只注册 [0, threshold] 的话，一个比例上限低于 threshold 的
  // 超大块跨过 0 之后就再没有通知，钳到上限的判定永远等不到能通过的那一次。
  // Chromium 实测（3000 px 元素 / 900 px root / threshold 1）：注册 [0,1] 全程一次回调、ratio 0.267；
  // 换成 5% 细网格后拿到了 ratio 0.3。tests/e2e/layout.mjs 里有一条守着真实浏览器的那一面
  it('threshold 为 0（默认）时仍是单个 0：任何相交都算进入', () => {
    expect(observerThresholds(0)).toBe(0)
  })

  it('threshold 大于 0 时是 5% 一档的细网格，含 0 与 1', () => {
    const t = observerThresholds(0.5) as number[]
    expect(Array.isArray(t)).toBe(true)
    expect(t).toHaveLength(21)
    expect(t[0]).toBe(0)
    expect(t.at(-1)).toBe(1)
  })

  it('任何可达上限都能找到一个不高于它的注册点，差距不超过 5%', () => {
    const grid = observerThresholds(1) as number[]
    // 元素高 / root 高 的各种比值：上限 = root / 元素
    for (const ratio of [0.3, 0.07, 0.42, 0.99, 0.5, 0.13]) {
      const usable = grid.filter(g => g <= ratio + 1e-9)
      expect(usable.length).toBeGreaterThan(0)
      expect(ratio - usable.at(-1)!).toBeLessThanOrEqual(0.05 + 1e-9)
    }
  })
})

describe('判定与注册用同一套刻度（Codex 在 #81 指出）', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver; g.innerHeight = 900 })
  afterEach(() => { delete g.IntersectionObserver; document.body.innerHTML = '' })

  // 通知里带的是**当时的真实比例**，所以上限落在两个网格点之间的元素永远拿不到
  // 「比例等于上限」的那一次。Chromium 实测（2700 px 元素 / 900 px root，上限 0.3333）：
  // 跨越 0.30 的那次报 0.30000001，之后再没有回调——拿精确的 0.3333 去比就永远不通过
  it('可达上限向下对齐到网格', () => {
    expect(quantizeThreshold(1 / 3)).toBeCloseTo(0.3, 10)
    expect(quantizeThreshold(0.3)).toBeCloseTo(0.3, 10)
    expect(quantizeThreshold(0.0741)).toBeCloseTo(0.05, 10)
    expect(quantizeThreshold(1)).toBeCloseTo(1, 10)
  })

  it('对齐后的值一定是注册过的网格点', () => {
    const grid = observerThresholds(1) as number[]
    for (const cap of [1 / 3, 0.07, 900 / 2700, 900 / 1234, 0.999]) {
      const q = quantizeThreshold(cap)
      expect(grid.some(g => Math.abs(g - q) < 1e-9)).toBe(true)
      expect(q).toBeLessThanOrEqual(cap + 1e-9)
      expect(cap - q).toBeLessThan(THRESHOLD_STEP)
    }
  })

  it('不在网格上的配置值也要注册进去（Codex 在 #81 指出）', () => {
    // 用户可以填 0.33：不注册它的话，上限在 0.33–0.35 之间的块会卡死——
    // 跨越 0.30 的回调报 0.30 < 0.33 被拒，0.35 又够不着
    const t = observerThresholds(0.33) as number[]
    expect(t).toContain(0.33)
    expect(t).toHaveLength(22)
    expect([...t].sort((a, b) => a - b)).toEqual(t)
  })

  it('正好落在网格上的配置值不重复注册', () => {
    const t = observerThresholds(0.5) as number[]
    expect(t).toHaveLength(21)
    expect(t.filter(v => Math.abs(v - 0.5) < 1e-9)).toHaveLength(1)
  })

  it('配置值不在网格上、但块够得着它：按配置值判，回调也到得了', () => {
    const { io, entered, el } = oneWith(300, 0.33)
    io.emit([el], 0.32, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.33, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('够得着配置值时不降级：正常大小的块仍按用户配的比例要求', () => {
    const { io, entered, el } = oneWith(300, 0.5)
    io.emit([el], 0.4, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.5, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('上限落在网格点之间：按对齐后的值放行（实测里那次 0.30000001）', () => {
    // 2700 px 元素、900 px root：上限 0.3333，对齐到 0.30
    const { io, entered, el } = oneWith(2700, 1)
    io.emit([el], 0.30000001, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('还没到对齐后的阈值就不放行', () => {
    const { io, entered, el } = oneWith(2700, 1)
    io.emit([el], 0.28, 900)
    expect(entered).toEqual([])
  })

  it('泛型：只要有 el 就能调度——图片目标（§15）与文字块共用同一套观察器', () => {
    document.body.innerHTML = '<article class="ltx_document"><img class="ltx_graphics" id="g1"><img class="ltx_graphics" id="g2"></article>'
    const targets = Array.from(document.querySelectorAll('img')).map(el => ({ id: el.id, el: el as HTMLImageElement }))
    layout(targets[0]!.el, 100)
    layout(targets[1]!.el, 5000)
    const entered: { id: string }[][] = []
    const scheduler = createLazyScheduler(targets, { ...DEFAULT_PRELOAD, onEnter: picked => entered.push(picked) })
    expect(entered).toEqual([[targets[0]]])
    const io = FakeIntersectionObserver.instances.at(-1)!
    expect(io.observed.has(targets[1]!.el)).toBe(true)
    io.emit([targets[1]!.el])
    expect(entered).toEqual([[targets[0]], [targets[1]]])
    expect(scheduler.waiting()).toBe(0)
  })
})
