import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extract, markBlocks, type Block } from '@/core/extractor'
import { DEFAULT_PRELOAD, THRESHOLD_STEP, createLazyScheduler, observerThresholds, quantizeThreshold } from '@/core/scheduler/lazy'

/** happy-dom has no IntersectionObserver: a fake records observe / unobserve, and the tests emit by hand */
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
  /** Fields shaped after a real entry: the scheduler reads intersectionRatio / rootBounds / boundingClientRect */
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

/** Give an element a layout box: happy-dom's getBoundingClientRect is all zeros */
function layout(el: Element, top: number, height = 20) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON: () => ({}) })
}

function setup(): { blocks: Block[]; entered: Block[][]; io: FakeIntersectionObserver; by: Record<string, Block> } {
  document.body.innerHTML = PAGE
  const blocks = extract(document)
  markBlocks(blocks)
  const by = Object.fromEntries(blocks.map(b => [b.id, b]))
  // a in the first screen, b within the margin, c / d far away; footnote n has no layout box
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

  it('parameters as in Read Frog: rootMargin takes the preload distance, threshold the visibility threshold', () => {
    const { io } = setup()
    expect(io.options).toEqual({ rootMargin: '1000px 0px', threshold: 0 })
  })

  it('seeding: blocks in the first screen and within the preload distance enter synchronously as one batch; far ones go to the observer', () => {
    const { entered, io, by } = setup()
    expect(entered).toHaveLength(1)
    expect(entered[0]!.map(b => b.id)).toEqual(['a', 'b'])
    expect(io.observed.has(by.c!.el)).toBe(true)
    expect(io.observed.has(by.d!.el)).toBe(true)
    expect(io.observed.has(by.a!.el)).toBe(false)
  })

  it('unobserved on entering, once only; blocks of one callback gather into one batch', () => {
    const { entered, io, by } = setup()
    io.emit([by.c!.el, by.d!.el])
    expect(entered).toHaveLength(2)
    expect(entered[1]!.map(b => b.id)).toEqual(['c', 'n', 'd'])
    expect(io.observed.size).toBe(0)
    io.emit([by.c!.el])
    expect(entered).toHaveLength(2)
  })

  it('a footnote block without a layout box hangs on its paragraph and enters with it', () => {
    const { io, by } = setup()
    expect(io.observed.has(by.n!.el)).toBe(false)
    expect(io.observed.has(by.c!.el)).toBe(true)
  })

  it('trigger: blocks handed over by hand no longer wait for the observer; waiting decreases; cleared after disconnect', () => {
    document.body.innerHTML = PAGE
    const blocks = extract(document)
    markBlocks(blocks)
    const entered: Block[][] = []
    const scheduler = createLazyScheduler(blocks, { ...DEFAULT_PRELOAD, onEnter: picked => entered.push(picked) })
    // All zero layout boxes: nobody is seeded; each p observes itself, the footnote hangs on c
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

  it('an environment without IntersectionObserver: seeding only, the rest through trigger', () => {
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

describe('seeding and the observer use the same threshold (Codex on #35)', () => {
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

  /** Build a block stuck on the margin boundary at the given visible ratio */
  function seedWith(threshold: number, visibleRatio: number) {
    document.body.innerHTML = PAGE
    const blocks = extract(document)
    markBlocks(blocks)
    const by = Object.fromEntries(blocks.map(b => [b.id, b]))
    const height = 200
    // The margin's lower edge is innerHeight + margin = 800 + 1000 = 1800; let the block show only visibleRatio of its height
    const top = 1800 - height * visibleRatio
    layout(by.a!.el, top, height)
    for (const id of ['b', 'c', 'd']) layout(by[id]!.el, 9000)
    const entered: Block[][] = []
    createLazyScheduler(blocks, { margin: 1000, threshold, onEnter: picked => entered.push(picked) })
    const io = FakeIntersectionObserver.instances[0]!
    return { seeded: entered.flat().some(b => b.id === 'a'), observed: io.observed.has(by.a!.el) }
  }

  it('threshold 0: touching the edge seeds (the default behaviour unchanged)', () => {
    expect(seedWith(0, 0.05)).toEqual({ seeded: true, observed: false })
  })

  it('threshold 0.5: a block showing 20% only is not seeded and left to the observer\'s ratio check', () => {
    expect(seedWith(0.5, 0.2)).toEqual({ seeded: false, observed: true })
  })

  it('threshold 0.5: a block showing 80% is seeded as usual', () => {
    expect(seedWith(0.5, 0.8)).toEqual({ seeded: true, observed: false })
  })
})

/** One block of controllable height, starting far away (observer only) */
function oneWith(height: number, threshold: number) {
  document.body.innerHTML = '<article class="ltx_document"><p class="ltx_p" id="a">A.</p></article>'
  const blocks = extract(document)
  markBlocks(blocks)
  layout(blocks[0]!.el, 5000, height)
  const entered: Block[][] = []
  createLazyScheduler(blocks, { margin: 0, threshold, onEnter: picked => entered.push(picked) })
  return { io: FakeIntersectionObserver.instances[0]!, entered, el: blocks[0]!.el }
}

describe('the visibility threshold really applies (Codex on #32 / #36)', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver; g.innerHeight = 900 })
  afterEach(() => { delete g.IntersectionObserver; document.body.innerHTML = '' })

  const one = oneWith

  it('not translated below the ratio: at threshold 0.5 a block showing a tenth must not be triggered', () => {
    const { io, entered, el } = one(200, 0.5)
    // The initial notification: isIntersecting true (defined as “ratio > 0”), but the ratio is only 0.1
    io.emit([el], 0.1, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.6, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('a block taller than the viewport gets a reachable threshold: threshold 1 must still translate, or that big table never does', () => {
    // The element is 3000 high, the root only 900: the ratio caps at 0.3, and requiring 1 is never met
    const { io, entered, el } = one(3000, 1)
    io.emit([el], 0.3, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('a reachable block is still held to the original threshold: not every block is let through', () => {
    const { io, entered, el } = one(300, 1)
    io.emit([el], 0.9, 900)
    expect(entered).toEqual([])
    io.emit([el], 1, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('at threshold 0 (the default) the behaviour is unchanged: any intersection triggers', () => {
    const { io, entered, el } = one(200, 0)
    io.emit([el], 0.01, 900)
    expect(entered.flat()).toHaveLength(1)
  })
})

describe('the ratio points registered with the observer must cover the clamped threshold (Codex on #76)', () => {
  // The observer calls back **only when a registered value is crossed**. Registering [0, threshold] alone, an oversized block whose ratio cap is below
  // threshold gets no notification after crossing 0, and the check clamped to the cap never sees the one that could pass.
  // Chromium, measured (3000 px element / 900 px root / threshold 1): with [0,1] registered one callback in all, ratio 0.267;
  // with a 5% grid it got ratio 0.3. tests/e2e/layout.mjs has a case guarding the real-browser side
  it('at threshold 0 (the default) it is still the single 0: any intersection counts as entering', () => {
    expect(observerThresholds(0)).toBe(0)
  })

  it('at a threshold above 0 it is a 5% grid, 0 and 1 included', () => {
    const t = observerThresholds(0.5) as number[]
    expect(Array.isArray(t)).toBe(true)
    expect(t).toHaveLength(21)
    expect(t[0]).toBe(0)
    expect(t.at(-1)).toBe(1)
  })

  it('every reachable cap has a registered point no higher than it, at most 5% below', () => {
    const grid = observerThresholds(1) as number[]
    // Various ratios of element height / root height: the cap = root / element
    for (const ratio of [0.3, 0.07, 0.42, 0.99, 0.5, 0.13]) {
      const usable = grid.filter(g => g <= ratio + 1e-9)
      expect(usable.length).toBeGreaterThan(0)
      expect(ratio - usable.at(-1)!).toBeLessThanOrEqual(0.05 + 1e-9)
    }
  })
})

describe('the check and the registration use one scale (Codex on #81)', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver; g.innerHeight = 900 })
  afterEach(() => { delete g.IntersectionObserver; document.body.innerHTML = '' })

  // The notification carries the **real ratio of the moment**, so an element whose cap falls between two grid points never gets
  // the one where “the ratio equals the cap”. Chromium, measured (2700 px element / 900 px root, cap 0.3333):
  // the crossing of 0.30 reports 0.30000001 and no callback follows — compared against the exact 0.3333 it never passes
  it('the reachable cap is aligned down to the grid', () => {
    expect(quantizeThreshold(1 / 3)).toBeCloseTo(0.3, 10)
    expect(quantizeThreshold(0.3)).toBeCloseTo(0.3, 10)
    expect(quantizeThreshold(0.0741)).toBeCloseTo(0.05, 10)
    expect(quantizeThreshold(1)).toBeCloseTo(1, 10)
  })

  it('the aligned value is always a registered grid point', () => {
    const grid = observerThresholds(1) as number[]
    for (const cap of [1 / 3, 0.07, 900 / 2700, 900 / 1234, 0.999]) {
      const q = quantizeThreshold(cap)
      expect(grid.some(g => Math.abs(g - q) < 1e-9)).toBe(true)
      expect(q).toBeLessThanOrEqual(cap + 1e-9)
      expect(cap - q).toBeLessThan(THRESHOLD_STEP)
    }
  })

  it('a configured value off the grid is registered too (Codex on #81)', () => {
    // The reader may enter 0.33: unregistered, a block with its cap between 0.33 and 0.35 is stuck —
    // the callback crossing 0.30 reports 0.30 < 0.33 and is refused, and 0.35 is out of reach
    const t = observerThresholds(0.33) as number[]
    expect(t).toContain(0.33)
    expect(t).toHaveLength(22)
    expect([...t].sort((a, b) => a - b)).toEqual(t)
  })

  it('a configured value exactly on the grid is not registered twice', () => {
    const t = observerThresholds(0.5) as number[]
    expect(t).toHaveLength(21)
    expect(t.filter(v => Math.abs(v - 0.5) < 1e-9)).toHaveLength(1)
  })

  it('a configured value off the grid that the block can reach: judged by the configured value, and the callback arrives', () => {
    const { io, entered, el } = oneWith(300, 0.33)
    io.emit([el], 0.32, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.33, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('no degrading when the configured value is reachable: a block of normal size is still held to the reader\'s ratio', () => {
    const { io, entered, el } = oneWith(300, 0.5)
    io.emit([el], 0.4, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.5, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('the cap between grid points: let through at the aligned value (the measured 0.30000001)', () => {
    // A 2700 px element, a 900 px root: cap 0.3333, aligned to 0.30
    const { io, entered, el } = oneWith(2700, 1)
    io.emit([el], 0.30000001, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('not let through before the aligned threshold', () => {
    const { io, entered, el } = oneWith(2700, 1)
    io.emit([el], 0.28, 900)
    expect(entered).toEqual([])
  })

  it('generic: anything with an el can be scheduled — image targets (§15) and text blocks share one observer', () => {
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
