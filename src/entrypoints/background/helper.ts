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
  /** 本 worker 里**第一次** OCR 的超时：机器上首次跑 Vision 要做一次性模型准备（实测 26.6 s），30 s 会误判 helper 挂了 */
  firstOcrTimeoutMs?: number
  /** 有请求在飞时的保活间隔与动作 */
  keepAliveMs?: number
  keepAlive?: () => void
}

export interface HelperClient {
  status(): Promise<HelperStatus>
  /** 识别；version 是**回应所在连接**握手到的版本，缓存键按它算（重连后 helper 可能换了版本，Codex 在 #87 指出） */
  ocr(request: { image: string; langs?: string[] }, scope?: string): Promise<{ result: OcrResult; version: string }>
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
const DEFAULT_FIRST_OCR_TIMEOUT_MS = 120_000
const DEFAULT_KEEP_ALIVE_MS = 20_000
const MAX_IN_FLIGHT = 1

/** 从 Chrome 的断开原因里认出"host 根本没装"：这种不用重试 */
function isMissingHost(reason: string | undefined): boolean {
  return /not found|forbidden|not registered|无法找到|找不到/i.test(reason ?? '')
}

export function createHelperClient(deps: HelperClientDeps): HelperClient {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const firstOcrTimeoutMs = deps.firstOcrTimeoutMs ?? DEFAULT_FIRST_OCR_TIMEOUT_MS
  /** 本 worker 里成功识别过一次：Vision 的一次性准备已经付过，之后按正常超时 */
  let warmed = false
  const keepAliveMs = deps.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS
  let port: NativePort | null = null
  /** 本次连接 ping 过的结果；断开就作废。没握过手的连接不发 OCR——pump 会先插一个 ping 到队头 */
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

  const errorOf = (reply: Record<string, unknown>): HelperError | null => {
    const error = reply.error as { code?: unknown; message?: unknown } | undefined
    if (!error) return null
    const kind: ProviderErrorKind = error.code === 'bad-request' || error.code === 'bad-base64' || error.code === 'undecodable-image' ? 'bad-request' : 'invalid-response'
    return new HelperError(kind, `helper：${typeof error.message === 'string' ? error.message : String(error.code)}`)
  }

  const failAll = (kind: ProviderErrorKind, message: string) => {
    for (const id of Array.from(pending.keys())) settle(id)?.reject(new HelperError(kind, message))
    for (const item of queue.splice(0)) item.reject(new HelperError(kind, message))
    updateKeepAlive()
  }

  /**
   * 丢掉当前端口：helper 收到 EOF 退出，下一条请求起新进程、重新握手。自己调 disconnect() 不触发 onDisconnect，
   * 状态在这里清。用在超时（helper 是同步循环，超时的那个请求还在它手里，不断开的话后面的全排在后面，
   * Codex 在 #87 指出）与握手失败
   */
  const dropPort = () => {
    const stale = port
    port = null
    known = null
    try {
      stale?.disconnect()
    } catch {
      // 端口可能已经断了
    }
  }

  const ensurePort = (): NativePort => {
    if (port) return port
    const opened = deps.connect()
    port = opened
    opened.onMessage.addListener(raw => {
      // 端口已经被丢掉（超时、握手失败、撤销）：Chrome 里排着的回应还会送到这个监听器，一律忽略——
      // 否则陈旧连接的 ping 回应会把 known 写成旧 helper 的版本，新连接跳过握手（Codex 在 #87 指出）
      if (port !== opened) return
      const reply = raw as Record<string, unknown> | null
      const id = typeof reply?.id === 'string' ? reply.id : ''
      const entry = settle(id)
      // 对不上号（已撤、已超时）的回应丢弃；但队列照样往前走——在飞的位子早在撤销时就腾出来了
      entry?.resolve(reply as Record<string, unknown>)
      if (id.startsWith('ping-')) {
        // ping 的回应：这条连接握过手了，版本记下来（status() 与 pump 插的内部 ping 都走这里）。
        // 握手回的是错误信封（helper 不兼容）或协议版本对不上（装了别的版本的 helper）：排队的活全部拒掉、
        // 断开端口——否则 pump 会一直插 ping、一直收到错误，无限循环（Codex 在 #87 指出）
        // 版本进 OCR 缓存键：没报版本的 helper 不能算可用，否则不同构建的结果共用一个键空间（Codex 在 #87 指出）
        const version = typeof reply?.version === 'string' && reply.version.trim() ? reply.version.trim() : null
        if (reply && !reply.error && reply.v === HELPER_PROTOCOL && version) known = { available: true, version }
        else {
          dropPort()
          const why = reply?.error ? errorOf(reply)?.message : reply?.v !== HELPER_PROTOCOL ? `协议版本 ${String(reply?.v)}，扩展要 ${HELPER_PROTOCOL}` : '回应没有版本号'
          failAll('invalid-response', `helper 握手失败：${why ?? '回应不合法'}`)
        }
      } else if (id.startsWith('ocr-') && reply && !reply.error) warmed = true
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
      if (missing) {
        ;(queue.shift() as Queued).reject(new HelperError('network', missing))
        continue
      }
      // 新连接先握手：队头不是 ping 而这条连接还没 ping 过（断开重连之后），插一个内部 ping 到队头，
      // 回应到了（known 有值）再放行后面的 OCR。否则换了版本的 helper 的结果会记在旧版本的缓存键下
      if (known === null && !(queue[0] as Queued).id.startsWith('ping-')) {
        const id = `ping-${++sequence}`
        queue.unshift({ id, message: { v: HELPER_PROTOCOL, cmd: 'ping', id }, resolve: () => {}, reject: () => {} })
      }
      const item = queue.shift() as Queued
      pending.set(item.id, item)
      const budget = item.id.startsWith('ocr-') && !warmed ? firstOcrTimeoutMs : timeoutMs
      item.timer = setTimeout(() => {
        settle(item.id)?.reject(new HelperError('timeout', `helper ${budget} ms 没有回应`))
        // 超时的请求 helper 还在处理：断开端口，下一条起新进程。握手本身超时说明 helper 起不来，排队的一起拒掉
        dropPort()
        if (item.id.startsWith('ping-')) failAll('timeout', `helper ${timeoutMs} ms 没有回应握手`)
        pump()
      }, budget)
      try {
        ensurePort().postMessage(item.message)
      } catch (e) {
        // connectNative / postMessage 抛错（权限没给、端口刚断）：端口丢掉、排队的全拒——只拒当前这一条的话，
        // 内部握手 ping 失败后 while 会立刻再插一个 ping 再抛，同步死循环卡住 worker（Codex 在 #87 指出）
        const message = e instanceof Error ? e.message : String(e)
        settle(item.id)?.reject(new HelperError('network', message))
        dropPort()
        failAll('network', `helper 连接失败：${message}`)
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
        if (reply.v !== HELPER_PROTOCOL) return { available: false, reason: `helper 协议版本 ${String(reply.v)}，扩展要 ${HELPER_PROTOCOL}，请重新安装 helper` }
        // known 由 onMessage 按 ping 回应记下；没记下就是回应缺版本号
        return known ?? { available: false, reason: 'helper 没有报版本号，请重新安装 helper' }
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
        throw new HelperError('invalid-response', 'helper 的回应缺 lines / width / height')
      }
      const version = known?.version
      if (!version) throw new HelperError('invalid-response', 'helper 的回应到了但这条连接没握过手')
      return { result: { width: reply.width, height: reply.height, lines: lines as OcrResult['lines'], ...(reply.truncated === true ? { truncated: true } : {}) }, version }
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
      let inFlight = false
      for (const [id, entry] of pending) {
        if (entry.scope !== scope) continue
        settle(id)?.reject(new HelperError('aborted', '会话已撤销'))
        cancelled++
        inFlight = true
      }
      // 撤掉的是在飞的那一个：helper 还在处理它，顶上去的请求会排在它后面白等、甚至超时。
      // 端口丢掉让 helper 退出，顶上去的在新连接上跑（Codex 在 #87 指出）
      if (inFlight) dropPort()
      pump()
      return cancelled
    },
  }
}
