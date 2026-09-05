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
  emit(targets: Element[]) {
    this.callback(targets.map(target => ({ target, isIntersecting: true })) as IntersectionObserverEntry[], this as unknown as IntersectionObserver)
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
