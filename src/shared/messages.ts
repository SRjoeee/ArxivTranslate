// 扩展内部消息协议。popup / content / background 之间只允许使用这里定义的类型。
import { browser } from 'wxt/browser'
import type { BlockStats } from '@/core/extractor/stats'
import type { Progress } from '@/core/pipeline/run'
import type { Mode } from '@/core/renderer'
import type { ProviderStatus, TranslateMessageRequest, TranslateMessageResponse } from '@/entrypoints/background/translate-handler'

export interface PageStatus {
  /** 当前页面的 arXiv id；不是 arXiv HTML 页面时为 null */
  paper: string | null
  /** 实际生效的模式；窄视口下 side 会自动降级为 stack（§7.2） */
  mode: Mode
  /** 用户选定的模式，自动降级不改它 */
  preference: Mode
  progress: Progress
}

/** 消息表：type → { request, response } */
export interface AxtMessages {
  /** popup → content：开始翻译当前页面 */
  'axt:translate-page': { request: { mode?: Mode }; response: { started: boolean; reason?: string } }
  /** popup → content：中止并恢复原文 */
  'axt:restore-page': { request: Record<never, never>; response: { removedNodes: number } }
  /** popup → content：切换模式（只改 <html> 上的属性，不重新翻译；§4 第 9 步） */
  'axt:set-mode': { request: { mode: Mode }; response: { mode: Mode; preference: Mode } }
  /** popup → content：进度 */
  'axt:page-status': { request: Record<never, never>; response: PageStatus }
  /** popup → background：连通性 */
  'axt:ping': { request: Record<never, never>; response: { ok: true; version: string } }
  /** popup → content script：内存中 Block[] 的统计 */
  'axt:stats': { request: Record<never, never>; response: BlockStats }
  /** content / options → background：翻译一批 segment */
  'axt:translate': { request: TranslateMessageRequest; response: TranslateMessageResponse }
  /** popup / options → background：当前 provider 是否可用 */
  'axt:provider-status': { request: Record<never, never>; response: ProviderStatus }
  /** 清空缓存，或只清某篇论文 */
  /** content → background：批量查缓存（§8.0，provider 请求不经过 background，只有缓存走消息） */
  'axt:cache-get': { request: { keys: string[] }; response: { hits: (string | null)[] } }
  /** content → background：批量写缓存；调用方不等结果 */
  'axt:cache-put': { request: { entries: { key: string; translation: string; paper: string }[] }; response: { written: number } }
  'axt:cache-clear': { request: { paper?: string }; response: { removed: number } }
  'axt:cache-stats': { request: Record<never, never>; response: { entries: number; bytes: number } }
}

export type AxtMessageType = keyof AxtMessages
/** 分配式条件类型：让 switch (message.type) 能按 type 收窄到对应的 request 形状 */
export type AxtMessage<T extends AxtMessageType = AxtMessageType> = T extends unknown ? { type: T } & AxtMessages[T]['request'] : never
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
