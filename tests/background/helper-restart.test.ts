import { describe, expect, it, vi } from 'vitest'
import { createHelperRestart } from '@/entrypoints/background/helper-restart'
import type { HelperStatus } from '@/shared/ocr'

// A grant into a running worker (ADR-0002): the alarm brings a fresh worker, and the pages hear what it found

const ready: HelperStatus = { state: 'ready', version: '0.1.0' }

describe('createHelperRestart', () => {
  it('arms the alarm, and takes the outside subscriptions down, only when the status says this worker is stale', () => {
    const arm = vi.fn()
    const quiesce = vi.fn()
    const restart = createHelperRestart({ probe: async () => ready, arm, announce: vi.fn(), quiesce })
    restart.noticed({ state: 'permission-missing' })
    restart.noticed({ state: 'not-installed' })
    restart.noticed(ready)
    expect(arm).not.toHaveBeenCalled()
    expect(quiesce).not.toHaveBeenCalled()
    restart.noticed({ state: 'restarting' })
    expect(arm).toHaveBeenCalledTimes(1)
    expect(quiesce).toHaveBeenCalledTimes(1)
  })

  it('the alarm in a fresh worker probes and announces what it found, whatever it is', async () => {
    const arm = vi.fn()
    const announce = vi.fn()
    const quiesce = vi.fn()
    const restart = createHelperRestart({ probe: async () => ({ state: 'not-installed', reason: 'host not found' }), arm, announce, quiesce })
    await restart.fired()
    expect(announce).toHaveBeenCalledWith({ state: 'not-installed', reason: 'host not found' })
    expect(arm).not.toHaveBeenCalled()
    expect(quiesce).not.toHaveBeenCalled()
  })

  it('the alarm landing in the old worker, still alive, quiesces and arms again and announces nothing', async () => {
    const arm = vi.fn()
    const announce = vi.fn()
    const quiesce = vi.fn()
    const restart = createHelperRestart({ probe: async () => ({ state: 'restarting' }), arm, announce, quiesce })
    await restart.fired()
    expect(arm).toHaveBeenCalledTimes(1)
    expect(quiesce).toHaveBeenCalledTimes(1)
    expect(announce).not.toHaveBeenCalled()
  })
})
