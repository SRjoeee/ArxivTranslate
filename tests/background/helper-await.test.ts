// The wait of the guided install (DESIGN §15.4). This is all of the new background logic, so every branch needs an assertion:
// detected, not detected, deadline reached, the probe throwing, and picking up after the worker was reclaimed.
//
// Time and timers are all injected: run for real at one round per 2 seconds this file would take three minutes.
import { describe, expect, it, vi } from 'vitest'
import { createHelperWaiter, type HelperWaitDeps } from '@/entrypoints/background/helper-await'
import type { HelperStatus } from '@/shared/ocr'

/** A real microtask drain: the probe's await chain has several hops, and a fixed number of `Promise.resolve()` does not count right */
const flush = () => new Promise(resolve => setTimeout(resolve, 0))

/** A controlled clock and timers: `tick(ms)` advances time and runs those that fell due meanwhile */
function harness(options: { probe?: () => Promise<HelperStatus>; stored?: number; holdLoad?: boolean } = {}) {
  let releaseLoad: (() => void) | null = null
  let now = 1_000_000
  let next = 1
  const timers = new Map<number, { at: number; run: () => void }>()
  let saved: number | undefined = options.stored
  const announced: number[] = []
  const probes: number[] = []

  const deps: HelperWaitDeps = {
    probe: async () => {
      probes.push(now)
      return options.probe ? options.probe() : { state: 'not-installed' }
    },
    announce: () => { announced.push(now) },
    now: () => now,
    schedule: (run, ms) => { const id = next++; timers.set(id, { at: now + ms, run }); return id },
    cancel: id => { timers.delete(id) },
    load: async () => {
      // **The value is taken the moment the read goes out**, as with the real `storage.session.get`: a write after the read went out
      // does not affect what this read returns. Were the fixture to read the live variable, the race case below could never catch it
      const snapshot = saved
      // holdLoad: holds the read, so another action can be slipped in before it returns
      if (options.holdLoad) await new Promise<void>(resolve => { releaseLoad = resolve })
      return snapshot
    },
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

  return { deps, tick, announced, probes, armed: () => timers.size, savedAt: () => saved, at: () => now, releaseLoad: () => releaseLoad?.() }
}

const ready: HelperStatus = { state: 'ready', version: '0.1.0' }

describe('createHelperWaiter', () => {
  it('once detected it broadcasts once and stops — no further probing', async () => {
    let installed = false
    const h = harness({ probe: async () => (installed ? ready : { state: 'not-installed' }) })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()

    await h.tick(6_000)
    expect([h.probes.length, h.announced.length]).toEqual([3, 0])

    installed = true
    await h.tick(2_000)
    expect(h.announced).toHaveLength(1)
    // Only a detection is a real end: the deadline is cleared, and a reopened interface sees “not waiting”
    expect(waiter.until()).toBeNull()
    expect(h.savedAt()).toBeUndefined()
    // No new round is scheduled after the broadcast
    expect(h.armed()).toBe(0)
    const after = h.probes.length
    await h.tick(20_000)
    expect(h.probes.length).toBe(after)
  })

  // After the deadline the expired deadline is **kept**: the reader is most likely still in the terminal, and when they come back and reopen the popup
  // the interface has to tell “waited, nothing detected” from “never started” — cleared, both would be null (Codex on #166)
  it('once a window runs out the rounds stop, but the expired deadline is kept for the interface to read', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    const deadline = h.at() + 180_000
    expect(h.savedAt()).toBe(deadline)

    await h.tick(181_000)
    expect(waiter.until()).toBe(deadline)
    expect(h.savedAt()).toBe(deadline)
    expect(h.announced).toHaveLength(0)
    // No more probing and no timer left: only then can the worker be reclaimed
    expect(h.armed()).toBe(0)
    const probed = h.probes.length
    await h.tick(20_000)
    expect(h.probes.length).toBe(probed)
  })

  it('starting again after the timeout overrides the expired one', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await h.tick(181_000)

    await waiter.start()
    await flush()
    expect(waiter.until()).toBe(h.at() + 180_000)
    expect(h.armed()).toBe(1)
  })

  it('a probe that throws does not interrupt the wait: the next round runs as usual', async () => {
    let calls = 0
    const h = harness({
      probe: async () => {
        calls += 1
        if (calls <= 2) throw new Error('port just disconnected')
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

  it('clicking copy again pushes the deadline back to a full window instead of keeping the nearly expired one', async () => {
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
    // Only one timer runs: a repeated start must not stack rounds
    expect(h.armed()).toBe(1)
  })

  it('after the worker was reclaimed it picks up the wait that has not expired', async () => {
    const h = harness({ stored: 1_000_000 + 60_000 })
    const waiter = createHelperWaiter(h.deps)
    await waiter.resume()
    await flush()
    expect(waiter.until()).toBe(1_060_000)
    await h.tick(4_000)
    expect(h.probes.length).toBe(2)
  })

  it('an expired record is acknowledged but not probed: the interface says “not detected yet” by it', async () => {
    const h = harness({ stored: 1_000_000 - 1 })
    const waiter = createHelperWaiter(h.deps)
    await waiter.resume()
    await flush()
    expect(waiter.until()).toBe(1_000_000 - 1)
    expect(h.armed()).toBe(0)
    await h.tick(20_000)
    expect(h.probes).toHaveLength(0)
  })

  it('with nothing stored nothing happens: most worker starts take this path', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.resume()
    await flush()
    expect(waiter.until()).toBeNull()
    expect(h.armed()).toBe(0)
    expect(h.probes).toHaveLength(0)
  })

  // resume's guard is written before the await, and while storage is being read the reader may have clicked copy already:
  // that is the newer, explicit action, and the stale value read back must not overwrite it (Codex on #166)
  it('a new wait started while storage was being read: the old value must not be written back over it', async () => {
    const h = harness({ stored: 1_000_000 - 5_000, holdLoad: true })
    const waiter = createHelperWaiter(h.deps)
    const restoring = waiter.resume()
    await flush()

    // The reader clicks copy while the read is still pending
    await waiter.start()
    await flush()
    const fresh = h.at() + 180_000
    expect(waiter.until()).toBe(fresh)

    h.releaseLoad()
    await restoring
    await flush()
    // The expired old value did not overwrite the new window
    expect(waiter.until()).toBe(fresh)
    expect(h.savedAt()).toBe(fresh)
    expect(h.armed()).toBe(1)
  })

  it('while waiting, resume does not arm again', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await waiter.resume()
    await flush()
    expect(h.armed()).toBe(1)
  })

  it('after stop there is no more probing, and what was stored is cleared', async () => {
    const h = harness()
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await waiter.stop()
    expect(h.savedAt()).toBeUndefined()
    await h.tick(20_000)
    expect(h.probes).toHaveLength(0)
  })

  it('no second round starts while one probe is still out', async () => {
    let release: (() => void) | null = null
    const h = harness({
      probe: () => new Promise<HelperStatus>(resolve => { release = () => resolve({ state: 'not-installed' }) }),
    })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await h.tick(10_000)
    // The first round is still pending: the later deadlines only re-queue, no further probe is sent
    expect(h.probes).toHaveLength(1)
    release!()
    await flush()
    await h.tick(2_000)
    expect(h.probes.length).toBeGreaterThan(1)
  })

  it('a hung probe does not jam the wait: at the deadline it still packs up', async () => {
    const h = harness({ probe: () => new Promise<HelperStatus>(() => {}) })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await flush()
    await h.tick(181_000)
    // The one that never came back is still pending, but the rounds themselves reached the deadline
    expect(h.probes).toHaveLength(1)
    expect(waiter.until()).not.toBeNull()
    expect(h.armed()).toBe(0)
  })
  it('a probe without the permission ends the wait: nothing can be found until the pages get it granted (ADR-0002)', async () => {
    const h = harness({ probe: async () => ({ state: 'permission-missing' }) })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    await h.tick(2_000)
    expect(h.probes).toHaveLength(1)
    expect(waiter.until()).toBeNull()
    expect(h.savedAt()).toBeUndefined()
    expect(h.armed()).toBe(0)
    await h.tick(10_000)
    expect(h.probes).toHaveLength(1)
    expect(h.announced).toEqual([])
  })

  it('a stale worker (restarting) stops its rounds but keeps the deadline: the fresh worker resumes it from storage', async () => {
    const h = harness({ probe: async () => ({ state: 'restarting' }) })
    const waiter = createHelperWaiter(h.deps)
    await waiter.start()
    const deadline = waiter.until()
    await h.tick(2_000)
    expect(h.probes).toHaveLength(1)
    expect(h.armed()).toBe(0)
    expect(waiter.until()).toBe(deadline)
    expect(h.savedAt()).toBe(deadline)
    await h.tick(10_000)
    expect(h.probes).toHaveLength(1)
    expect(h.announced).toEqual([])
  })
})
