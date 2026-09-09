// Local OCR helper client (DESIGN §15.2 / §15.4): correlate requests/responses on a Chrome Native Messaging port.
//
// MV3 behavior determines the design:
// - An open port does not prevent idle service-worker shutdown; messages and API calls reset the idle timer. While requests are in flight,
//   periodically call a harmless API; stop when idle. On shutdown the port closes, helper exits on EOF, and onDisconnect invalidates pending work.
//   The next request reconnects and pings again: helper version is part of cache keys and must not be reused after reconnecting.
// - An unregistered host does not make connectNative throw; the port immediately disconnects with "not found" in lastError.
//   Cache unavailability for this worker lifetime to avoid repeated reconnects.
// - The helper uses a sequential stdio loop. Limit in-flight work to one so queued requests remain unsent and can truly be cancelled by scope.
//   Discard the result of an in-flight cancelled request when it arrives.
import type { ProviderErrorKind } from '@/providers/types'
import { HELPER_PROTOCOL, type HelperStatus, type OcrResult } from '@/shared/ocr'

/** Minimal chrome.runtime.connectNative port: only the four members needed, with fake ports for tests. */
export interface NativePort {
  postMessage(message: unknown): void
  onMessage: { addListener(callback: (message: unknown) => void): void }
  onDisconnect: { addListener(callback: () => void): void }
  disconnect(): void
}

export interface HelperClientDeps {
  connect: () => NativePort
  /** Read chrome.runtime.lastError?.message on disconnect. */
  lastError?: () => string | undefined
  /** Per-request timeout; OCR usually takes less than a second per image. */
  timeoutMs?: number
  /** First OCR timeout in this worker: initial Vision model preparation took 26.6s; 30s can falsely declare the helper hung. */
  firstOcrTimeoutMs?: number
  /** Keepalive interval/action while requests are in flight. */
  keepAliveMs?: number
  keepAlive?: () => void
}

export interface HelperClient {
  status(): Promise<HelperStatus>
  /** Recognize an image; version comes from the response connection's handshake for cache keys (helper versions can change on reconnect, Codex #87). */
  ocr(request: { image: string; langs?: string[] }, scope?: string): Promise<{ result: OcrResult; version: string }>
  /** Cancel queued/in-flight requests for a scope; return the number cancelled. */
  cancel(scope: string): number
}

export class HelperError extends Error {
  constructor(readonly kind: ProviderErrorKind, message: string) {
    super(message)
    this.name = 'HelperError'
  }
}

interface Pending {
  scope?: string
  resolve: (reply: Record<string, unknown>) => void
  reject: (error: HelperError) => void
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

/** Detect an uninstalled host from Chrome's disconnect reason, including localized browser messages; no retry is needed. */
function isMissingHost(reason: string | undefined): boolean {
  return /not found|forbidden|not registered|无法找到|找不到/i.test(reason ?? '')
}

export function createHelperClient(deps: HelperClientDeps): HelperClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const firstOcrTimeoutMs = deps.firstOcrTimeoutMs ?? DEFAULT_FIRST_OCR_TIMEOUT_MS
  /** OCR succeeded once in this worker: initial Vision preparation is complete, so use the normal timeout. */
  let warmed = false
  const keepAliveMs = deps.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  let port: NativePort | null = null
  /** Ping result for this connection, invalidated on disconnect. No OCR before handshake; pump inserts a ping at the queue front. */
  let known: HelperStatus | null = null
  /** Host missing: do not reconnect during this worker lifetime. */
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

  const errorOf = (reply: Record<string, unknown>): HelperError | null => {
    const error = reply.error as { code?: unknown; message?: unknown } | undefined
    if (!error) return null
    const kind: ProviderErrorKind = error.code === 'bad-request' || error.code === 'bad-base64' || error.code === 'undecodable-image' ? 'bad-request' : 'invalid-response'
    return new HelperError(kind, `helper: ${typeof error.message === 'string' ? error.message : String(error.code)}`)
  }

  const failAll = (kind: ProviderErrorKind, message: string) => {
    for (const id of Array.from(pending.keys())) settle(id)?.reject(new HelperError(kind, message))
    for (const item of queue.splice(0)) item.reject(new HelperError(kind, message))
    updateKeepAlive()
  }

  /**
   * Discard the current port: helper exits on EOF; the next request starts a new process and handshake. Calling disconnect() does not emit onDisconnect,
   * so clear state here. Used after timeout (the synchronous helper is still processing that request and would block all later work,
   * Codex #87) and handshake failure.
   */
  const dropPort = () => {
    const stale = port
    port = null
    known = null
    try {
      stale?.disconnect()
    } catch {
      // The port may already be disconnected.
    }
  }

  const ensurePort = (): NativePort => {
    if (port) return port
    const opened = deps.connect()
    port = opened
    opened.onMessage.addListener(raw => {
      // Ignore queued Chrome responses from a discarded port (timeout, failed handshake or cancellation).
      // Otherwise stale pings could set known to an old helper version and skip the new connection's handshake (Codex #87).
      if (port !== opened) return
      const reply = raw as Record<string, unknown> | null
      const id = typeof reply?.id === 'string' ? reply.id : ''
      const entry = settle(id)
      // Discard unmatched responses (cancelled/timed out) while advancing the queue; cancellation already freed the in-flight slot.
      entry?.resolve(reply as Record<string, unknown>)
      if (id.startsWith('ping-')) {
        // Ping response: record this connection's handshake/version (both status() and pump's internal ping use this path).
        // Reject all queued work and disconnect if the handshake is an error envelope or has an incompatible protocol version.
        // Otherwise pump would insert pings forever, each receiving another error (Codex #87).
        // Helper version is part of OCR cache keys: missing versions cannot be available, or different builds would share cache keys (Codex #87).
        const version = typeof reply?.version === 'string' && reply.version.trim() ? reply.version.trim() : null
        if (reply && !reply.error && reply.v === HELPER_PROTOCOL && version) known = { available: true, version }
        else {
          dropPort()
          const why = reply?.error ? errorOf(reply)?.message : reply?.v !== HELPER_PROTOCOL ? `Protocol version ${String(reply?.v)}; extension requires ${HELPER_PROTOCOL}` : 'Response has no version'
          failAll('invalid-response', `Helper handshake failed: ${why ?? 'invalid response'}`)
        }
      } else if (id.startsWith('ocr-') && reply && !reply.error) warmed = true
      pump()
    })
    opened.onDisconnect.addListener(() => {
      const reason = deps.lastError?.()
      if (port !== opened) return
      port = null
      known = null
      if (isMissingHost(reason)) missing = reason ?? 'Helper is not installed'
      failAll('network', reason ? `Helper disconnected: ${reason}` : 'Helper disconnected')
    })
    return opened
  }

  const pump = () => {
    while (pending.size < MAX_IN_FLIGHT && queue.length > 0) {
      if (missing) {
        ;(queue.shift() as Queued).reject(new HelperError('network', missing))
        continue
      }
      // Handshake before using a new connection: if the first queued item is not ping and this connection has not been pinged, prepend an internal ping.
      // Release OCR only when known is set; otherwise results from a new helper version would be stored under old-version cache keys.
      if (known === null && !(queue[0] as Queued).id.startsWith('ping-')) {
        const id = `ping-${++sequence}`
        queue.unshift({ id, message: { v: HELPER_PROTOCOL, cmd: 'ping', id }, resolve: () => {}, reject: () => {} })
      }
      const item = queue.shift() as Queued
      pending.set(item.id, item)
      const budget = item.id.startsWith('ocr-') && !warmed ? firstOcrTimeoutMs : timeoutMs
      item.timer = setTimeout(() => {
        settle(item.id)?.reject(new HelperError('timeout', `Helper did not respond within ${budget} ms`))
        // The helper still processes the timed-out request; disconnect to restart for the next one. If handshake times out, reject queued work too.
        dropPort()
        if (item.id.startsWith('ping-')) failAll('timeout', `Helper handshake did not respond within ${timeoutMs} ms`)
        pump()
      }, budget)
      try {
        ensurePort().postMessage(item.message)
      } catch (e) {
        // On connectNative/postMessage errors (missing permissions or recent disconnect), discard the port and reject all queued work.
        // Rejecting only the current internal ping makes the while loop insert another immediately, causing a synchronous infinite loop (Codex #87).
        const message = e instanceof Error ? e.message : String(e)
        settle(item.id)?.reject(new HelperError('network', message))
        dropPort()
        failAll('network', `Helper connection failed: ${message}`)
        break
      }
    }
    updateKeepAlive()
  }

  const send = (cmd: string, payload: Record<string, unknown>, scope?: string): Promise<Record<string, unknown>> => {
    if (missing) return Promise.reject(new HelperError('network', missing))
    const id = `${cmd}-${++sequence}`
    return new Promise((resolve, reject) => {
      queue.push({ id, message: { v: HELPER_PROTOCOL, cmd, id, ...payload }, scope, resolve, reject })
      pump()
    })
  }

  return {
    async status() {
      if (missing) return { available: false, reason: missing }
      if (known) return known
      try {
        const reply = await send('ping', {})
        const failure = errorOf(reply)
        if (failure) return { available: false, reason: failure.message }
        if (reply.v !== HELPER_PROTOCOL) return { available: false, reason: `Helper protocol version ${String(reply.v)}; extension requires ${HELPER_PROTOCOL}. Reinstall the helper.` }
        // onMessage sets known from the ping response; absent means the response omitted its version.
        return known ?? { available: false, reason: 'Helper did not report a version. Reinstall the helper.' }
      } catch (e) {
        return { available: false, reason: e instanceof Error ? e.message : String(e) }
      }
    },

    async ocr(request, scope) {
      const reply = await send('ocr', { image: request.image, ...(request.langs ? { langs: request.langs } : {}) }, scope)
      const failure = errorOf(reply)
      if (failure) throw failure
      const lines = reply.lines
      if (reply.v !== HELPER_PROTOCOL || !Array.isArray(lines) || typeof reply.width !== 'number' || typeof reply.height !== 'number') {
        throw new HelperError('invalid-response', 'Helper response is missing lines / width / height')
      }
      const version = known?.version
      if (!version) throw new HelperError('invalid-response', 'Helper response arrived before this connection completed its handshake')
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
        item.reject(new HelperError('aborted', 'Session cancelled'))
        cancelled++
      }
      let inFlight = false
      for (const [id, entry] of pending) {
        if (entry.scope !== scope) continue
        settle(id)?.reject(new HelperError('aborted', 'Session cancelled'))
        cancelled++
        inFlight = true
      }
      // Cancelling in-flight work leaves the helper processing it; replacement requests would wait behind it and might time out.
      // Discard the port to stop the helper, then run replacements on a new connection (Codex #87).
      if (inFlight) dropPort()
      pump()
      return cancelled
    },
  }
}
