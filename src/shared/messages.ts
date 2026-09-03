// 扩展内部消息协议。popup / content / background 之间只允许使用这里定义的类型。
import { browser } from 'wxt/browser'

/** 消息表：type → { request, response }。后续分支往这里加 'axt:stats' 等 */
export interface AxtMessages {
  'axt:ping': { request: Record<never, never>; response: { ok: true; version: string } }
}

export type AxtMessageType = keyof AxtMessages
export type AxtMessage<T extends AxtMessageType = AxtMessageType> = { type: T } & AxtMessages[T]['request']
export type AxtResponse<T extends AxtMessageType> = AxtMessages[T]['response']

export function isAxtMessage(value: unknown): value is AxtMessage {
  return typeof value === 'object' && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && (value as { type: string }).type.startsWith('axt:')
}

/** 发给 background；MV3 下 sendMessage 不传回调即返回 Promise */
export function sendMessage<T extends AxtMessageType>(message: AxtMessage<T>): Promise<AxtResponse<T>> {
  return browser.runtime.sendMessage(message) as Promise<AxtResponse<T>>
}
