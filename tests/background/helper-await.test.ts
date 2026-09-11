// 安装引导的等待（DESIGN §15.4）。这里是全部的新增后台逻辑，所以每条分支都要有断言：
// 探到、没探到、到点、探测抛错、worker 被回收之后接上。
//
// 时间与定时器全部注入：真跑 2 秒一轮的话这个文件要跑三分钟。
import { describe, expect, it, vi } from 'vitest'
import { createHelperWaiter, type HelperWaitDeps } from '@/entrypoints/background/helper-await'
import type { HelperStatus } from '@/shared/ocr'

/** 真实的微任务抽干：探测那条 await 链有好几跳，数固定的 `Promise.resolve()` 数不准 */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** 受控的时钟与定时器：`tick(ms)` 把时间推进并跑完期间到期的那些 */
function harness(options: { probe?: () => Promise<HelperStatus>; stored?: number } = {}) {
  let now = 1_000_000
  let next = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  let saved: number | undefined = options.stored
  const announced: number[] = []
  const probes: number[] = []

  const deps: HelperWaitDeps = {
    probe: async () => {
      probes.push(now)
      return options.probe ? options.probe() : { available: false }
    },
    announce: () => { announced.push(now) },
    now: () => now,
    schedule: (run, ms) => { const id = next++; timers.set(id, { at: now + ms, run }); return id },
    cancel: id => { timers.delete(id) },
    load: async () => saved,
    save: async deadline => { saved = deadline },
    pollMs: 2_000,
    windowMs: 180_000,
  }

  const tick = async (ms: number) => {
    const target = now + ms
    for (;;) {
      const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
      if (!due) break
      timers.delete(due[0])
      now = due[1].at
      due[1].run()
      await flush()
    }
    now = target
  }

  return { deps, tick, announced, probes, armed: () => timers.size, savedAt: () => saved, at: () => now }
}

const ready: HelperStatus = { available: true, version: '0.1.0' }

describe('createHelperWaiter', () => {
  it('探到就广播一次，然后停下——不再继续探', async () => {
    let installed = false
    const h = harness({ probe: async () => (installed ? ready : { available: false }) })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()

    await h.tick(6_000)
    expect([h.probes.length, h.announced.length]).toEqual([3, 0])

    installed = true
    await h.tick(2_000)
    expect(h.announced).toHaveLength(1)
    expect(waiter.until()).toBeNull()
    // 广播之后不再排新的一轮
    expect(h.armed()).toBe(0)
    const after = h.probes.length
    await h.tick(20_000)
    expect(h.probes.length).toBe(after)
  })

  it('一窗走完就收摊，存着的截止时间也清掉', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    expect(h.savedAt()).toBe(h.at() + 180_000)

    await h.tick(181_000)
    expect(waiter.until()).toBeNull()
    expect(h.savedAt()).toBeUndefined()
    expect(h.announced).toHaveLength(0)
    // 停下之后不留定时器：worker 才有机会被回收
    expect(h.armed()).toBe(0)
  })

  it('探测抛错不打断等待：下一轮照常', async () => {
    let calls = 0
    const h = harness({
      probe: async () => {
        calls += 1
        if (calls <= 2) throw new Error('端口刚断')
        return ready
      },
    })
    const warn = vi.fn()
    const waiter = createHelperWaiter({ ...h.deps, warn })
    await waiter.start()
    await flush()

    await h.tick(6_000)
    expect(warn).toHaveBeenCalledTimes(2)
    expect(h.announced).toHaveLength(1)
    expect(waiter.until()).toBeNull()
  })

  it('再点一次复制：截止时间推回满窗，而不是沿用快到期的那个', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await h.tick(170_000)
    const before = waiter.until()!

    await waiter.start()
    await flush()
    expect(waiter.until()).toBe(h.at() + 180_000)
    expect(waiter.until()! - before).toBe(170_000)
    // 只有一个定时器在跑：重复 start 不该把轮次叠起来
    expect(h.armed()).toBe(1)
  })

  it('worker 被回收之后接上没到期的那次等待', async () => {
    const h = harness({ stored: 1_000_000 + 60_000 })
    const waiter = createHelperWaiter(h.deps)
    await waiter.resume()
    await flush()
    expect(waiter.until()).toBe(1_060_000)
    await h.tick(4_000)
    expect(h.probes.length).toBe(2)
  })

  it('过期的记录不接，顺手清掉', async () => {
    const h = harness({ stored: 1_000_000 - 1 })
    const waiter = createHelperWaiter(h.deps)
    await waiter.resume()
    await flush()
    expect(waiter.until()).toBeNull()
    expect(h.savedAt()).toBeUndefined()
    expect(h.armed()).toBe(0)
  })

  it('没存过就什么都不做：绝大多数 worker 启动都走这条', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.resume()
    await flush()
    expect(waiter.until()).toBeNull()
    expect(h.armed()).toBe(0)
    expect(h.probes).toHaveLength(0)
  })

  it('正在等的时候 resume 不重复武装', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await waiter.resume()
    await flush()
    expect(h.armed()).toBe(1)
  })

  it('stop 之后不再探，存着的也清了', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await waiter.stop()
    expect(h.savedAt()).toBeUndefined()
    await h.tick(20_000)
    expect(h.probes).toHaveLength(0)
  })

  it('一轮探测还没回来时不开第二轮', async () => {
    let release: (() => void) | null = null
    const h = harness({
      probe: () => new Promise<HelperStatus>(resolve => { release = () => resolve({ available: false }) }),
    })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await h.tick(10_000)
    // 第一轮还挂着：后面几次到期只是重新排队，没有再发探测
    expect(h.probes).toHaveLength(1)
    release!()
    await flush()
    await h.tick(2_000)
    expect(h.probes.length).toBeGreaterThan(1)
  })

  it('探测挂住也不会把等待卡死：到点照样收摊', async () => {
    const h = harness({ probe: () => new Promise<HelperStatus>(() => {}) })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await h.tick(181_000)
    // 一直没回来的那一次还挂着，但轮次自己走到了截止时间
    expect(h.probes).toHaveLength(1)
    expect(waiter.until()).toBeNull()
    expect(h.armed()).toBe(0)
  })
})
