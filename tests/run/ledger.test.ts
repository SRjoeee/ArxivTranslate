import { describe, expect, it, vi } from 'vitest'
import { createRunLedger } from '@/core/run/ledger'
import * as lazy from '@/core/scheduler/lazy'

// The bookkeeping both runs share (ADR-0006): outcomes, the permanent-error record, stop, the scheduler, the counts

type Target = { id: string; el: HTMLParagraphElement }
const target = (id: string): Target => ({ id, el: document.createElement('p') })
const three = (): [Target, Target, Target] => [target('a'), target('b'), target('c')]

describe('createRunLedger', () => {
  it('starts every target waiting, counts what was asked for, and lists failures in document order', () => {
    const [a, b, c] = three()
    const ledger = createRunLedger([a, b, c], { preload: lazy.DEFAULT_PRELOAD, onEnter: () => undefined })
    expect(ledger.progress()).toEqual({ total: 3, requested: 0, done: 0, failed: 0 })
    ledger.request([c, a])
    ledger.settle(c, 'failed', 'network: down')
    ledger.settle(a, 'done')
    expect(ledger.progress()).toEqual({ total: 3, requested: 2, done: 1, failed: 1 })
    expect(ledger.failed()).toEqual([c])
    expect(ledger.reasonOf(c)).toBe('network: down')
    expect(ledger.inState('requested')).toEqual([])
    expect(ledger.outcomeOf(b)).toBe('waiting')
  })

  it('intake takes what is known and not yet requested, claims it from the scheduler, and holds what the gate refuses', () => {
    const [a, b, c] = three()
    const claim = vi.fn()
    const spy = vi.spyOn(lazy, 'createLazyScheduler').mockReturnValue({ trigger: vi.fn(), claim, waiting: () => 0, disconnect: vi.fn() })
    const ledger = createRunLedger([a, b], { preload: lazy.DEFAULT_PRELOAD, onEnter: () => undefined })
    ledger.observe()
    ledger.request([b])
    expect(ledger.intake([a, b, c], t => t.id !== 'a')).toEqual({ taken: [], held: [a] }) // b requested, c unknown, a refused
    expect(ledger.intake([a, b, c])).toEqual({ taken: [a], held: [] })
    expect(claim).toHaveBeenCalledWith([a])
    spy.mockRestore()
  })

  it('a permanent error is recorded once, stops the scheduler and tells the run; nothing is taken afterwards', () => {
    const [a, b] = three()
    const disconnect = vi.fn()
    const spy = vi.spyOn(lazy, 'createLazyScheduler').mockReturnValue({ trigger: vi.fn(), claim: vi.fn(), waiting: () => 0, disconnect })
    const onFatal = vi.fn()
    const ledger = createRunLedger([a, b], { preload: lazy.DEFAULT_PRELOAD, onEnter: () => undefined, onFatal })
    ledger.observe()
    expect(ledger.fatal('auth', 'bad key')).toBe(true)
    expect(ledger.fatal('no-key', 'later')).toBe(false)
    expect(ledger.fatalReason()).toBe('auth: bad key')
    expect(ledger.progress().fatal).toBe('auth: bad key')
    expect(disconnect).toHaveBeenCalledTimes(1)
    expect(onFatal).toHaveBeenCalledTimes(1)
    expect(ledger.halted()).toBe(true)
    expect(ledger.intake([a, b])).toEqual({ taken: [], held: [] })
    spy.mockRestore()
  })

  it('stop is final and runs the clean-up once; observe after it does nothing', () => {
    const [a] = three()
    const spy = vi.spyOn(lazy, 'createLazyScheduler')
    const onStop = vi.fn()
    const ledger = createRunLedger([a], { preload: lazy.DEFAULT_PRELOAD, onEnter: () => undefined, onStop })
    ledger.stop()
    ledger.stop()
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(ledger.stopped()).toBe(true)
    expect(ledger.halted()).toBe(true)
    ledger.observe()
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('a run whose session is gone is halted without being stopped', () => {
    const [a] = three()
    let current = true
    const ledger = createRunLedger([a], { preload: lazy.DEFAULT_PRELOAD, onEnter: () => undefined, isCurrent: () => current })
    expect(ledger.halted()).toBe(false)
    current = false
    expect(ledger.halted()).toBe(true)
    expect(ledger.stopped()).toBe(false)
  })

  it('observe hands the viewport scheduler the run\'s own translate', () => {
    const [a] = three()
    const onEnter = vi.fn()
    const spy = vi.spyOn(lazy, 'createLazyScheduler').mockReturnValue({ trigger: vi.fn(), claim: vi.fn(), waiting: () => 0, disconnect: vi.fn() })
    const ledger = createRunLedger([a], { preload: { margin: 5, threshold: 0 }, onEnter })
    ledger.observe()
    ledger.observe()
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith([a], { margin: 5, threshold: 0, onEnter })
    spy.mockRestore()
  })
})
