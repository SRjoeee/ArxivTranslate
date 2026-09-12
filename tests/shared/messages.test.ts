import { describe, expect, it } from 'vitest'
import { decodeReply, failure, isFailure, replyWith } from '@/shared/messages'

// A handler's failure travels back as a typed reply and becomes the sender's rejection (S2 review, fifth pass):
// a request whose work failed must settle, not wait for the worker to die

describe('failure replies', () => {
  it('replyWith answers with the value, or with a typed failure carrying the error\'s message', async () => {
    const replies: unknown[] = []
    replyWith(Promise.resolve({ ok: 1 }), reply => replies.push(reply))
    replyWith(Promise.reject(new Error('the chain\'s status did not settle')), reply => replies.push(reply))
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(replies).toEqual([{ ok: 1 }, { axtError: 'the chain\'s status did not settle' }])
  })

  it('decodeReply hands a value through and turns a failure reply into a rejection', () => {
    expect(decodeReply({ ok: 1 })).toEqual({ ok: 1 })
    expect(() => decodeReply(failure(new Error('boom')))).toThrow('boom')
    expect(isFailure({ axtError: 'x' })).toBe(true)
    expect(isFailure({ ok: false, error: { kind: 'network', message: 'x' } })).toBe(false)
    expect(isFailure(null)).toBe(false)
  })
})
