// 扩展内部消息协议。popup / content / background 之间只允许使用这里定义的类型。
import { browser } from 'wxt/browser'
import type { BlockStats } from '@/core/extractor/stats'

/** 消息表：type → { request, response } */
export interface AxtMessages {
  /** popup → background：连通性 */
  'axt:ping': { request: Record<never, never>; response: { ok: true; version: string } }
  /** popup → content script：内存中 Block[] 的统计 */
  'axt:stats': { request: Record<never, never>; response: BlockStats }
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

/** 发给当前活动标签页的 content script；标签页上没有接收方时 Promise 会 reject。不读 url，无需 tabs 权限 */
export async function sendToActiveTab<T extends AxtMessageType>(message: AxtMessage<T>): Promise<AxtResponse<T>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id == null) throw new Error('没有活动标签页')
  return browser.tabs.sendMessage(tab.id, message) as Promise<AxtResponse<T>>
}
