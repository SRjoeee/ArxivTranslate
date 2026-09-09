import { describe, expect, it } from 'vitest'
import { beginSession, endSession, getSessionId } from '@/core/scheduler/session'

describe('session', () => {
  it('starting a session creates and selects a new ID; ending returns it and clears current', () => {
    const a = beginSession()
    expect(getSessionId()).toBe(a)
    const b = beginSession()
    expect(b).not.toBe(a)
    expect(getSessionId()).toBe(b)
    expect(endSession()).toBe(b)
    expect(getSessionId()).toBeNull()
    expect(endSession()).toBeNull()
  })

  it('IDs include a counter and remain unique within the same millisecond', () => {
    const ids = new Set(Array.from({ length: 50 }, () => beginSession()))
    expect(ids.size).toBe(50)
    endSession()
  })
})
