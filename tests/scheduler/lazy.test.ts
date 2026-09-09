import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extract, markBlocks, type Block } from '@/core/extractor'
import { DEFAULT_PRELOAD, THRESHOLD_STEP, createLazyScheduler, observerThresholds, quantizeThreshold } from '@/core/scheduler/lazy'

/** happy-dom lacks IntersectionObserver; the fake records observe/unobserve and tests emit entries manually */
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
  /** Match real entry fields because the scheduler reads intersectionRatio, rootBounds, and boundingClientRect */
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

/** Give the element a layout box because happy-dom getBoundingClientRect returns only zeros */
function layout(el: Element, top: number, height = 20) {
  el.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON: () => ({}) })
}

function setup(): { blocks: Block[]; entered: Block[][]; io: FakeIntersectionObserver; by: Record<string, Block> } {
  document.body.innerHTML = PAGE
  const blocks = extract(document)
  markBlocks(blocks)
  const by = Object.fromEntries(blocks.map(b => [b.id, b]))
  // a is on the first screen, b inside the margin, c/d far away; footnote n has no layout box.
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

  it('uses Read Frog parameters: preload distance for rootMargin and visibility threshold', () => {
    const { io } = setup()
    expect(io.options).toEqual({ rootMargin: '1000px 0px', threshold: 0 })
  })

  it('seeds first-screen and preload-margin blocks synchronously as one batch, leaving distant blocks to the observer', () => {
    const { entered, io, by } = setup()
    expect(entered).toHaveLength(1)
    expect(entered[0]!.map(b => b.id)).toEqual(['a', 'b'])
    expect(io.observed.has(by.c!.el)).toBe(true)
    expect(io.observed.has(by.d!.el)).toBe(true)
    expect(io.observed.has(by.a!.el)).toBe(false)
  })

  it('unobserves once on entry and batches blocks from the same callback', () => {
    const { entered, io, by } = setup()
    io.emit([by.c!.el, by.d!.el])
    expect(entered).toHaveLength(2)
    expect(entered[1]!.map(b => b.id)).toEqual(['c', 'n', 'd'])
    expect(io.observed.size).toBe(0)
    io.emit([by.c!.el])
    expect(entered).toHaveLength(2)
  })

  it('layoutless footnote blocks attach to their paragraph and enter together', () => {
    const { io, by } = setup()
    expect(io.observed.has(by.n!.el)).toBe(false)
    expect(io.observed.has(by.c!.el)).toBe(true)
  })

  it('trigger submits blocks without waiting for the observer, reduces waiting, and disconnect clears it', () => {
    document.body.innerHTML = PAGE
    const blocks = extract(document)
    markBlocks(blocks)
    const entered: Block[][] = []
    const scheduler = createLazyScheduler(blocks, { ...DEFAULT_PRELOAD, onEnter: picked => entered.push(picked) })
    // All layout boxes are zero, so nothing seeds; paragraphs observe themselves and the footnote attaches to c.
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

  it('without IntersectionObserver, only seeds blocks and relies on trigger for the rest', () => {
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

describe('seeding and the observer use the same threshold (Codex #35)', () => {
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

  /** Place a block at the margin edge with the requested visible ratio */
  function seedWith(threshold: number, visibleRatio: number) {
    document.body.innerHTML = PAGE
    const blocks = extract(document)
    markBlocks(blocks)
    const by = Object.fromEntries(blocks.map(b => [b.id, b]))
    const height = 200
    // The lower margin boundary is innerHeight + margin = 800 + 1000 = 1800; expose only visibleRatio of the height.
    const top = 1800 - height * visibleRatio
    layout(by.a!.el, top, height)
    for (const id of ['b', 'c', 'd']) layout(by[id]!.el, 9000)
    const entered: Block[][] = []
    createLazyScheduler(blocks, { margin: 1000, threshold, onEnter: picked => entered.push(picked) })
    const io = FakeIntersectionObserver.instances[0]!
    return { seeded: entered.flat().some(b => b.id === 'a'), observed: io.observed.has(by.a!.el) }
  }

  it('threshold 0 seeds on any contact, preserving the default', () => {
    expect(seedWith(0, 0.05)).toEqual({ seeded: true, observed: false })
  })

  it('threshold 0.5 does not seed a 20%-visible block and leaves it to the observer', () => {
    expect(seedWith(0.5, 0.2)).toEqual({ seeded: false, observed: true })
  })

  it('threshold 0.5 still seeds an 80%-visible block', () => {
    expect(seedWith(0.5, 0.8)).toEqual({ seeded: true, observed: false })
  })
})

/** A controllable-height block starts far away so it can enter only through the observer */
function oneWith(height: number, threshold: number) {
  document.body.innerHTML = '<article class="ltx_document"><p class="ltx_p" id="a">A.</p></article>'
  const blocks = extract(document)
  markBlocks(blocks)
  layout(blocks[0]!.el, 5000, height)
  const entered: Block[][] = []
  createLazyScheduler(blocks, { margin: 0, threshold, onEnter: picked => entered.push(picked) })
  return { io: FakeIntersectionObserver.instances[0]!, entered, el: blocks[0]!.el }
}

describe('visibility-ratio thresholds are enforced (Codex #32 / #36)', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver; g.innerHeight = 900 })
  afterEach(() => { delete g.IntersectionObserver; document.body.innerHTML = '' })

  const one = oneWith

  it('insufficient visibility does not translate: a 10%-visible block cannot trigger at threshold 0.5', () => {
    const { io, entered, el } = one(200, 0.5)
    // The initial notification isIntersecting is true because the ratio exceeds zero, but the ratio is only 0.1.
    io.emit([el], 0.1, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.6, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('blocks taller than the viewport use an achievable threshold, allowing large tables to translate even at threshold 1', () => {
    // A 3000px element inside a 900px root can reach only 0.3; requiring 1 would never pass.
    const { io, entered, el } = one(3000, 1)
    io.emit([el], 0.3, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('blocks that can reach the configured threshold still must meet it', () => {
    const { io, entered, el } = one(300, 1)
    io.emit([el], 0.9, 900)
    expect(entered).toEqual([])
    io.emit([el], 1, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('threshold 0 preserves default behavior: any intersection triggers', () => {
    const { io, entered, el } = one(200, 0)
    io.emit([el], 0.01, 900)
    expect(entered.flat()).toHaveLength(1)
  })
})

describe('observer registration covers clamped thresholds (Codex #76)', () => {
  // Observers notify only when crossing registered thresholds. With only [0, threshold], an oversized block capped below threshold
  // gets no notification after crossing zero, so the clamped predicate never receives a passing entry.
  // Chromium measured a single ratio-0.267 callback for a 3000px element, 900px root, and threshold 1 with [0,1];
  // a 5% grid produced ratio 0.3. tests/e2e/layout.mjs guards the real-browser behavior.
  it('default threshold 0 still registers only zero because any intersection counts', () => {
    expect(observerThresholds(0)).toBe(0)
  })

  it('positive thresholds register a 5% grid including zero and one', () => {
    const t = observerThresholds(0.5) as number[]
    expect(Array.isArray(t)).toBe(true)
    expect(t).toHaveLength(21)
    expect(t[0]).toBe(0)
    expect(t.at(-1)).toBe(1)
  })

  it('every achievable cap has a registered point at or below it, within 5%', () => {
    const grid = observerThresholds(1) as number[]
    // Various element/root height ratios: the cap is root height divided by element height.
    for (const ratio of [0.3, 0.07, 0.42, 0.99, 0.5, 0.13]) {
      const usable = grid.filter(g => g <= ratio + 1e-9)
      expect(usable.length).toBeGreaterThan(0)
      expect(ratio - usable.at(-1)!).toBeLessThanOrEqual(0.05 + 1e-9)
    }
  })
})

describe('predicates and registration use the same grid (Codex #81)', () => {
  const g = globalThis as { IntersectionObserver?: unknown; innerHeight?: number }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver; g.innerHeight = 900 })
  afterEach(() => { delete g.IntersectionObserver; document.body.innerHTML = '' })

  // Notifications contain the actual ratio at that moment; an element capped between grid points never receives
  // an entry exactly at the cap. Chromium with a 2700px element and 900px root has a cap of 0.3333:
  // crossing 0.30 reports 0.30000001 with no later callback, so comparison against exact 0.3333 never passes.
  it('rounds achievable caps down to the grid', () => {
    expect(quantizeThreshold(1 / 3)).toBeCloseTo(0.3, 10)
    expect(quantizeThreshold(0.3)).toBeCloseTo(0.3, 10)
    expect(quantizeThreshold(0.0741)).toBeCloseTo(0.05, 10)
    expect(quantizeThreshold(1)).toBeCloseTo(1, 10)
  })

  it('aligned values are always registered grid points', () => {
    const grid = observerThresholds(1) as number[]
    for (const cap of [1 / 3, 0.07, 900 / 2700, 900 / 1234, 0.999]) {
      const q = quantizeThreshold(cap)
      expect(grid.some(g => Math.abs(g - q) < 1e-9)).toBe(true)
      expect(q).toBeLessThanOrEqual(cap + 1e-9)
      expect(cap - q).toBeLessThan(THRESHOLD_STEP)
    }
  })

  it('also registers configured values between grid points (Codex #81)', () => {
    // Users can choose 0.33; without registering it, blocks capped between 0.33 and 0.35 would stall:
    // the 0.30 callback fails the 0.33 predicate, and 0.35 is unreachable.
    const t = observerThresholds(0.33) as number[]
    expect(t).toContain(0.33)
    expect(t).toHaveLength(22)
    expect([...t].sort((a, b) => a - b)).toEqual(t)
  })

  it('does not duplicate configured values already on the grid', () => {
    const t = observerThresholds(0.5) as number[]
    expect(t).toHaveLength(21)
    expect(t.filter(v => Math.abs(v - 0.5) < 1e-9)).toHaveLength(1)
  })

  it('reachable off-grid configured thresholds are used and receive callbacks', () => {
    const { io, entered, el } = oneWith(300, 0.33)
    io.emit([el], 0.32, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.33, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('does not lower a reachable configured threshold; ordinary blocks still respect the user ratio', () => {
    const { io, entered, el } = oneWith(300, 0.5)
    io.emit([el], 0.4, 900)
    expect(entered).toEqual([])
    io.emit([el], 0.5, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('caps between grid points pass at the aligned value, including the measured 0.30000001', () => {
    // 2700px element, 900px root: cap 0.3333 aligns to 0.30.
    const { io, entered, el } = oneWith(2700, 1)
    io.emit([el], 0.30000001, 900)
    expect(entered.flat()).toHaveLength(1)
  })

  it('does not release below the aligned threshold', () => {
    const { io, entered, el } = oneWith(2700, 1)
    io.emit([el], 0.28, 900)
    expect(entered).toEqual([])
  })

  it('generic targets need only el, allowing image targets (§15) and text blocks to share one observer', () => {
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
