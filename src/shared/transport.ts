// content / options 侧的 transport：每个方法是一条发给 background 的消息（DESIGN §8.0）。
// 真正的建链、排队与 fetch 都在 background——content script 的请求带页面 origin、走 CORS 预检，
// 而且 https 页面够不着 http 端点（本地 Ollama），实测见 RESEARCH §6.7。
import type { TranslationTransport } from '@/providers/transport'
import { sendMessage, type AxtMessage, type AxtMessageType, type AxtResponse } from './messages'

type Send = <T extends AxtMessageType>(message: AxtMessage<T>) => Promise<AxtResponse<T>>

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** send 可注入，便于测试；默认走 runtime 消息 */
export function createMessageTransport(send: Send = sendMessage): TranslationTransport {
  return {
    // 与 background 断了也要给出结构化错误：run.ts 只认 TranslateMessageResponse，抛异常会把整批打成崩溃
    async translate(call) {
      try {
        return await send({ type: 'axt:translate', ...call })
      } catch (e) {
        return { ok: false, error: { kind: 'network', message: `无法与扩展后台通信：${reason(e)}` } }
      }
    },
    // 取消是尽力而为：撤不掉的在飞请求由 content 侧的会话 id 在接收处挡掉（run.ts 的 halted）
    async cancel(scope) {
      try {
        return (await send({ type: 'axt:cancel-scope', scope })).cancelled
      } catch {
        return 0
      }
    },
    status: () => send({ type: 'axt:provider-status' }),
  }
}
