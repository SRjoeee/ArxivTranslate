import { describe, expect, it } from 'vitest'
import { createMessageTransport } from '@/shared/transport'
import type { AxtMessage, AxtMessageType, AxtResponse } from '@/shared/messages'

type Sent = AxtMessage
const recorder = (reply: (message: Sent) => unknown) => {
  const sent: Sent[] = []
  const send = (async (message: Sent) => {
    sent.push(message)
    return reply(message)
  }) as <T extends AxtMessageType>(m: AxtMessage<T>) => Promise<AxtResponse<T>>
  return { sent, send }
}

describe('createMessageTransport', () => {
  it('translate sends the whole call (scope included) to the background as it is', async () => {
    const { sent, send } = recorder(() => ({ ok: true, result: { segments: [{ id: 'a', text: '甲' }], provider: 'mock' }, cached: 0 }))
    const transport = createMessageTransport(send)
    const res = await transport.translate({
      request: { segments: [{ id: 'a', text: 'A' }], source: 'en', target: 'cmn' },
      cache: { paper: '2410.00260', renderPath: 'tags' },
      scope: 'session-1',
    })
    expect(res.ok).toBe(true)
    expect(sent).toEqual([{
      type: 'axt:translate',
      request: { segments: [{ id: 'a', text: 'A' }], source: 'en', target: 'cmn' },
      cache: { paper: '2410.00260', renderPath: 'tags' },
      scope: 'session-1',
    }])
  })

  it('a structured error when the background is unreachable: an exception would be taken for a crash by run.ts and the whole batch marked failed', async () => {
    const { send } = recorder(() => { throw new Error('Extension context invalidated.') })
    const res = await createMessageTransport(send).translate({ request: { segments: [], source: 'en', target: 'cmn' } })
    expect(res).toEqual({ ok: false, error: { kind: 'network', message: '无法与扩展后台通信：Extension context invalidated.', isolatable: false } })
  })

  it('cancel sends axt:cancel-scope and returns the count withdrawn; unsendable counts as 0', async () => {
    const { sent, send } = recorder(() => ({ cancelled: 3 }))
    expect(await createMessageTransport(send).cancel('session-1')).toBe(3)
    expect(sent).toEqual([{ type: 'axt:cancel-scope', scope: 'session-1' }])
    const dead = recorder(() => { throw new Error('no receiver') })
    expect(await createMessageTransport(dead.send).cancel('session-1')).toBe(0)
  })

  it('status passes axt:provider-status straight through; a failure has to propagate, and start() refuses to start by it', async () => {
    const { sent, send } = recorder(() => ({ providerId: 'mock', available: true, maxBatchChars: 1, maxBatchItems: 1, renderPath: 'tags' as const, chain: ['mock'], engine: { id: 'mock', displayName: 'Mock' } }))
    expect((await createMessageTransport(send).status()).providerId).toBe('mock')
    expect(sent).toEqual([{ type: 'axt:provider-status' }])
    const dead = recorder(() => { throw new Error('background not responding') })
    await expect(createMessageTransport(dead.send).status()).rejects.toThrow('background not responding')
  })
})
