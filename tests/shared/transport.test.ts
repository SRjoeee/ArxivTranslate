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
  it('translate 把整个调用（含 scope）原样发给 background', async () => {
    const { sent, send } = recorder(() => ({ ok: true, result: { segments: [{ id: 'a', text: '甲' }], provider: 'mock' }, cached: 0 }))
    const transport = createMessageTransport(send)
    const res = await transport.translate({
      request: { segments: [{ id: 'a', text: 'A' }], source: 'en', target: 'cmn' },
      cache: { paper: '2410.00260', renderPath: 'markup' },
      scope: 'session-1',
    })
    expect(res.ok).toBe(true)
    expect(sent).toEqual([{
      type: 'axt:translate',
      request: { segments: [{ id: 'a', text: 'A' }], source: 'en', target: 'cmn' },
      cache: { paper: '2410.00260', renderPath: 'markup' },
      scope: 'session-1',
    }])
  })

  it('后台不通时给出结构化错误：抛异常会被 run.ts 当成崩溃，整批都标失败', async () => {
    const { send } = recorder(() => { throw new Error('Extension context invalidated.') })
    const res = await createMessageTransport(send).translate({ request: { segments: [], source: 'en', target: 'cmn' } })
    expect(res).toEqual({ ok: false, error: { kind: 'network', message: '无法与扩展后台通信：Extension context invalidated.' } })
  })

  it('cancel 发 axt:cancel-scope，返回撤掉的条数；发不出去按 0 算', async () => {
    const { sent, send } = recorder(() => ({ cancelled: 3 }))
    expect(await createMessageTransport(send).cancel('session-1')).toBe(3)
    expect(sent).toEqual([{ type: 'axt:cancel-scope', scope: 'session-1' }])
    const dead = recorder(() => { throw new Error('no receiver') })
    expect(await createMessageTransport(dead.send).cancel('session-1')).toBe(0)
  })

  it('status 直接透传 axt:provider-status；失败要往上抛，start() 据此拒绝开始', async () => {
    const { sent, send } = recorder(() => ({ providerId: 'mock', available: true, maxBatchChars: 1, maxBatchItems: 1, preservesMarkup: true, chain: ['mock'], engine: { id: 'mock', displayName: 'Mock' } }))
    expect((await createMessageTransport(send).status()).providerId).toBe('mock')
    expect(sent).toEqual([{ type: 'axt:provider-status' }])
    const dead = recorder(() => { throw new Error('后台未响应') })
    await expect(createMessageTransport(dead.send).status()).rejects.toThrow('后台未响应')
  })
})
