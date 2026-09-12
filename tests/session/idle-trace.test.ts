import { describe, expect, it } from 'vitest'
import { createIdleTrace } from '@/core/session/idle-trace'

// The one detection both runs use (ADR-0006's follow-up): a line per busy → idle transition, nothing else

type P = { inFlight: number; done: number }

function harness() {
  let now = 1_000
  const lines: string[] = []
  const report = createIdleTrace<P>({ now: () => now, trace: line => lines.push(line) }, p => p.inFlight > 0, (p, ms) => `idle: ${p.done} done, ${ms} ms`)
  return { report, lines, tick: (ms: number) => { now += ms } }
}

describe('createIdleTrace', () => {
  it('traces once when a busy run goes idle, with the time since the run started', () => {
    const h = harness()
    h.report({ inFlight: 2, done: 0 })
    h.tick(30)
    h.report({ inFlight: 1, done: 1 })
    expect(h.lines).toEqual([])
    h.tick(20)
    h.report({ inFlight: 0, done: 2 })
    expect(h.lines).toEqual(['idle: 2 done, 50 ms'])
  })

  it('a run that was never busy, or stays idle, traces nothing; a second round of work traces a second line', () => {
    const h = harness()
    h.report({ inFlight: 0, done: 0 })
    h.report({ inFlight: 0, done: 0 })
    expect(h.lines).toEqual([])
    h.report({ inFlight: 1, done: 0 })
    h.report({ inFlight: 0, done: 1 })
    h.report({ inFlight: 0, done: 1 })
    h.tick(100)
    h.report({ inFlight: 3, done: 1 })
    h.report({ inFlight: 0, done: 4 })
    expect(h.lines).toEqual(['idle: 1 done, 0 ms', 'idle: 4 done, 100 ms'])
  })
})
