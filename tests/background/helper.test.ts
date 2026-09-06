import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelperError, type NativePort, createHelperClient } from '@/entrypoints/background/helper'

// helper 客户端（DESIGN §15.2）：假端口把 postMessage 记下来、由测试决定何时回应或断开，
// 每条断言都对着一种改坏的写法：不关联 id、不超时、断开不作废、撤销不生效、重连不重 ping、保活不停

class FakePort implements NativePort {
  sent: Record<string, unknown>[] = []
  private onMessageCbs: ((m: unknown) => void)[] = []
  private onDisconnectCbs: (() => void)[] = []
  disconnected = false
  postMessage(message: unknown) {
    this.sent.push(message as Record<string, unknown>)
  }
  onMessage = { addListener: (cb: (m: unknown) => void) => { this.onMessageCbs.push(cb) } }
  onDisconnect = { addListener: (cb: () => void) => { this.onDisconnectCbs.push(cb) } }
  disconnect() { this.disconnected = true }
  /** helper 回话 */
  reply(message: Record<string, unknown>) { for (const cb of this.onMessageCbs) cb(message) }
  /** Chrome 断开端口（worker 回收、helper 退出、host 没装） */
  drop() { for (const cb of this.onDisconnectCbs) cb() }
  /** 最后一条请求的 id */
  lastId(): string { return this.sent.at(-1)?.id as string }
}

function setup(opts: { lastError?: () => string | undefined; timeoutMs?: number; keepAlive?: () => void; keepAliveMs?: number } = {}) {
  const ports: FakePort[] = []
  const client = createHelperClient({
    connect: () => { const p = new FakePort(); ports.push(p); return p },
    ...opts,
  })
  return { client, ports, port: () => ports.at(-1) as FakePort }
}

// 假时钟下 setTimeout 不会自己走：推进 0 ms 顺带冲掉微任务
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('createHelperClient', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('status：连接一次、ping 一次并缓存版本；第二次不再发 ping', async () => {
    const { client, port, ports } = setup()
    const first = client.status()
    await flush()
    expect(ports).toHaveLength(1)
    expect(port().sent).toEqual([{ v: 1, cmd: 'ping', id: port().lastId() }])
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.1.0' })
    expect(await first).toEqual({ available: true, version: '0.1.0' })
    expect(await client.status()).toEqual({ available: true, version: '0.1.0' })
    expect(port().sent).toHaveLength(1) // 没有第二个 ping
  })

  it('响应按 id 关联：先到的回应不能给错请求；对不上号的回应丢弃', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    // 在飞上限 1：B 还在排队，端口上只有 A
    expect(port().sent).toHaveLength(1)
    const idA = port().lastId()
    port().reply({ v: 1, id: 'nobody', width: 1, height: 1, lines: [] }) // 丢弃
    port().reply({ v: 1, id: idA, width: 10, height: 20, lines: [{ text: 'x', quad: [[0, 0], [1, 0], [1, 1], [0, 1]], conf: 1 }] })
    const ra = await a
    expect(ra.width).toBe(10)
    await flush()
    expect(port().sent).toHaveLength(2) // A 结了，B 才写进端口
    const idB = port().lastId()
    expect(idB).not.toBe(idA)
    port().reply({ v: 1, id: idB, width: 30, height: 40, lines: [] })
    expect((await b).width).toBe(30)
  })

  it('超时：到点拒绝为 timeout，晚到的回应丢弃，队列继续', async () => {
    const { client, port } = setup({ timeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    vi.advanceTimersByTime(1001)
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    await flush()
    expect(port().sent).toHaveLength(2) // B 顶上
    port().reply({ v: 1, id: port().sent[0]?.id as string, width: 1, height: 1, lines: [] }) // A 的晚到回应
    port().reply({ v: 1, id: port().lastId(), width: 2, height: 2, lines: [] })
    expect((await b).width).toBe(2)
  })

  it('端口断开：全部 pending 与排队的都拒绝为 network，下一次请求重新连接并重新 ping', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Native host has exited.' })
    const status = client.status()
    await flush()
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.1.0' })
    await status
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    port().drop()
    await expect(a).rejects.toMatchObject({ kind: 'network' })
    await expect(b).rejects.toMatchObject({ kind: 'network' })
    // 重连：新端口、重新 ping（版本进缓存键，不能沿用旧连接的）
    const again = client.status()
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent[0]).toMatchObject({ cmd: 'ping' })
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.2.0' })
    expect(await again).toEqual({ available: true, version: '0.2.0' })
  })

  it('host 没装（断开原因是 not found）：status 报不可用，之后不再尝试连接', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Specified native messaging host not found.' })
    const status = client.status()
    await flush()
    port().drop()
    const result = await status
    expect(result.available).toBe(false)
    expect(result.reason).toContain('not found')
    await expect(client.ocr({ image: 'A' })).rejects.toBeInstanceOf(HelperError)
    expect(ports).toHaveLength(1) // 没有第二次连接
  })

  it('cancel(scope)：排队中的不写进端口、以 aborted 拒绝；在飞的到达后按已撤处理；别的 scope 不受影响', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' }, 's1')
    const b = client.ocr({ image: 'B' }, 's1')
    const c = client.ocr({ image: 'C' }, 's2')
    await flush()
    expect(port().sent).toHaveLength(1) // A 在飞
    expect(client.cancel('s1')).toBe(2)
    await expect(a).rejects.toMatchObject({ kind: 'aborted' })
    await expect(b).rejects.toMatchObject({ kind: 'aborted' })
    // A 的回应到了：已撤，丢弃；C 顶上
    port().reply({ v: 1, id: port().sent[0]?.id as string, width: 1, height: 1, lines: [] })
    await flush()
    expect(port().sent.map(m => m.image)).toEqual(['A', 'C'])
    port().reply({ v: 1, id: port().lastId(), width: 3, height: 3, lines: [] })
    expect((await c).width).toBe(3)
  })

  it('helper 的错误信封变成 HelperError：坏请求归 bad-request，其余归 invalid-response', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: '!!!' })
    await flush()
    port().reply({ v: 1, id: port().lastId(), error: { code: 'bad-base64', message: 'image 不是合法的 base64' } })
    await expect(a).rejects.toMatchObject({ kind: 'bad-request', message: expect.stringContaining('base64') })
    const b = client.ocr({ image: 'A' })
    await flush()
    port().reply({ v: 1, id: port().lastId(), error: { code: 'vision', message: 'boom' } })
    await expect(b).rejects.toMatchObject({ kind: 'invalid-response' })
    const c = client.ocr({ image: 'A' })
    await flush()
    port().reply({ v: 1, id: port().lastId(), lines: 'nope' })
    await expect(c).rejects.toMatchObject({ kind: 'invalid-response' })
  })

  it('保活只在有请求在飞时跑，闲下来就停', async () => {
    const keepAlive = vi.fn()
    const { client, port } = setup({ keepAlive, keepAliveMs: 100 })
    const a = client.ocr({ image: 'A' })
    await flush()
    vi.advanceTimersByTime(350)
    expect(keepAlive).toHaveBeenCalledTimes(3)
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    await a
    vi.advanceTimersByTime(1000)
    expect(keepAlive).toHaveBeenCalledTimes(3) // 结束后不再调
  })
})
