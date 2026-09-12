import { describe, expect, it } from 'vitest'
import { newSessionId } from '@/core/scheduler/session'

describe('newSessionId', () => {
  it('ids differ, even fifty within one millisecond', () => {
    const ids = new Set(Array.from({ length: 50 }, () => newSessionId()))
    expect(ids.size).toBe(50)
  })
})
