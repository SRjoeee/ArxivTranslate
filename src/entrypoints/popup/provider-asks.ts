// The popup's two provider-status asks (data.ts says why there are two) and the bookkeeping that keeps their answers
// honest: answers come back in any order, and a stale one must not undo a newer, settle a newer ask's marker, or hold
// the session's polling for good.
import type { ProviderStatus } from '@/providers/transport'
import type { AxtMessage } from '@/shared/messages'

/**
 * How long a session ask is waited for before the next poll asks again. The background gives the chain in force this
 * long to settle (provider-status.ts, `STATUS_DEADLINE_MS`); a session's own chain has no deadline there, and a probe
 * that stalls inside it would otherwise hold this popup's polling — the engine shown, the hand-over warning — for as
 * long as the popup stays open (the local review of S1, third pass)
 */
export const SESSION_ASK_TTL_MS = 5_000

export interface ProviderAsks {
  /**
   * The saved settings' chain, built from what is stored now — every ask carries the `fresh` barrier: an ask without it,
   * made while one with it waited on its read, would answer first from the previous chain and, as the newer ask, keep
   * the answer (the local review of S1, sixth and eighth passes). Only the newest ask publishes: a stale answer would
   * undo a newer
   */
  saved(): Promise<void>
  /**
   * The running session's own chain. Polls of one session are coalesced — one ask in flight; a generation bumped by
   * every 500 ms tick would invalidate each answer slower than a tick (Codex on #185) — and given up on after the
   * ttl: the next poll asks again, and the answer to an ask given up on neither publishes nor settles its successor
   */
  session(scope: string): Promise<void>
}

export interface ProviderAskDeps {
  send(message: AxtMessage<'axt:provider-status'>): Promise<ProviderStatus>
  publishSaved(status: ProviderStatus | null): void
  /** The session's answer with the session it is for: the caller knows whether the page still reports that one */
  publishSession(scope: string, status: ProviderStatus | null): void
  ttlMs?: number
  now?: () => number
}

export function createProviderAsks(deps: ProviderAskDeps): ProviderAsks {
  const ttl = deps.ttlMs ?? SESSION_ASK_TTL_MS
  const now = deps.now ?? Date.now
  let savedAsks = 0
  let tokens = 0
  let inFlight: { scope: string; token: number; since: number } | null = null
  return {
    saved() {
      const ask = ++savedAsks
      return deps.send({ type: 'axt:provider-status', fresh: true })
        .then(status => { if (ask === savedAsks) deps.publishSaved(status) })
        .catch(() => { if (ask === savedAsks) deps.publishSaved(null) })
    },
    session(scope) {
      if (inFlight?.scope === scope && now() - inFlight.since < ttl) return Promise.resolve()
      const token = ++tokens
      inFlight = { scope, token, since: now() }
      // Only the ask still in flight settles the marker and publishes; one given up on came back too late for both
      const done = (status: ProviderStatus | null) => {
        if (inFlight?.token !== token) return
        inFlight = null
        deps.publishSession(scope, status)
      }
      return deps.send({ type: 'axt:provider-status', scope }).then(done, () => done(null))
    },
  }
}
