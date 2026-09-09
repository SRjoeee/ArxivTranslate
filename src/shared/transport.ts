// Content/options transport: each method sends a message to background (DESIGN §8.0).
// Chain construction, queues and fetch run in background: content requests carry the page origin and require CORS preflight,
// and HTTPS pages cannot reach HTTP endpoints such as local Ollama (RESEARCH §6.7).
import type { TranslationTransport } from '@/providers/transport'
import { sendMessage, type AxtMessage, type AxtMessageType, type AxtResponse } from './messages'

type Send = <T extends AxtMessageType>(message: AxtMessage<T>) => Promise<AxtResponse<T>>

const reason = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Injectable send for tests; runtime messaging by default. */
export function createMessageTransport(send: Send = sendMessage): TranslationTransport {
  return {
    // Return a structured error even when background disconnects: run.ts expects TranslateMessageResponse; throwing crashes the batch.
    async translate(call) {
      try {
        return await send({ type: 'axt:translate', ...call })
      } catch (e) {
        return { ok: false, error: { kind: 'network', message: `Could not communicate with extension background: ${reason(e)}` } }
      }
    },
    // Cancellation is best-effort: content session ids reject uncancelled in-flight results on receipt (run.ts halted).
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
