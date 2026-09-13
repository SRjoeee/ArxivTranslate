// The transport of the content / options side: every method is one message to the background (DESIGN §8.0).
// The chain, the queues and the fetches all live in the background — a content script's request carries the page's
// origin and goes through a CORS preflight, and an https page cannot reach an http endpoint (a local Ollama); measured in RESEARCH §6.7.
import type { TranslationTransport } from '@/providers/transport'
import { sendMessage, type AxtMessage, type AxtMessageType, type AxtResponse } from './messages'

type Send = <T extends AxtMessageType>(message: AxtMessage<T>) => Promise<AxtResponse<T>>

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** send is injectable for tests; runtime messaging by default */
export function createMessageTransport(send: Send = sendMessage): TranslationTransport {
  return {
    // Cut off from the background, a structured error still goes back: run.ts accepts TranslateMessageResponse only, and an exception would turn the whole batch into a crash
    async translate(call) {
      try {
        return await send({ type: 'axt:translate', ...call })
      } catch (e) {
        // With the background unreachable, a smaller batch only repeats the same failure once per segment
        return { ok: false, error: { kind: 'network', message: `cannot reach the extension background: ${reason(e)}`, isolatable: false } }
      }
    },
    // Cancellation is best effort: an in-flight request that cannot be withdrawn is stopped at the receiving end by the content side's session id (run.ts's halted)
    async cancel(scope) {
      try {
        return (await send({ type: 'axt:cancel-scope', scope })).cancelled
      } catch {
        return 0
      }
    },
    status: (scope?: string, options?: { fresh?: boolean }) => send({ type: 'axt:provider-status', ...(scope ? { scope } : {}), ...(options?.fresh ? { fresh: true } : {}) }),
  }
}
