// The client of the local OCR helper (DESIGN §15.2 / §15.4): request / response correlation over a Chrome Native
// Messaging port. It is the helper implementation of `OcrBackend` (ocr-backend.ts, ADR-0002).
//
// Facts about MV3 that shape it:
// - The keep-alive (a harmless API call every 20 s while a request is in flight) was built on the MVP-era belief that
//   an open port does not keep the service worker alive. Chrome's lifecycle documentation says otherwise for native
//   messaging since Chrome 105: a `connectNative` port keeps the worker alive, and the worker terminates after its
//   timers once the host exits (correction 2026-09-13, from the local review). The timer is redundant by that
//   account and harmless; removing it waits on a measurement on a current Chrome. What stays true: when the worker
//   is recycled the port closes, the helper sees EOF and exits, and every pending request is voided by
//   `onDisconnect` — the next request reconnects and pings again (the version is part of the cache key, so a
//   reconnected port must not reuse the old one).
// - With no host registered, `connectNative` does not throw: the port disconnects at once with "not found" in
//   `lastError`. That is remembered for the worker's life; nothing reconnects until a `recheck`.
// - `nativeMessaging` is optional (ADR-0002): `permitted` is asked before any connection, and `bound` says whether
//   this worker's context has `connectNative` at all — a worker started before the grant never gets it (Chrome adds
//   an API to a context when the context is created, verified 2026-09-13) and reports `restarting` until a fresh one
//   takes over (helper-restart.ts).
// - The helper is a sequential stdio loop, so at most one request is in flight: a cancelled request that has not
//   been written to the port is truly withdrawn; the in-flight one is discarded on arrival.
import type { ProviderErrorKind } from '@/providers/types'
import { HELPER_PROTOCOL, type HelperStatus, type OcrResult } from '@/shared/ocr'
import { type OcrBackend, OcrBackendError } from './ocr-backend'

/** The port chrome.runtime.connectNative returns, reduced to the four members used; tests pass a fake */
export interface NativePort {
  postMessage(message: unknown): void
  onMessage: { addListener(callback: (message: unknown) => void): void }
  onDisconnect: { addListener(callback: () => void): void }
  disconnect(): void
}

export interface HelperClientDeps {
  connect: () => NativePort
  /** On disconnect, read chrome.runtime.lastError?.message */
  lastError?: () => string | undefined
  /** The timeout of one request; OCR of one image usually takes under a second */
  timeoutMs?: number
  /** The timeout of the **first** OCR in this worker: the first Vision run on a machine does a one-time model preparation (measured 26.6 s), and 30 s would misjudge the helper hung */
  firstOcrTimeoutMs?: number
  /** The keep-alive interval and action while a request is in flight */
  keepAliveMs?: number
  keepAlive?: () => void
  /** Whether the optional `nativeMessaging` permission is granted right now (ADR-0002); absent means granted */
  permitted?: () => Promise<boolean>
  /** Whether this worker's context has `runtime.connectNative` — false in a worker that predates the grant */
  bound?: () => boolean
}

interface Pending {
  scope?: string
  resolve: (reply: Record<string, unknown>) => void
  reject: (error: OcrBackendError) => void
  timer?: ReturnType<typeof setTimeout>
}

interface Queued extends Pending {
  id: string
  message: Record<string, unknown>
}

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_FIRST_OCR_TIMEOUT_MS = 120_000
const DEFAULT_KEEP_ALIVE_MS = 20_000
const MAX_IN_FLIGHT = 1

/** Recognise “the host is not installed at all” in Chrome's disconnect reason: no retry for this kind */
function isMissingHost(reason: string | undefined): boolean {
  return /not found|forbidden|not registered|无法找到|找不到/i.test(reason ?? '')
}

export function createHelperClient(deps: HelperClientDeps): OcrBackend {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const firstOcrTimeoutMs = deps.firstOcrTimeoutMs ?? DEFAULT_FIRST_OCR_TIMEOUT_MS
  /** Recognised successfully once in this worker: Vision's one-time preparation has been paid for, and the normal timeout applies from here */
  let warmed = false
  const keepAliveMs = deps.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  let port: NativePort | null = null
  /** The result of this connection's ping; void on disconnect. A connection that never shook hands sends no OCR — the pump puts a ping at the head first */
  let known: HelperStatus | null = null
  /** The host is not installed: no more connecting for this worker's lifetime */
  let missing: string | null = null
  let sequence = 0
  const pending = new Map<string, Pending>()
  const queue: Queued[] = []
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null

  const busy = () => pending.size > 0 || queue.length > 0
  const updateKeepAlive = () => {
    if (busy() && !keepAliveTimer && deps.keepAlive) keepAliveTimer = setInterval(deps.keepAlive, keepAliveMs)
    if (!busy() && keepAliveTimer) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
  }

  const settle = (id: string): Pending | undefined => {
    const entry = pending.get(id)
    if (!entry) return undefined
    pending.delete(id)
    if (entry.timer) clearTimeout(entry.timer)
    return entry
  }

  const errorOf = (reply: Record<string, unknown>): OcrBackendError | null => {
    const error = reply.error as { code?: unknown; message?: unknown } | undefined
    if (!error) return null
    const kind: ProviderErrorKind = error.code === 'bad-request' || error.code === 'bad-base64' || error.code === 'undecodable-image' ? 'bad-request' : 'invalid-response'
    return new OcrBackendError(kind, `helper: ${typeof error.message === 'string' ? error.message : String(error.code)}`)
  }

  const failAll = (kind: ProviderErrorKind, message: string) => {
    for (const id of Array.from(pending.keys())) settle(id)?.reject(new OcrBackendError(kind, message))
    for (const item of queue.splice(0)) item.reject(new OcrBackendError(kind, message))
    updateKeepAlive()
  }

  /**
   * Drop the current port: the helper gets EOF and exits, and the next request starts a fresh process and shakes hands
   * again. Our own disconnect() fires no onDisconnect, so the state is cleared here. Used on a timeout (the helper is a
   * synchronous loop, the timed-out request is still in its hands, and without disconnecting everything after would
   * queue behind it; Codex on #87) and on a failed handshake
   */
  const dropPort = () => {
    const stale = port
    port = null
    known = null
    try {
      stale?.disconnect()
    } catch {
      // The port may be gone already
    }
  }

  const ensurePort = (): NativePort => {
    if (port) return port
    const opened = deps.connect()
    port = opened
    opened.onMessage.addListener(raw => {
      // The port was dropped already (a timeout, a failed handshake, a withdrawal): replies still queued in Chrome reach
      // this listener and are all ignored — otherwise a stale connection's ping reply would write the old helper's version into known, and the new connection would skip its handshake (Codex on #87)
      if (port !== opened) return
      const reply = raw as Record<string, unknown> | null
      const id = typeof reply?.id === 'string' ? reply.id : ''
      const entry = settle(id)
      // A reply nobody is waiting for (withdrawn, timed out) is dropped; the queue moves on all the same — the in-flight slot was freed at the withdrawal
      entry?.resolve(reply as Record<string, unknown>)
      if (id.startsWith('ping-')) {
        // A ping's reply: this connection has shaken hands, the version is recorded (status() and the internal ping the
        // pump inserts both come through here). A handshake answering with an error envelope (an incompatible helper) or
        // a protocol version that does not match (another helper version installed): everything queued is refused and
        // the port dropped — otherwise the pump would keep inserting pings and keep receiving errors, for ever (Codex on
        // #87). The version enters the OCR cache key: a helper reporting none cannot count as usable, or different builds' results would share one key space (Codex on #87)
        const version = typeof reply?.version === 'string' && reply.version.trim() ? reply.version.trim() : null
        if (reply && !reply.error && reply.v === HELPER_PROTOCOL && version) known = { state: 'ready', version }
        else {
          dropPort()
          const why = reply?.error ? errorOf(reply)?.message : reply?.v !== HELPER_PROTOCOL ? `protocol version ${String(reply?.v)}, the extension needs ${HELPER_PROTOCOL}` : 'the reply carries no version'
          failAll('invalid-response', `helper handshake failed: ${why ?? 'invalid reply'}`)
        }
      } else if (id.startsWith('ocr-') && reply && !reply.error) warmed = true
      pump()
    })
    opened.onDisconnect.addListener(() => {
      const reason = deps.lastError?.()
      if (port !== opened) return
      port = null
      known = null
      if (isMissingHost(reason)) missing = reason ?? 'helper not installed'
      failAll('network', reason ? `helper disconnected: ${reason}` : 'helper disconnected')
    })
    return opened
  }

  const pump = () => {
    while (pending.size < MAX_IN_FLIGHT && queue.length > 0) {
      if (missing) {
        ;(queue.shift() as Queued).reject(new OcrBackendError('network', missing))
        continue
      }
      // A new connection shakes hands first: with the head not a ping and this connection not pinged yet (after a
      // reconnect), an internal ping goes to the head, and the OCR behind it is released once the reply is in (known set). Otherwise a helper of another version would have its results recorded under the old version's cache key
      if (known === null && !(queue[0] as Queued).id.startsWith('ping-')) {
        const id = `ping-${++sequence}`
        queue.unshift({ id, message: { v: HELPER_PROTOCOL, cmd: 'ping', id }, resolve: () => {}, reject: () => {} })
      }
      const item = queue.shift() as Queued
      pending.set(item.id, item)
      const budget = item.id.startsWith('ocr-') && !warmed ? firstOcrTimeoutMs : timeoutMs
      item.timer = setTimeout(() => {
        settle(item.id)?.reject(new OcrBackendError('timeout', `helper did not answer within ${budget} ms`))
        // The helper is still working on the timed-out request: the port is dropped, and the next request starts a fresh process. The handshake itself timing out means the helper cannot start, and the queue is refused with it
        dropPort()
        if (item.id.startsWith('ping-')) failAll('timeout', `helper did not answer the handshake within ${timeoutMs} ms`)
        pump()
      }, budget)
      try {
        ensurePort().postMessage(item.message)
      } catch (e) {
        // connectNative / postMessage threw (permission missing, the port just closed): the port is dropped and everything
        // queued refused — refusing the current one alone, the internal handshake ping failing would make the while insert another ping at once and throw again, a synchronous loop freezing the worker (Codex on #87)
        const message = e instanceof Error ? e.message : String(e)
        settle(item.id)?.reject(new OcrBackendError('network', message))
        dropPort()
        failAll('network', `helper connection failed: ${message}`)
        break
      }
    }
    updateKeepAlive()
  }

  const send = (cmd: string, payload: Record<string, unknown>, scope?: string): Promise<Record<string, unknown>> => {
    if (missing) return Promise.reject(new OcrBackendError('network', missing))
    const id = `${cmd}-${++sequence}`
    return new Promise((resolve, reject) => {
      queue.push({ id, message: { v: HELPER_PROTOCOL, cmd, id, ...payload }, scope, resolve, reject })
      pump()
    })
  }

  return {
    async status(options) {
      if (options?.recheck) missing = null
      // A live handshake proves everything below
      if (known) return known
      // The permission comes before the host: without it nothing can be connected. Without the binding neither —
      // this worker started before the grant, and only a fresh one will have it (helper-restart.ts)
      if (deps.permitted && !(await deps.permitted())) return { state: 'permission-missing' }
      if (deps.bound && !deps.bound()) return { state: 'restarting' }
      if (missing) return { state: 'not-installed', reason: missing }
      try {
        const reply = await send('ping', {})
        const failure = errorOf(reply)
        if (failure) return { state: 'not-installed', reason: failure.message }
        if (reply.v !== HELPER_PROTOCOL) return { state: 'not-installed', reason: `helper protocol ${String(reply.v)}, the extension needs ${HELPER_PROTOCOL}: reinstall the helper` }
        // `known` is set by onMessage from the ping reply; unset means the reply carried no version
        return known ?? { state: 'not-installed', reason: 'the helper reported no version: reinstall it' }
      } catch (e) {
        return { state: 'not-installed', reason: e instanceof Error ? e.message : String(e) }
      }
    },

    async ocr(request, scope) {
      const reply = await send('ocr', { image: request.image, ...(request.langs ? { langs: request.langs } : {}) }, scope)
      const failure = errorOf(reply)
      if (failure) throw failure
      const lines = reply.lines
      if (reply.v !== HELPER_PROTOCOL || !Array.isArray(lines) || typeof reply.width !== 'number' || typeof reply.height !== 'number') {
        throw new OcrBackendError('invalid-response', 'the helper reply lacks lines / width / height')
      }
      const version = known?.state === 'ready' ? known.version : undefined
      if (!version) throw new OcrBackendError('invalid-response', 'a helper reply arrived on a connection that never shook hands')
      return {
        result: {
          width: reply.width, height: reply.height, lines: lines as OcrResult['lines'],
          ...(reply.truncated === true ? { truncated: true } : {}),
          ...(typeof reply.frames === 'number' && reply.frames > 1 ? { frames: reply.frames } : {}),
        },
        version,
      }
    },

    cancel(scope) {
      let cancelled = 0
      for (let i = queue.length - 1; i >= 0; i--) {
        const item = queue[i] as Queued
        if (item.scope !== scope) continue
        queue.splice(i, 1)
        item.reject(new OcrBackendError('aborted', 'session withdrawn'))
        cancelled++
      }
      let inFlight = false
      for (const [id, entry] of pending) {
        if (entry.scope !== scope) continue
        settle(id)?.reject(new OcrBackendError('aborted', 'session withdrawn'))
        cancelled++
        inFlight = true
      }
      // The one withdrawn is the one in flight: the helper is still working on it, and the request moved up would wait
      // behind it for nothing, even time out. Dropping the port makes the helper exit, and the request moved up runs on a fresh connection (Codex on #87)
      if (inFlight) dropPort()
      pump()
      return cancelled
    },
  }
}
