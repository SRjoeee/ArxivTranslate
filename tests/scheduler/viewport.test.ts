import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { extract } from '@/core/extractor'
import { VIEWPORT_OBSERVER_OPTIONS, createViewportTracker } from '@/core/scheduler/viewport'

/** happy-dom 没有 IntersectionObserver：用假的记录 observe 与回调，测试里手动 emit */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  observed: Element[] = []
  constructor(readonly callback: IntersectionObserverCallback, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this)
  }
  observe(el: Element) { this.observed.push(el) }
  unobserve() {}
  disconnect() { this.observed = [] }
  takeRecords() { return [] }
  emit(entries: { target: Element; isIntersecting: boolean }[]) {
    this.callback(entries as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
  }
}

const docOf = () => new DOMParser().parseFromString(
  '<!doctype html><html><body><article class="ltx_document"><p class="ltx_p" id="a">A.</p><p class="ltx_p" id="b">B.</p><p class="ltx_p" id="c">C.</p></article></body></html>',
  'text/html',
)

describe('createViewportTracker', () => {
  const g = globalThis as { IntersectionObserver?: unknown }
  beforeEach(() => { FakeIntersectionObserver.instances = []; g.IntersectionObserver = FakeIntersectionObserver })
  afterEach(() => { delete g.IntersectionObserver })

  it('观察全部块，参数照 FluentRead', () => {
    const blocks = extract(docOf())
    createViewportTracker(blocks)
    const io = FakeIntersectionObserver.instances[0]!
    expect(io.observed).toEqual(blocks.map(b => b.el))
    expect(io.options).toEqual(VIEWPORT_OBSERVER_OPTIONS)
    expect(VIEWPORT_OBSERVER_OPTIONS.rootMargin).toBe('600px 0px')
  })

  it('进入视口为 near，离开后不再 near，disconnect 后清空', () => {
    const blocks = extract(docOf())
    const tracker = createViewportTracker(blocks)
    const io = FakeIntersectionObserver.instances[0]!
    expect(tracker.isNear(blocks[1]!)).toBe(false)
    io.emit([{ target: blocks[1]!.el, isIntersecting: true }, { target: blocks[2]!.el, isIntersecting: true }])
    expect(tracker.isNear(blocks[1]!)).toBe(true)
    expect(tracker.isNear(blocks[2]!)).toBe(true)
    expect(tracker.isNear(blocks[0]!)).toBe(false)
    io.emit([{ target: blocks[1]!.el, isIntersecting: false }])
    expect(tracker.isNear(blocks[1]!)).toBe(false)
    tracker.disconnect()
    expect(tracker.isNear(blocks[2]!)).toBe(false)
    expect(io.observed).toEqual([])
  })

  it('没有 IntersectionObserver 时退化为全 false', () => {
    delete g.IntersectionObserver
    const blocks = extract(docOf())
    const tracker = createViewportTracker(blocks)
    expect(tracker.isNear(blocks[0]!)).toBe(false)
    tracker.disconnect()
  })
})
