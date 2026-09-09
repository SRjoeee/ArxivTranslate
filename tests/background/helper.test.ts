import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HelperError, type NativePort, createHelperClient } from '@/entrypoints/background/helper'

// Helper client (DESIGN §15.2): a fake port records postMessage; tests control replies and disconnects.
// Assertions catch missing ID correlation, timeouts, disconnect invalidation, cancellation, re-handshakes, and keepalive cleanup.

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
  /** Helper reply */
  reply(message: Record<string, unknown>) { for (const cb of this.onMessageCbs) cb(message) }
  /** Chrome disconnects the port (worker reclaimed, helper exited, or host missing) */
  drop() { for (const cb of this.onDisconnectCbs) cb() }
  /** ID of the latest request */
  lastId(): string { return this.sent.at(-1)?.id as string }
}

function setup(opts: { lastError?: () => string | undefined; timeoutMs?: number; firstOcrTimeoutMs?: number; keepAlive?: () => void; keepAliveMs?: number } = {}) {
  const ports: FakePort[] = []
  const client = createHelperClient({
    connect: () => { const p = new FakePort(); ports.push(p); return p },
    ...opts,
  })
  return { client, ports, port: () => ports.at(-1) as FakePort }
}

// Fake timers do not advance setTimeout automatically: advance 0 ms to flush microtasks too.
const flush = () => vi.advanceTimersByTimeAsync(0)

describe('createHelperClient', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('status: connects and pings once, caches the version, and reuses it without another ping', async () => {
    const { client, port, ports } = setup()
    const first = client.status()
    await flush()
    expect(ports).toHaveLength(1)
    expect(port().sent).toEqual([{ v: 1, cmd: 'ping', id: port().lastId() }])
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.1.0' })
    expect(await first).toEqual({ available: true, version: '0.1.0' })
    expect(await client.status()).toEqual({ available: true, version: '0.1.0' })
    expect(port().sent).toHaveLength(1) // No second ping
  })

  /** A new connection first sends an internal ping; reply to release queued OCR */
  async function handshake(port: FakePort, version = '0.1.0') {
    expect(port.sent[0]).toMatchObject({ cmd: 'ping' })
    port.reply({ v: 1, id: port.sent[0]?.id as string, ok: true, version })
    await flush()
  }

  it('correlates replies by ID: out-of-order replies resolve the correct request and unmatched replies are discarded', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    await handshake(port())
    // Concurrency limit 1: B is queued; only ping and A have reached the port.
    expect(port().sent).toHaveLength(2)
    const idA = port().lastId()
    port().reply({ v: 1, id: 'nobody', width: 1, height: 1, lines: [] }) // Discarded
    port().reply({ v: 1, id: idA, width: 10, height: 20, lines: [{ text: 'x', quad: [[0, 0], [1, 0], [1, 1], [0, 1]], conf: 1 }] })
    const ra = await a
    expect(ra.result.width).toBe(10)
    expect(ra.version).toBe('0.1.0')
    await flush()
    expect(port().sent).toHaveLength(3) // B reaches the port only after A settles.
    const idB = port().lastId()
    expect(idB).not.toBe(idA)
    port().reply({ v: 1, id: idB, width: 30, height: 40, lines: [] })
    expect((await b).result.width).toBe(30)
  })

  it('timeout: rejects as timeout, discards late replies on the old port, and continues queued B on a new connection', async () => {
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
    old.reply({ v: 1, id: old.sent[1]?.id as string, width: 1, height: 1, lines: [] }) // Discard the late reply to A.
    await handshake(port())
    expect(port().sent.map(m => m.image ?? m.cmd)).toEqual(['ping', 'B'])
    port().reply({ v: 1, id: port().lastId(), width: 2, height: 2, lines: [] })
    expect((await b).result.width).toBe(2)
  })

  it('disconnect: rejects pending and queued requests as network errors; the next request reconnects and pings again', async () => {
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
    // Reconnect with a new port and ping: the version is part of the cache key and cannot survive a connection change.
    const again = client.status()
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent[0]).toMatchObject({ cmd: 'ping' })
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.2.0' })
    expect(await again).toEqual({ available: true, version: '0.2.0' })
  })

  it('the first request after reconnecting is a handshake: OCR results carry the new helper version (Codex #87)', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Native host has exited.' })
    const status = client.status()
    await flush()
    port().reply({ v: 1, id: port().lastId(), ok: true, version: '0.1.0' })
    expect((await status).version).toBe('0.1.0')
    port().drop()
    // After disconnecting, request OCR directly: the new port must send ping first.
    const a = client.ocr({ image: 'A' })
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    await handshake(port(), '0.2.0')
    expect(port().sent.map(m => m.cmd)).toEqual(['ping', 'ocr'])
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await a).version).toBe('0.2.0')
    expect(await client.status()).toEqual({ available: true, version: '0.2.0' })
  })

  it('disconnects after a timeout: the synchronous helper is still processing the request, so the next request reconnects and handshakes (Codex #87)', async () => {
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
    expect(port().sent.map(m => m.cmd)).toEqual(['ping']) // Handshake first on the new connection
    await handshake(port())
    port().reply({ v: 1, id: port().lastId(), width: 2, height: 2, lines: [] })
    expect((await b).result.width).toBe(2)
  })

  it('an incompatible handshake error rejects queued OCR as invalid-response and disconnects without endlessly pinging (Codex #87)', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await flush()
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    port().reply({ v: 1, id: port().sent[0]?.id as string, error: { code: 'bad-request', message: 'Protocol version mismatch' } })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('Helper handshake failed') })
    await expect(b).rejects.toMatchObject({ kind: 'invalid-response' })
    await flush()
    expect(port().sent).toHaveLength(1) // No second ping
    expect(port().disconnected).toBe(true)
  })

  it('a handshake timeout rejects queued OCR instead of leaving it queued through endless 30-second reconnects', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    expect(port().sent.map(m => m.cmd)).toEqual(['ping'])
    vi.advanceTimersByTime(1001)
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    await flush()
    expect(ports).toHaveLength(1)
  })

  it('cancelling an in-flight request discards its port; the next request uses a new connection while the helper finishes the cancelled one (Codex #87)', async () => {
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

  it('connectNative throwing for missing permission rejects the queue as network errors after one attempt, without a synchronous loop (Codex #87)', async () => {
    let attempts = 0
    const client = createHelperClient({ connect: () => { attempts++; throw new Error('no nativeMessaging permission') } })
    const a = client.ocr({ image: 'A' })
    const b = client.ocr({ image: 'B' })
    await expect(a).rejects.toMatchObject({ kind: 'network', message: expect.stringContaining('no nativeMessaging') })
    await expect(b).rejects.toMatchObject({ kind: 'network' })
    expect(attempts).toBe(2) // Exactly one connection attempt per call
  })

  it('the first OCR request in a worker gets a longer timeout (Vision initialization measured 26.6 s); successful OCR restores the normal timeout', async () => {
    const { client, port } = setup({ timeoutMs: 1000, firstOcrTimeoutMs: 5000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    await handshake(port())
    vi.advanceTimersByTime(1500) // The first request can exceed the normal timeout.
    expect(port().disconnected).toBe(false)
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    await a
    const b = client.ocr({ image: 'B' })
    await flush()
    vi.advanceTimersByTime(1001) // Subsequent requests use 1000 ms.
    await expect(b).rejects.toMatchObject({ kind: 'timeout' })
  })

  it('protocol mismatch: status explains an unsupported handshake v; an OCR reply missing v is invalid (Codex #87)', async () => {
    const { client, port } = setup()
    const status = client.status()
    await flush()
    port().reply({ v: 2, id: port().lastId(), ok: true, version: '9.9.9' })
    const result = await status
    expect(result.available).toBe(false)
    expect(result.reason).toContain('Helper protocol version 2')
    // The internal handshake also rejects queued OCR and disconnects.
    const { client: c2, port: p2 } = setup()
    const a = c2.ocr({ image: 'A' })
    await flush()
    p2().reply({ v: 2, id: p2().sent[0]?.id as string, ok: true, version: '9.9.9' })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('Protocol version') })
    expect(p2().disconnected).toBe(true)
  })

  it('a handshake without a version is unavailable: different helper builds must not share a cache namespace (Codex #87)', async () => {
    const { client, port } = setup()
    const status = client.status()
    await flush()
    port().reply({ v: 1, id: port().lastId(), ok: true })
    const result = await status
    expect(result.available).toBe(false)
    expect(result.reason).toContain('Helper did not report a version')
    const { client: c2, port: p2 } = setup()
    const a = c2.ocr({ image: 'A' })
    await flush()
    p2().reply({ v: 1, id: p2().sent[0]?.id as string, ok: true, version: '  ' })
    await expect(a).rejects.toMatchObject({ kind: 'invalid-response', message: expect.stringContaining('Response has no version') })
  })

  it('passes truncated through when the helper dropped OCR lines (Codex #87)', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' })
    await flush()
    await handshake(port())
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [], truncated: true, frames: 3 })
    const ra = await a
    expect(ra.result.truncated).toBe(true)
    expect(ra.result.frames).toBe(3) // Also passes through the animated image frame count.
    const b = client.ocr({ image: 'B' })
    await flush()
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await b).result.truncated).toBeUndefined()
  })

  it('ignores all late replies on discarded ports: an old ping cannot populate known and bypass the new handshake (Codex #87)', async () => {
    const { client, port, ports } = setup({ timeoutMs: 1000 })
    const a = client.ocr({ image: 'A' })
    await flush()
    const old = port()
    expect(old.sent.map(m => m.cmd)).toEqual(['ping'])
    vi.advanceTimersByTime(1001) // Handshake timeout: discard the port and reject A.
    await expect(a).rejects.toMatchObject({ kind: 'timeout' })
    expect(old.disconnected).toBe(true)
    old.reply({ v: 1, id: old.sent[0]?.id as string, ok: true, version: '0.0.9' }) // Late handshake reply from the old port
    const b = client.ocr({ image: 'B' })
    await flush()
    expect(ports).toHaveLength(2)
    expect(port().sent.map(m => m.cmd)).toEqual(['ping']) // The new connection still handshakes; the old reply cannot bypass it.
    await handshake(port(), '0.1.0')
    port().reply({ v: 1, id: port().lastId(), width: 1, height: 1, lines: [] })
    expect((await b).version).toBe('0.1.0')
  })

  it('a missing host reports unavailable status and prevents further connection attempts', async () => {
    const { client, port, ports } = setup({ lastError: () => 'Specified native messaging host not found.' })
    const status = client.status()
    await flush()
    port().drop()
    const result = await status
    expect(result.available).toBe(false)
    expect(result.reason).toContain('not found')
    await expect(client.ocr({ image: 'A' })).rejects.toBeInstanceOf(HelperError)
    expect(ports).toHaveLength(1) // No second connection
  })

  it('cancel(scope): queued requests never reach the port and reject as aborted; in-flight replies remain cancelled; other scopes are unaffected', async () => {
    const { client, port } = setup()
    const a = client.ocr({ image: 'A' }, 's1')
    const b = client.ocr({ image: 'B' }, 's1')
    const c = client.ocr({ image: 'C' }, 's2')
    await flush()
    await handshake(port())
    expect(port().sent).toHaveLength(2) // Ping and A are in flight.
    const old = port()
    expect(client.cancel('s1')).toBe(2)
    await expect(a).rejects.toMatchObject({ kind: 'aborted' })
    await expect(b).rejects.toMatchObject({ kind: 'aborted' })
    // Cancelling in-flight A discards its port and ignores its late reply; C uses a new connection.
    await flush()
    old.reply({ v: 1, id: old.sent[1]?.id as string, width: 1, height: 1, lines: [] })
    await handshake(port())
    expect(port().sent.map(m => m.image ?? m.cmd)).toEqual(['ping', 'C'])
    port().reply({ v: 1, id: port().lastId(), width: 3, height: 3, lines: [] })
    expect((await c).result.width).toBe(3)
  })

  it('converts helper error envelopes to HelperError: invalid requests become bad-request, others invalid-response', async () => {
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

  it('runs keepalive only while requests are in flight and stops when idle', async () => {
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
    expect(keepAlive).toHaveBeenCalledTimes(3) // No calls after completion
  })
})
