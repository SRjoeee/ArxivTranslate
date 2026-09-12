// 扩展内部消息协议。popup / content / background 之间只允许使用这里定义的类型。
import { browser } from 'wxt/browser'
import type { BlockStats } from '@/core/extractor/stats'
import type { Progress } from '@/core/pipeline/run'
import type { Mode } from '@/core/renderer'
import type { ProviderStatus } from '@/providers/transport'
import type { TranslateCall, TranslateMessageResponse } from '@/providers/translate-service'
import type { HelperStatus, ImageProgress, OcrCall, OcrMessageResponse } from './ocr'

export interface PageStatus {
  /** 当前页面的 arXiv id；不是 arXiv HTML 页面时为 null */
  paper: string | null
  /** 实际生效的模式；窄视口下 side 会自动降级为 stack（§7.2） */
  mode: Mode
  /** 用户选定的模式，自动降级不改它 */
  preference: Mode
  progress: Progress
  /** 图片翻译的进度（§15）；helper 不可用或设置里全关时没有 */
  images?: ImageProgress
  /**
   * 这个页面此刻的会话 id（没在翻时为 null）。
   *
   * background 靠它回答「这个标签页还是不是刚才那个页面」：`tabs.onUpdated` 分不出同文档换 hash
   * 与真的跳走，而页面自己分得出——它还在，就还答得出同一个 id（Codex 在 #143 指出「猜」不能只靠
   * 「目的地会不会再发请求」）
   */
  session?: string | null
  /**
   * The page's action epoch: bumped by every start that commits and every restore. A command carries the epoch it
   * was decided on, and the page refuses one from an earlier epoch — a decision that took a while (the toggle waits
   * for the chain's probes) must not undo what the reader did in between, a translate decided on an idle page that
   * was translated and restored meanwhile included (the local review of INVENTORY S2, sixth and twelfth passes)
   */
  epoch?: number
  /**
   * What the current session runs on: the service chosen when it started, its target language,
   * the service actually serving right now (a hand-over down the chain changes it), and `revision` —
   * `chainRevision` of the configuration the session started on. The popup and the toggle compare
   * it with the saved settings' digest to know when the page is behind them (shared/page-action.ts)
   */
  running?: { provider: string; target: string; engine: string; revision: string }
}

/** 消息表：type → { request, response } */
export interface AxtMessages {
  /**
   * popup → content: start translating the page. `restart` starts a new session over a running one
   * without showing the original first: the settings changed and the page follows them paragraph
   * by paragraph as each is requested again (cached ones at once).
   * `epoch` is the page's action epoch the command was decided on (`PageStatus.epoch`): the page refuses it once the
   * page has moved — the reader restored, restarted or translated meanwhile — so a decision that took a while (the
   * toggle waits for the chain's probes) cannot undo what the reader did in between (sixth and twelfth passes)
   */
  'axt:translate-page': { request: { mode?: Mode; restart?: boolean; epoch?: number }; response: { started: boolean; reason?: string } }
  /** popup → content：中止并恢复原文. `epoch` as above: a restore decided on an earlier epoch is `refused` */
  'axt:restore-page': { request: { epoch?: number }; response: { removedNodes: number; refused?: true } }
  /** popup → content：切换模式（只改 <html> 上的属性，不重新翻译；§4 第 9 步） */
  'axt:set-mode': { request: { mode: Mode }; response: { mode: Mode; preference: Mode } }
  /** popup → content：进度 */
  'axt:page-status': { request: Record<never, never>; response: PageStatus }
  /** popup → background：连通性 */
  'axt:ping': { request: Record<never, never>; response: { ok: true; version: string } }
  /** popup → content script：内存中 Block[] 的统计 */
  'axt:stats': { request: Record<never, never>; response: BlockStats }
  /** content / options → background：翻译一批 segment（§8.0：建链、排队、发请求都在 background） */
  'axt:translate': { request: TranslateCall; response: TranslateMessageResponse }
  /** content → background：撤掉一次会话排队与在飞的请求（恢复原文、重开） */
  'axt:cancel-scope': { request: { scope: string }; response: { cancelled: number } }
  /**
   * popup / options / content → background: what the chain can do and how it is doing.
   *
   * `scope` asks about **that session's own chain**. A page keeps the chain it started on while
   * another tab changes the settings (see sessions.ts), so answering it from the current global
   * chain would describe someone else's (Codex on #157). Without it the answer is the global one,
   * which is what the popup and the settings page want
   */
  /**
   * popup / options / content → background: the chain's status. `scope` asks about the chain a session is on;
   * `fresh` asks for a chain built from the configuration as stored now — what a page sends after saving a
   * setting and before restarting on it (background/provider-status.ts says how the race with the storage event
   * is closed). Both together: a session starting on freshly saved settings is **bound** to that chain, so what it
   * records (target, revision) and what serves its requests are one chain
   */
  'axt:provider-status': { request: { scope?: string; fresh?: boolean }; response: ProviderStatus }
  /** 清空缓存，或只清某篇论文 */
  'axt:cache-clear': { request: { paper?: string }; response: { ok: true; removed: number } | { ok: false; message: string } }
  'axt:cache-stats': { request: Record<never, never>; response: { ok: true; entries: number; bytes: number } | { ok: false; message: string } }
  /** popup → content：把翻失败的块再翻一遍（§7.6） */
  'axt:retry-failed': { request: Record<never, never>; response: { retried: number } }
  /**
   * popup / options → background: something the reader did changed which services can serve
   * (a language pack finished downloading, a service was deleted). Rebuild the chain so later
   * sessions see it.
   *
   * The response arrives **after** the chain has been rebuilt, so a caller that must act on the new
   * configuration can await this instead of polling for a state that may look settled already.
   *
   * Which sessions move onto the new chain is the caller's to say, because only the caller knows
   * what it promised (Codex on #157):
   * - `scope` — that one session. The popup's pack download says "接下来的段落会用离线翻译" about
   *   the tab it is open on, and about no other.
   * - `rebindAll` — every session. Only for a service the reader deleted: it has to stop serving
   *   everywhere, and that outweighs moving an unrelated tab onto another chain.
   * - neither — rebuild only. Later sessions see the new chain; the ones translating keep theirs.
   */
  'axt:engine-ready': { request: { id: string; scope?: string; rebindAll?: boolean }; response: { reset: boolean } }
  /**
   * options / popup / content → background: where the recognition helper stands (DESIGN §15.4's ping, the four
   * states of ADR-0002). `recheck` re-probes a host that was reported missing; see OcrBackend.status
   */
  'axt:helper-status': { request: { recheck?: boolean }; response: HelperStatus }
  /**
   * background → popup / options: the helper's state changed on the background's own initiative — the install wait
   * found it, or the fresh worker after a runtime grant reported (ADR-0002). Pages set what they show from it.
   * Nobody listening is the normal case, so the send may reject
   */
  'axt:helper-state': { request: { status: HelperStatus }; response: undefined }
  /**
   * Sent to every tab when a re-probe finds the helper that was missing. A paper parks its bitmaps
   * when the probe at session start came back empty-handed, and nothing else would ever tell it
   * otherwise: the reader would install the helper, be told it is ready, and watch the open paper
   * stay as it was (Codex on #161)
   */
  'axt:helper-ready': { request: Record<never, never>; response: { resumed: boolean } }
  /**
   * popup / options → background: the reader has copied the install command, so start looking for
   * the helper. Nothing else can tell us it arrived — the script writes a native host manifest to
   * disk and Chrome only reads it when `connectNative` runs (DESIGN §15.4). Without this the
   * reader would have to come back and press a button to ask the question the program can answer
   * itself, and by then the popup that asked is long closed.
   */
  'axt:helper-await': { request: { start?: boolean }; response: { until: number | null } }
  /** content → background：给一张位图做 OCR；结果按 imageHash 缓存（§15.2） */
  'axt:ocr': { request: OcrCall; response: OcrMessageResponse }
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

/**
 * What a handler replies when the work behind a message failed. A handler that returns `true` and never replies
 * leaves the sender waiting for as long as the worker lives — a rejection logged in the background is invisible to
 * the page that asked (the local review of INVENTORY S2, fifth pass). `sendMessage` turns this reply back into a
 * rejection, so a caller's `.catch` sees the failure it would have seen from a local call
 */
export interface FailureReply {
  axtError: string
}

export const failure = (error: unknown): FailureReply => ({ axtError: error instanceof Error ? error.message : String(error) })

export const isFailure = (value: unknown): value is FailureReply =>
  typeof value === 'object' && value !== null && typeof (value as { axtError?: unknown }).axtError === 'string'

/** Reply to a message with the outcome of a promise: the value, or a typed failure the sender rejects on */
export function replyWith<T>(promise: Promise<T>, sendResponse: (reply: T | FailureReply) => void): void {
  promise.then(sendResponse, error => sendResponse(failure(error)))
}

/** The sender's side of `replyWith`: a failure reply becomes a rejection */
export function decodeReply<T>(reply: T | FailureReply): T {
  if (isFailure(reply)) throw new Error(reply.axtError)
  return reply
}

/** 发给 background；MV3 下 sendMessage 不传回调即返回 Promise */
export function sendMessage<T extends AxtMessageType>(message: AxtMessage<T>): Promise<AxtResponse<T>> {
  return (browser.runtime.sendMessage(message) as Promise<AxtResponse<T> | FailureReply>).then(decodeReply)
}

/** 发给当前活动标签页的 content script；标签页上没有接收方时 Promise 会 reject。不读 url，无需 tabs 权限 */
export async function sendToActiveTab<T extends AxtMessageType>(message: AxtMessage<T>): Promise<AxtResponse<T>> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
  if (tab?.id == null) throw new Error('没有活动标签页')
  return browser.tabs.sendMessage(tab.id, message) as Promise<AxtResponse<T>>
}
