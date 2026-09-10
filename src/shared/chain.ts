// The background rebuilds its service chain from a storage event, which races the messages a page
// sends right after saving (Codex on #157). Anything that must act on the **new** configuration
// waits here first: a named connection test would otherwise reach the old endpoint, and a restart
// would re-translate on the old chain.
import { sendMessage } from './messages'
import type { ProviderStatus } from '@/providers/transport'

const TRIES = 10
const STEP_MS = 100

/**
 * Poll `axt:provider-status` until it reports what was just saved, at most a second; then give up
 * and let the caller proceed, because a chain that never settles is a bug of its own and blocking
 * the reader on it would be worse. Returns the last status seen, so a caller can keep it.
 */
export async function awaitChain(settled: (status: ProviderStatus) => boolean): Promise<ProviderStatus | null> {
  let last: ProviderStatus | null = null
  for (let i = 0; i < TRIES; i++) {
    last = await sendMessage({ type: 'axt:provider-status' }).catch(() => null)
    if (last && settled(last)) return last
    await new Promise(r => setTimeout(r, STEP_MS))
  }
  return last
}
