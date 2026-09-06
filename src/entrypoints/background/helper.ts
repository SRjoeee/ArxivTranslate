// 本机 OCR helper 的客户端（DESIGN §15.2 / §15.4）：Chrome Native Messaging 端口上的请求 / 响应关联。
//
// 几条与 MV3 有关的事实决定了形状：
// - 端口开着**不能**阻止 service worker 因闲置被回收；只有消息与 API 调用会重置闲置计时。所以有请求在飞时
//   定时调一个无害的 API 保活，闲下来就停。worker 被回收时端口关闭、helper 收到 EOF 退出、pending 全部
//   随 onDisconnect 作废——下一次请求重新连接、重新 ping（版本进缓存键，重连后不能沿用旧值）。
// - host 没注册时 connectNative 不抛，端口立刻断开并在 lastError 里说 "not found"；这种情况本 worker 生命周期内
//   记为不可用，不再反复重连。
// - helper 是顺序的 stdio 循环，在飞上限设为 1：撤掉一个会话时排队的请求还没写进端口，撤才真能撤掉活；
//   在飞的那一个到达后按已撤处理。
import type { ProviderErrorKind } from '@/providers/types'
import { HELPER_PROTOCOL, type HelperStatus, type OcrResult } from '@/shared/ocr'

/** chrome.runtime.connectNative 返回的端口，只留用到的四个成员，测试用假端口 */
export interface NativePort {
  postMessage(message: unknown): void
  onMessage: { addListener(callback: (message: unknown) => void): void }
  onDisconnect: { addListener(callback: () => void): void }
  disconnect(): void
}

export interface HelperClientDeps {
  connect: () => NativePort
  /** 断开时读 chrome.runtime.lastError?.message */
  lastError?: () => string | undefined
  /** 单个请求的超时；OCR 一张图通常一秒内 */
  timeoutMs?: number
  /** 有请求在飞时的保活间隔与动作 */
  keepAliveMs?: number
  keepAlive?: () => void
}

export interface HelperClient {
  status(): Promise<HelperStatus>
  ocr(request: { image: string; langs?: string[] }, scope?: string): Promise<OcrResult>
  /** 撤掉该 scope 排队与在飞的请求，返回撤掉的条数 */
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
const DEFAULT_KEEP_ALIVE_MS = 20_000
const MAX_IN_FLIGHT = 1

/** 从 Chrome 的断开原因里认出"host 根本没装"：这种不用重试 */
function isMissingHost(reason: string | undefined): boolean {
  return /not found|forbidden|not registered|无法找到|找不到/i.test(reason ?? '')
}

export function createHelperClient(deps: HelperClientDeps): HelperClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const keepAliveMs = deps.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  let port: NativePort | null = null
  /** 本次连接 ping 过的结果；断开就作废 */
  let known: HelperStatus | null = null
  /** host 没装：本 worker 生命周期内不再连 */
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

  const failAll = (kind: ProviderErrorKind, message: string) => {
    for (const id of Array.from(pending.keys())) settle(id)?.reject(new HelperError(kind, message))
    for (const item of queue.splice(0)) item.reject(new HelperError(kind, message))
    updateKeepAlive()
  }

  const ensurePort = (): NativePort => {
    if (port) return port
    const opened = deps.connect()
    port = opened
    opened.onMessage.addListener(raw => {
      const reply = raw as Record<string, unknown> | null
      const id = typeof reply?.id === 'string' ? reply.id : ''
      const entry = settle(id)
      // 对不上号（已撤、已超时）的回应丢弃；但队列照样往前走——在飞的位子早在撤销时就腾出来了
      entry?.resolve(reply as Record<string, unknown>)
      pump()
    })
    opened.onDisconnect.addListener(() => {
      const reason = deps.lastError?.()
      if (port !== opened) return
      port = null
      known = null
      if (isMissingHost(reason)) missing = reason ?? 'helper 未安装'
      failAll('network', reason ? `helper 断开：${reason}` : 'helper 断开')
    })
    return opened
  }

  const pump = () => {
    while (pending.size < MAX_IN_FLIGHT && queue.length > 0) {
      const item = queue.shift() as Queued
      if (missing) {
        item.reject(new HelperError('network', missing))
        continue
      }
      pending.set(item.id, item)
      item.timer = setTimeout(() => {
        settle(item.id)?.reject(new HelperError('timeout', `helper ${timeoutMs} ms 没有回应`))
        pump()
      }, timeoutMs)
      try {
        ensurePort().postMessage(item.message)
      } catch (e) {
        settle(item.id)?.reject(new HelperError('network', e instanceof Error ? e.message : String(e)))
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

  const errorOf = (reply: Record<string, unknown>): HelperError | null => {
    const error = reply.error as { code?: unknown; message?: unknown } | undefined
    if (!error) return null
    const kind: ProviderErrorKind = error.code === 'bad-request' || error.code === 'bad-base64' || error.code === 'undecodable-image' ? 'bad-request' : 'invalid-response'
    return new HelperError(kind, `helper：${typeof error.message === 'string' ? error.message : String(error.code)}`)
  }

  return {
    async status() {
      if (missing) return { available: false, reason: missing }
      if (known) return known
      try {
        const reply = await send('ping', {})
        const failure = errorOf(reply)
        if (failure) return { available: false, reason: failure.message }
        known = { available: true, version: typeof reply.version === 'string' ? reply.version : 'unknown' }
        return known
      } catch (e) {
        return { available: false, reason: e instanceof Error ? e.message : String(e) }
      }
    },

    async ocr(request, scope) {
      const reply = await send('ocr', { image: request.image, ...(request.langs ? { langs: request.langs } : {}) }, scope)
      const failure = errorOf(reply)
      if (failure) throw failure
      const lines = reply.lines
      if (!Array.isArray(lines) || typeof reply.width !== 'number' || typeof reply.height !== 'number') {
        throw new HelperError('invalid-response', 'helper 的回应缺 lines / width / height')
      }
      return { width: reply.width, height: reply.height, lines: lines as OcrResult['lines'] }
    },

    cancel(scope) {
      let cancelled = 0
      for (let i = queue.length - 1; i >= 0; i--) {
        const item = queue[i] as Queued
        if (item.scope !== scope) continue
        queue.splice(i, 1)
        item.reject(new HelperError('aborted', '会话已撤销'))
        cancelled++
      }
      for (const [id, entry] of pending) {
        if (entry.scope !== scope) continue
        // 已经写进端口的那一个：撤不回来，但到达后按已撤处理（settle 找不到它就丢弃）
        settle(id)?.reject(new HelperError('aborted', '会话已撤销'))
        cancelled++
      }
      // 在飞的位子腾出来了，别的 scope 排队的请求顶上（helper 是顺序的，它会先处理完被撤的那个再处理这个）
      pump()
      return cancelled
    },
  }
}
