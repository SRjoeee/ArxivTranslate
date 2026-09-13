import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { type HelperClientDeps, type NativePort, createHelperClient } from '@/entrypoints/background/helper'
import { OcrBackendError } from '@/entrypoints/background/ocr-backend'

// The helper client (DESIGN §15.2): a fake port records postMessage, and the test decides when to reply or disconnect;
// every assertion targets one way of getting it wrong: ids not correlated, no timeout, a disconnect not voiding, a withdrawal not applying, a reconnect not re-pinging, keep-alive not stopping

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
  /** The helper replies */
  reply(message: Record<string, unknown>) { for (const cb of this.onMessageCbs) cb(message) }
  /** Chrome disconnects the port (worker reclaimed, helper exited, host not installed) */
  drop() { for (const cb of this.onDisconnectCbs) cb() }
  /** The id of the last request */
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

// Under the fake clock setTimeout does not advance on its own: advancing 0 ms flushes the microtasks along the way
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('createHelperClient', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('status: connects once, pings once and caches the version; the second time no ping is sent', async () => {
    const { client, port, ports } = setup()
    const first = client.status()
    await flush()
    expect(ports).toHaveLength(1)
    expect(port().sent).toEqual([{ v: 1, cmd: 'ping', id: port().lastId() }])
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.1.0' })
    expect(await first).toEqual({ state: 'ready', version: '0.1.0' })
    expect(await client.status()).toEqual({ state: 'ready', version: '0.1.0' })
    expect(port().sent).toHaveLength(1) // // no second ping
  })

  /** A new connection inserts an internal ping first: reply to it, so the OCR after it is released */
  async function handshake(port: FakePort, version = '0.1.0') {
    expect(port.sent[0]).toMatchObject({ cmd: 'ping' })
    port.reply({ v: 1, id: port.sent[0]?.id as string, ok: true, version })
    await flush()
  }

  it('replies are correlated by id: an earlier reply must not go to the wrong request; a reply with no matching id is dropped', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    await handshake(port())
    // In-flight cap 1: B is still queued, the port holds only ping + A
    expect(port().sent).toHaveLength(2)
    const idA = port().lastId()
    port().reply({ v: 1, id: 'nobody', width: 1, height: 1, lines: [] }) // // dropped
    port().reply({ v: 1, id: idA, width: 10, height: 20, lines: [{ text: 'x', quad: [[0, 0], [1, 0], [1, 1], [0, 1]], conf: 1 }] })
    const ra = await a
    expect(ra.result.width).toBe(10)
    expect(ra.version).toBe('0.1.0')
    await flush()
    expect(port().sent).toHaveLength(3) // // only once A settled is B written to the port
    const idB = port().lastId()
    expect(idB).not.toBe(idA)
    port().reply({ v: 1, id: idB, width: 30, height: 40, lines: [] })
    expect((await b).result.width).toBe(30)
  })

  it('timeout: rejected as timeout at the deadline; a late reply on the old port is dropped, and the queued B goes on over the new connection', async () => {
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
    old.reply({ v: 1, id: old.sent[1]?.id as string, width: 1, height: 1, lines: [] }) // // A's late reply: dropped
    await handshake(port())
    expect(port().sent.map(m => m.image ?? m.cmd)).toEqual(['ping', 'B'])
    port().reply({ v: 1, id: port().lastId(), width: 2, height: 2, lines: [] })
    expect((await b).result.width).toBe(2)
  })

  it('port disconnect: everything pending and queued is rejected as network, and the next request reconnects and pings again', async () => {
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
    // Reconnect: a new port, a new ping (the version enters the cache key and cannot be carried over from the old connection)
    const again = client.status()
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent[0]).toMatchObject({ cmd: 'ping' })
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.2.0' })
    expect(await again).toEqual({ state: 'ready', version: '0.2.0' })
  })

  it('the first message after a reconnect is a handshake, not an OCR: the result of a helper of another version comes back with the new version (Codex on #87)', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Native host has exited.' })
    const status = client.status()
    await flush()
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.1.0' })
    expect(await status).toEqual({ state: 'ready', version: '0.1.0' })
    port().drop()
    // The port is gone; send an OCR directly — the first message on the new port must be a ping
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

  it('the port is disconnected after a timeout: the helper is a synchronous loop and still holds the timed-out request; the next request opens a new connection and shakes hands again (Codex on #87)', async () => {
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
    expect(port().sent.map(m => m.cmd)).toEqual(['ping']) // // the new connection shakes hands first
    await handshake(port())
    port().reply({ v: 1, id: port().lastId(), width: 2, height: 2, lines: [] })
    expect((await b).result.width).toBe(2)
  })

  it('the handshake answers with an error envelope (an incompatible helper): the queued OCR is rejected as invalid-response, the port disconnected, no endless re-pinging (Codex on #87)', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    port().reply({ v: 1, id: port().sent[0]?.id as string, error: { code: 'bad-request', message: '协议版本不对' } })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('握手失败') })
    await expect(b).rejects.toMatchObject({ kind: 'invalid-response' })
    await flush()
    expect(port().sent).toHaveLength(1) // // no second ping
    expect(port().disconnected).toBe(true)
  })

  it('the handshake times out: the queued OCR is rejected with it, no reconnect every 30 seconds queueing for ever', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    vi.advanceTimersByTime(1001)
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    await flush()
    expect(ports).toHaveLength(1)
  })

  it('what is withdrawn is the in-flight request: the port is dropped, and the request moving up runs over a new connection (the helper is still processing the withdrawn one, Codex on #87)', async () => {
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

  it('connectNative throws (permission not granted): everything queued is rejected as network, tried once, no synchronous infinite loop (Codex on #87)', async () => {
    let attempts = 0
    const client = createHelperClient({ connect: () => { attempts++; throw new Error('no nativeMessaging permission') } })
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await expect(a).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('no nativeMessaging') })
    await expect(b).rejects.toMatchObject({ kind: 'network' })
    expect(attempts).toBe(2) // // one connection attempt per call, no more
  })

  it('the first OCR in this worker uses a longer timeout (Vision\'s one-off preparation measured 26.6 s); after one successful recognition the normal timeout applies', async () => {
    const { client, port } = setup({ timeoutMs: 1000, firstOcrTimeoutMs: 5000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    await handshake(port())
    vi.advanceTimersByTime(1500) // // over the ordinary timeout; the first does not count
    expect(port().disconnected).toBe(false)
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    await a
    const b = client.ocr({ image: 'B' })
    await flush()
    vi.advanceTimersByTime(1001) // // 1000 ms from then on
    await expect(b).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('the protocol version does not match: the v the handshake returns is not what the extension needs, status reports unavailable with a reason; an OCR reply missing v is invalid (Codex on #87)', async () => {
    const { client, port } = setup()
    const status = client.status()
    await flush()
    port().reply({ v: 2, id: port().lastId(), ok: true, version: '9.9.9' })
    const result = await status
    expect(result).toMatchObject({ state: 'not-installed', reason: expect.stringContaining('protocol 2') })
    // The internal handshake likewise: the queued OCR rejected, the port disconnected
    const { client: c2, port: p2 } = setup()
    const a = c2.ocr({ image: 'A' })
    await flush()
    p2().reply({ v: 2, id: p2().sent[0]?.id as string, ok: true, version: '9.9.9' })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('协议版本') })
    expect(p2().disconnected).toBe(true)
  })

  it('the handshake reports no version: not usable (the version enters the cache key, and different builds cannot share one key space, Codex on #87)', async () => {
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
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('版本号') })
  })

  it('a reply from a helper that dropped lines carries truncated, passed through to the caller as it is (Codex on #87)', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    await flush()
    await handshake(port())
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [], truncated: true, frames: 3 })
    const ra = await a
    expect(ra.result.truncated).toBe(true)
    expect(ra.result.frames).toBe(3) // // an animation's frame count is passed through too
    const b = client.ocr({ image: 'B' })
    await flush()
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await b).result.truncated).toBeUndefined()
  })

  it('late replies on a dropped port are ignored without exception: the old connection\'s ping reply must not write the version into known and let the new connection skip the handshake (Codex on #87)', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    const old = port()
    expect(old.sent.map(m => m.cmd)).toEqual(['ping'])
    vi.advanceTimersByTime(1001) // // handshake timeout: the port dropped, A rejected
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    expect(old.disconnected).toBe(true)
    old.reply({ v: 1, id: old.sent[0]?.id as string, ok: true, version: '0.0.9' }) // // the late handshake reply on the old port
    const b = client.ocr({ image: 'B' })
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent.map(m => m.cmd)).toEqual(['ping']) // // the new connection shakes hands first as usual, not fooled by the old reply
    await handshake(port(), '0.1.0')
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await b).version).toBe('0.1.0')
  })

  it('host not installed (the disconnect reason is not found): status reports unavailable, and no further connection is attempted', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Specified native messaging host not found.' })
    const status = client.status()
    await flush()
    port().drop()
    const result = await status
    expect(result).toMatchObject({ state: 'not-installed', reason: expect.stringContaining('not found') })
    await expect(client.ocr({ image: 'A' })).rejects.toBeInstanceOf(OcrBackendError)
    expect(ports).toHaveLength(1) // // no second connection
  })

  it('once installed, status({ recheck: true }) connects once more: the guided install\'s “I have it running” relies on it', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Specified native messaging host not found.' })
    const first = client.status()
    await flush()
    port().drop()
    expect((await first).state).toBe('not-installed')
    // Without recheck it answers from memory as before, without connecting
    expect((await client.status()).state).toBe('not-installed')
    expect(ports).toHaveLength(1)
    // With it, that “not installed” is forgotten and it connects again — this time the host is there
    const again = client.status({ recheck: true })
    await flush()
    await handshake(port())
    const ok = await again
    expect(ok.state).toBe('ready')
    expect(ports).toHaveLength(2)
  })

  it('cancel(scope): queued ones are not written to the port and are rejected as aborted; in-flight ones are treated as withdrawn on arrival; other scopes are unaffected', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' }, 's1')
    const b = client.ocr({ image: 'B' }, 's1')
    const c = client.ocr({ image: 'C' }, 's2')
    await flush()
    await handshake(port())
    expect(port().sent).toHaveLength(2) // // ping + A in flight
    const old = port()
    expect(client.cancel('s1')).toBe(2)
    await expect(a).rejects.toMatchObject({ kind: 'aborted' })
    await expect(b).rejects.toMatchObject({ kind: 'aborted' })
    // The withdrawn one is the in-flight A: the old port is dropped, A's late reply ignored; C runs over a new connection
    await flush()
    old.reply({ v: 1, id: old.sent[1]?.id as string, width: 1, height: 1, lines: [] })
    await handshake(port())
    expect(port().sent.map(m => m.image ?? m.cmd)).toEqual(['ping', 'C'])
    port().reply({ v: 1, id: port().lastId(), width: 3, height: 3, lines: [] })
    expect((await c).result.width).toBe(3)
  })

  it('the helper\'s error envelope becomes an OcrBackendError: a bad request goes to bad-request, the rest to invalid-response', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: '!!!' })
    await flush()
    await handshake(port())
    port().reply({ v: 1, id: port().lastId(), error: { code: 'bad-base64', message: 'image is not valid base64' } })
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

  it('keep-alive runs only while a request is in flight and stops when idle', async () => {
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
    expect(keepAlive).toHaveBeenCalledTimes(3) // // not called again after the end
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
