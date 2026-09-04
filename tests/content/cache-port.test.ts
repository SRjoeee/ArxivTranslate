import { describe, expect, it } from 'vitest'
import { createMessageCachePort } from '@/entrypoints/content/cache-port'

/** 记录消息的假 sender；不做模块级 mock */
function fakeSend(reply: (message: { type: string }) => unknown) {
  const sent: { type: string }[] = []
  const send = (async (message: { type: string }) => {
    sent.push(message)
    return reply(message)
  }) as Parameters<typeof createMessageCachePort>[0]
  return { send, sent }
}

const throwing = (() => { throw new Error('extension context invalidated') }) as Parameters<typeof createMessageCachePort>[0]

describe('createMessageCachePort', () => {
  it('批量读：一条消息，按顺序返回命中', async () => {
    const { send, sent } = fakeSend(() => ({ hits: ['译1', null] }))
    expect(await createMessageCachePort(send).getMany(['k1', 'k2'])).toEqual(['译1', null])
    expect(sent).toEqual([{ type: 'axt:cache-get', keys: ['k1', 'k2'] }])
  })

  it('批量写：一条消息带全部条目', async () => {
    const { send, sent } = fakeSend(() => ({ written: 1 }))
    const entries = [{ key: 'k', translation: '译', paper: 'p' }]
    await createMessageCachePort(send).putMany(entries)
    expect(sent).toEqual([{ type: 'axt:cache-put', entries }])
  })

  it('空输入不发消息', async () => {
    const { send, sent } = fakeSend(() => ({ hits: [] }))
    const port = createMessageCachePort(send)
    expect(await port.getMany([])).toEqual([])
    await port.putMany([])
    expect(sent).toEqual([])
  })

  it('返回条数对不上时降级为全部未命中', async () => {
    const { send } = fakeSend(() => ({ hits: ['只有一条'] }))
    expect(await createMessageCachePort(send).getMany(['k1', 'k2'])).toEqual([null, null])
  })

  it('background 不可用时降级为未命中，读写都不抛错', async () => {
    const port = createMessageCachePort(throwing)
    expect(await port.getMany(['k1', 'k2'])).toEqual([null, null])
    await expect(port.putMany([{ key: 'k', translation: '译', paper: 'p' }])).resolves.toBeUndefined()
  })
})
