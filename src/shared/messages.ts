// Internal extension message protocol. Popup/content/background may use only the types defined here.
import { browser } from 'wxt/browser'
import type { BlockStats } from '@/core/extractor/stats'
import type { Progress } from '@/core/pipeline/run'
import type { Mode } from '@/core/renderer'
import type { ProviderStatus } from '@/providers/transport'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import type { HelperStatus, ImageProgress, OcrCall, OcrMessageResponse } from './ocr'

export interface PageStatus {
  /** Current arXiv paper id; null outside arXiv HTML pages. */
  paper: string | null
  /** Effective mode; side automatically falls back to stack in narrow viewports (§7.2). */
  mode: Mode
  /** User-selected mode, unaffected by automatic fallback. */
  preference: Mode
  progress: Progress
  /** Image translation progress (§15); absent when the helper is unavailable or all modes are disabled. */
  images?: ImageProgress
}

/** Message map: type → { request, response }. */
export interface AxtMessages {
  /** popup → content: start translating the current page. */
  'axt:translate-page': { request: { mode?: Mode }; response: { started: boolean; reason?: string } }
  /** popup → content: abort and restore the original. */
  'axt:restore-page': { request: Record<never, never>; response: { removedNodes: number } }
  /** popup → content: switch mode via <html> attributes, without translating again (§4, step 9). */
  'axt:set-mode': { request: { mode: Mode }; response: { mode: Mode; preference: Mode } }
  /** popup → content: progress. */
  'axt:page-status': { request: Record<never, never>; response: PageStatus }
  /** popup → background: connectivity. */
  'axt:ping': { request: Record<never, never>; response: { ok: true; version: string } }
  /** popup → content: statistics from the in-memory Block[]. */
  'axt:stats': { request: Record<never, never>; response: BlockStats }
  /** content/options → background: translate a segment batch (§8.0: chain, queues and requests all run in background). */
  'axt:translate': { request: TranslateCall; response: TranslateMessageResponse }
  /** content → background: cancel queued/in-flight session requests on restore or restart. */
  'axt:cancel-scope': { request: { scope: string }; response: { cancelled: number } }
  /** popup/options/content → background: engine-chain capabilities and live status. */
  'axt:provider-status': { request: Record<never, never>; response: ProviderStatus }
  /** Clear all cache entries or one paper. */
  'axt:cache-clear': { request: { paper?: string }; response: { ok: true; removed: number } | { ok: false; message: string } }
  'axt:cache-stats': { request: Record<never, never>; response: { ok: true; entries: number; bytes: number } | { ok: false; message: string } }
  /** popup → content: retry failed blocks (§7.6). */
  'axt:retry-failed': { request: Record<never, never>; response: { retried: number } }
  /** popup → background: an engine became ready (language pack downloaded); rebuild the chain to include it (§8.5). */
  'axt:engine-ready': { request: { id: string }; response: { reset: boolean } }
  /** options/content → background: local OCR helper availability (DESIGN §15.4 ping check). */
  'axt:helper-status': { request: Record<never, never>; response: HelperStatus }
  /** content → background: OCR one bitmap; cache by imageHash (§15.2). */
  'axt:ocr': { request: OcrCall; response: OcrMessageResponse }
}

export type AxtMessageType = keyof AxtMessages
/** Distributive conditional type lets switch(message.type) narrow to the matching request shape. */
export type AxtMessage<T extends AxtMessageType = AxtMessageType> = T extends unknown ? { type: T } & AxtMessages[T]['request'] : never
export type AxtResponse<T extends AxtMessageType> = AxtMessages[T]['response']

export function isAxtMessage(value: unknown): value is AxtMessage {
  return typeof value === 'object' && value !== null
    && typeof (value as { type?: unknown }).type === 'string'
    && (value as { type: string }).type.startsWith('axt:')
}

/** Send to background; MV3 sendMessage without a callback returns a Promise. */
export function sendMessage<T extends AxtMessageType>(message: AxtMessage<T>): Promise<AxtResponse<T>> {
  return browser.runtime.sendMessage(message) as Promise<AxtResponse<T>>
}

/** Send to the active tab's content script; rejects if no receiver exists. Does not read URL, so no tabs permission is needed. */
export async function sendToActiveTab<T extends AxtMessageType>(message: AxtMessage<T>): Promise<AxtResponse<T>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id == null) throw new Error('No active tab')
  return browser.tabs.sendMessage(tab.id, message) as Promise<AxtResponse<T>>
}
