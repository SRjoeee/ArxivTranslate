import { describe, expect, it } from 'vitest'
import { beginSession, endSession, getSessionId } from '@/core/scheduler/session'

describe('session', () => {
  it('开始一个会话得到新 id，当前 id 随之变化；结束返回它并清空', () => {
    const a = beginSession()
    expect(getSessionId()).toBe(a)
    const b = beginSession()
    expect(b).not.toBe(a)
    expect(getSessionId()).toBe(b)
    expect(endSession()).toBe(b)
    expect(getSessionId()).toBeNull()
    expect(endSession()).toBeNull()
  })

  it('id 带计数，同一毫秒内也不重复', () => {
    const ids = new Set(Array.from({ length: 50 }, () => beginSession()))
    expect(ids.size).toBe(50)
    endSession()
  })
})
