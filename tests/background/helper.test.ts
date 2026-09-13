import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type HelperClientDeps, type NativePort, createHelperClient } from '@/entrypoints/background/helper'
import { OcrBackendError } from '@/entrypoints/background/ocr-backend'

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

function setup(opts: Partial<Omit<HelperClientDeps, 'connect'>> = {}) {
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
    expect(await first).toEqual({ state: 'ready', version: '0.1.0' })
    expect(await client.status()).toEqual({ state: 'ready', version: '0.1.0' })
    expect(port().sent).toHaveLength(1) // 没有第二个 ping
  })

  /** 新连接会先插一个内部 ping：回应它，让后面的 OCR 放行 */
  async function handshake(port: FakePort, version = '0.1.0') {
    expect(port.sent[0]).toMatchObject({ cmd: 'ping' })
    port.reply({ v: 1, id: port.sent[0]?.id as string, ok: true, version })
    await flush()
  }

  it('响应按 id 关联：先到的回应不能给错请求；对不上号的回应丢弃', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    await handshake(port())
    // 在飞上限 1：B 还在排队，端口上只有 ping + A
    expect(port().sent).toHaveLength(2)
    const idA = port().lastId()
    port().reply({ v: 1, id: 'nobody', width: 1, height: 1, lines: [] }) // 丢弃
    port().reply({ v: 1, id: idA, width: 10, height: 20, lines: [{ text: 'x', quad: [[0, 0], [1, 0], [1, 1], [0, 1]], conf: 1 }] })
    const ra = await a
    expect(ra.result.width).toBe(10)
    expect(ra.version).toBe('0.1.0')
    await flush()
    expect(port().sent).toHaveLength(3) // A 结了，B 才写进端口
    const idB = port().lastId()
    expect(idB).not.toBe(idA)
    port().reply({ v: 1, id: idB, width: 30, height: 40, lines: [] })
    expect((await b).result.width).toBe(30)
  })

  it('超时：到点拒绝为 timeout；旧端口上晚到的回应丢弃，排队的 B 在新连接上继续', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000, firstOcrTimeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    await handshake(port())
    const old = port()
    vi.advanceTimersByTime(1001)
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    await flush()
    expect(ports).toHaveLength(2)
    old.reply({ v: 1, id: old.sent[1]?.id as string, width: 1, height: 1, lines: [] }) // A 的晚到回应：丢弃
    await handshake(port())
    expect(port().sent.map(m => m.image ?? m.cmd)).toEqual(['ping', 'B'])
    port().reply({ v: 1, id: port().lastId(), width: 2, height: 2, lines: [] })
    expect((await b).result.width).toBe(2)
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
    expect(await again).toEqual({ state: 'ready', version: '0.2.0' })
  })

  it('重连后的第一条不是 OCR 而是握手：换了版本的 helper 的结果带着新版本回来（Codex 在 #87 指出）', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Native host has exited.' })
    const status = client.status()
    await flush()
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.1.0' })
    expect(await status).toEqual({ state: 'ready', version: '0.1.0' })
    port().drop()
    // 端口断了；直接发 OCR——新端口上的第一条必须是 ping
    const a = client.ocr({ image: 'A' })
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    await handshake(port(), '0.2.0')
    expect(port().sent.map(m => m.cmd)).toEqual(['ping', 'ocr'])
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await a).version).toBe('0.2.0')
    expect(await client.status()).toEqual({ state: 'ready', version: '0.2.0' })
  })

  it('超时后断开端口：helper 是同步循环，超时的请求还在它手里；下一条请求起新连接、重新握手（Codex 在 #87 指出）', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000, firstOcrTimeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    await handshake(port())
    vi.advanceTimersByTime(1001)
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    expect(port().disconnected).toBe(true)
    const b = client.ocr({ image: 'B' })
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent.map(m => m.cmd)).toEqual(['ping']) // 新连接先握手
    await handshake(port())
    port().reply({ v: 1, id: port().lastId(), width: 2, height: 2, lines: [] })
    expect((await b).result.width).toBe(2)
  })

  it('握手回错误信封（helper 不兼容）：排队的 OCR 拒绝为 invalid-response、端口断开，不会无限重 ping（Codex 在 #87 指出）', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    port().reply({ v: 1, id: port().sent[0]?.id as string, error: { code: 'bad-request', message: '协议版本不对' } })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('handshake failed') })
    await expect(b).rejects.toMatchObject({ kind: 'invalid-response' })
    await flush()
    expect(port().sent).toHaveLength(1) // 没有第二个 ping
    expect(port().disconnected).toBe(true)
  })

  it('握手超时：排队的 OCR 一起拒绝，不会每 30 秒重连一次永远排着', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    vi.advanceTimersByTime(1001)
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    await flush()
    expect(ports).toHaveLength(1)
  })

  it('撤掉的是在飞的请求：端口丢掉，顶上去的请求在新连接上跑（helper 还在处理被撤的那个，Codex 在 #87 指出）', async () => {
    const { client, port, ports } = setup()
    const a = client.ocr({ image: 'A' }, 's1')
    const c = client.ocr({ image: 'C' }, 's2')
    await flush()
    await handshake(port())
    const old = port()
    expect(client.cancel('s1')).toBe(1)
    await expect(a).rejects.toMatchObject({ kind: 'aborted' })
    expect(old.disconnected).toBe(true)
    await flush()
    expect(ports).toHaveLength(2)
    await handshake(port())
    expect(port().sent.map(m => m.image ?? m.cmd)).toEqual(['ping', 'C'])
    port().reply({ v: 1, id: port().lastId(), width: 3, height: 3, lines: [] })
    expect((await c).result.width).toBe(3)
  })

  it('connectNative 抛错（权限没给）：排队的全拒为 network，只试一次，不会同步死循环（Codex 在 #87 指出）', async () => {
    let attempts = 0
    const client = createHelperClient({ connect: () => { attempts++; throw new Error('no nativeMessaging permission') } })
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await expect(a).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('no nativeMessaging') })
    await expect(b).rejects.toMatchObject({ kind: 'network' })
    expect(attempts).toBe(2) // 每次调用试一次连接，不多
  })

  it('本 worker 里第一次 OCR 用更长的超时（Vision 一次性准备实测 26.6 s），识别成功过一次之后按正常超时', async () => {
    const { client, port } = setup({ timeoutMs: 1000, firstOcrTimeoutMs: 5000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    await handshake(port())
    vi.advanceTimersByTime(1500) // 超过普通超时，首次不算
    expect(port().disconnected).toBe(false)
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    await a
    const b = client.ocr({ image: 'B' })
    await flush()
    vi.advanceTimersByTime(1001) // 之后按 1000 ms
    await expect(b).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('协议版本对不上：握手回的 v 不是扩展要的，status 不可用并说明；OCR 回应缺 v 视为不合法（Codex 在 #87 指出）', async () => {
    const { client, port } = setup()
    const status = client.status()
    await flush()
    port().reply({ v: 2, id: port().lastId(), ok: true, version: '9.9.9' })
    const result = await status
    expect(result).toMatchObject({ state: 'not-installed', reason: expect.stringContaining('protocol 2') })
    // 内部握手也一样：排队的 OCR 拒掉、端口断开
    const { client: c2, port: p2 } = setup()
    const a = c2.ocr({ image: 'A' })
    await flush()
    p2().reply({ v: 2, id: p2().sent[0]?.id as string, ok: true, version: '9.9.9' })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('protocol version') })
    expect(p2().disconnected).toBe(true)
  })

  it('握手没报版本号：不算可用（版本进缓存键，不同构建不能共用一个键空间，Codex 在 #87 指出）', async () => {
    const { client, port } = setup()
    const status = client.status()
    await flush()
    port().reply({ v: 1, id: port().lastId(), ok: true })
    const result = await status
    expect(result).toMatchObject({ state: 'not-installed', reason: expect.stringContaining('no version') })
    const { client: c2, port: p2 } = setup()
    const a = c2.ocr({ image: 'A' })
    await flush()
    p2().reply({ v: 1, id: p2().sent[0]?.id as string, ok: true, version: '  ' })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('no version') })
  })

  it('helper 丢过行的回应带 truncated，原样透传给调用方（Codex 在 #87 指出）', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    await flush()
    await handshake(port())
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [], truncated: true, frames: 3 })
    const ra = await a
    expect(ra.result.truncated).toBe(true)
    expect(ra.result.frames).toBe(3) // 动图的帧数也透传
    const b = client.ocr({ image: 'B' })
    await flush()
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await b).result.truncated).toBeUndefined()
  })

  it('丢掉的端口上晚到的回应一律忽略：旧连接的 ping 回应不能把版本写进 known、让新连接跳过握手（Codex 在 #87 指出）', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    const old = port()
    expect(old.sent.map(m => m.cmd)).toEqual(['ping'])
    vi.advanceTimersByTime(1001) // 握手超时：端口丢掉、A 拒掉
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    expect(old.disconnected).toBe(true)
    old.reply({ v: 1, id: old.sent[0]?.id as string, ok: true, version: '0.0.9' }) // 旧端口上晚到的握手回应
    const b = client.ocr({ image: 'B' })
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent.map(m => m.cmd)).toEqual(['ping']) // 新连接照常先握手，没被旧回应糊弄过去
    await handshake(port(), '0.1.0')
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await b).version).toBe('0.1.0')
  })

  it('host 没装（断开原因是 not found）：status 报不可用，之后不再尝试连接', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Specified native messaging host not found.' })
    const status = client.status()
    await flush()
    port().drop()
    const result = await status
    expect(result).toMatchObject({ state: 'not-installed', reason: expect.stringContaining('not found') })
    await expect(client.ocr({ image: 'A' })).rejects.toBeInstanceOf(OcrBackendError)
    expect(ports).toHaveLength(1) // 没有第二次连接
  })

  it('装好之后 status({ recheck: true }) 会重新连一次：引导式安装的「我已经运行了」靠它', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Specified native messaging host not found.' })
    const first = client.status()
    await flush()
    port().drop()
    expect((await first).state).toBe('not-installed')
    // 不带 recheck 的照旧从记忆里答，连都不连
    expect((await client.status()).state).toBe('not-installed')
    expect(ports).toHaveLength(1)
    // 带上就忘掉那次「没装」，重新连——这一次 host 在了
    const again = client.status({ recheck: true })
    await flush()
    await handshake(port())
    const ok = await again
    expect(ok.state).toBe('ready')
    expect(ports).toHaveLength(2)
  })

  it('cancel(scope)：排队中的不写进端口、以 aborted 拒绝；在飞的到达后按已撤处理；别的 scope 不受影响', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' }, 's1')
    const b = client.ocr({ image: 'B' }, 's1')
    const c = client.ocr({ image: 'C' }, 's2')
    await flush()
    await handshake(port())
    expect(port().sent).toHaveLength(2) // ping + A 在飞
    const old = port()
    expect(client.cancel('s1')).toBe(2)
    await expect(a).rejects.toMatchObject({ kind: 'aborted' })
    await expect(b).rejects.toMatchObject({ kind: 'aborted' })
    // 撤的是在飞的 A：旧端口丢掉，A 的晚到回应被忽略；C 在新连接上跑
    await flush()
    old.reply({ v: 1, id: old.sent[1]?.id as string, width: 1, height: 1, lines: [] })
    await handshake(port())
    expect(port().sent.map(m => m.image ?? m.cmd)).toEqual(['ping', 'C'])
    port().reply({ v: 1, id: port().lastId(), width: 3, height: 3, lines: [] })
    expect((await c).result.width).toBe(3)
  })

  it('helper 的错误信封变成 OcrBackendError：坏请求归 bad-request，其余归 invalid-response', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: '!!!' })
    await flush()
    await handshake(port())
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
    await handshake(port())
    vi.advanceTimersByTime(350)
    expect(keepAlive).toHaveBeenCalledTimes(3)
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    await a
    vi.advanceTimersByTime(1000)
    expect(keepAlive).toHaveBeenCalledTimes(3) // 结束后不再调
  })
  it('the permission comes first (ADR-0002): without it status says permission-missing and nothing is connected; granted, it connects', async () => {
    let granted = false
    const { client, ports } = setup({ permitted: async () => granted })
    expect(await client.status()).toEqual({ state: 'permission-missing' })
    expect(ports).toHaveLength(0)
    granted = true
    const probe = client.status()
    await flush()
    expect(ports).toHaveLength(1)
    await handshake(ports[0] as FakePort)
    expect(await probe).toEqual({ state: 'ready', version: '0.1.0' })
  })

  it('a live handshake is not re-asked of the permission; a remembered missing host is answered after it', async () => {
    let asked = 0
    const { client, port } = setup({ permitted: async () => { asked++; return true } })
    const first = client.status()
    await flush()
    await handshake(port())
    expect(await first).toEqual({ state: 'ready', version: '0.1.0' })
    expect(await client.status()).toEqual({ state: 'ready', version: '0.1.0' })
    expect(asked).toBe(1)
    // The host memory sits behind the permission: a worker that lost the permission says so, not "not installed"
    let granted = true
    const missing = setup({ permitted: async () => granted, lastError: () => 'Specified native messaging host not found.' })
    const probe = missing.client.status()
    await flush()
    missing.port().drop()
    expect(await probe).toMatchObject({ state: 'not-installed' })
    granted = false
    expect(await missing.client.status()).toEqual({ state: 'permission-missing' })
  })

  it('granted into a running worker, whose context has no connectNative: status says restarting and connects nothing', async () => {
    const { client, ports } = setup({ permitted: async () => true, bound: () => false })
    expect(await client.status()).toEqual({ state: 'restarting' })
    expect(ports).toHaveLength(0)
    // The fresh worker has the binding and simply proceeds
    const fresh = setup({ permitted: async () => true, bound: () => true })
    const probe = fresh.client.status()
    await flush()
    await handshake(fresh.port())
    expect(await probe).toEqual({ state: 'ready', version: '0.1.0' })
  })
})
