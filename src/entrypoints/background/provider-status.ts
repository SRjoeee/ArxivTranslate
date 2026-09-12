import type { Config } from '@/config/schema'
import type { ProviderStatus } from '@/providers/transport'
import type { ChainHolder } from './chain'
import type { SessionRouter } from './sessions'

/**
 * Every offer of the stored configuration to the chain holder goes through here, one read at a time. Two sources
 * offer: the storage watcher on every change, and `axt:provider-status { fresh }` right after a save. Neither reads
 * a value out of an event — a storage event carries no order, and two quick saves deliver two events whose first
 * can arrive after the second save was read and offered, which would build the older chain on top of the newer
 * (Codex on #182). Reading the store at offer time, in sequence, gives every offer the store as it stood when its
 * turn came: no offer is older than the one before it, and an offer made after a save carries that save
 */
export interface ConfigOffers {
  /** Read the stored configuration and offer it; resolves once the holder has it. A failed read offers nothing */
  offer(): Promise<void>
}

export function createConfigOffers(deps: { load: () => Promise<Config>; chain: Pick<ChainHolder, 'onConfig'> }): ConfigOffers {
  let queue: Promise<void> = Promise.resolve()
  return {
    offer() {
      queue = queue.then(() => deps.load()).then(config => deps.chain.onConfig(config), () => undefined)
      return queue
    },
  }
}

/** How long the status of the chain in force may take altogether; a probe that stalls for longer answers nobody */
export const STATUS_DEADLINE_MS = 5_000

/**
 * The status of the chain in force — still in force once the status has come back. `status()` waits for the
 * engines' availability probes, and a configuration change can replace the chain meanwhile; the answer would then
 * describe a superseded chain, and a decision made on it would be the previous settings' (the local review of
 * INVENTORY S2, third pass). Re-asked until the chain that answered is the one in force. A probe is not waited for
 * past its chain's replacement — a stalled native probe on a chain nobody wants any more must not hold the toggle
 * (fourth pass) — nor past the deadline, which rejects: an obsolete status is not an answer, and the callers treat
 * "unknown" as they did before there was a status to ask
 */
export async function statusInForce(chain: Pick<ChainHolder, 'current' | 'replaced'>, deadlineMs = STATUS_DEADLINE_MS): Promise<ProviderStatus> {
  let expire: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    expire = setTimeout(() => reject(new Error(`the chain's status did not settle within ${deadlineMs} ms`)), deadlineMs)
  })
  try {
    for (;;) {
      const transport = await Promise.race([chain.current(), deadline])
      const status = await Promise.race([transport.status(), chain.replaced().then(() => null), deadline])
      if (status === null) continue
      if ((await Promise.race([chain.current(), deadline])) === transport) return status
    }
  } finally {
    clearTimeout(expire)
  }
}

export interface ProviderStatusDeps {
  chain: Pick<ChainHolder, 'current' | 'replaced'>
  router: Pick<SessionRouter, 'transportFor'>
  offers: ConfigOffers
}

/**
 * `axt:provider-status`. A page asking about its own session gets its session's chain; everyone else the chain in
 * force. `fresh` — what the popup sends right after saving a setting, before restarting the page on it — makes the
 * answer come from a chain built from what is stored **now**: the save is committed before the page asks, but the
 * storage event that rebuilds the chain races the page's message (Codex on #157), so the handler offers the stored
 * configuration itself (`ConfigOffers`, in order with the watcher's). An offer that matches what the chain was last
 * built from starts nothing (`onConfig` compares the chain fields); `current()` waits for the build in force to land.
 * Until INVENTORY P4 the popup polled this message ten times, comparing a field of its own choosing each time
 */
export async function providerStatus(deps: ProviderStatusDeps, message: { scope?: string; fresh?: boolean }): Promise<ProviderStatus> {
  if (message.fresh) await deps.offers.offer()
  const own = !message.fresh && message.scope ? deps.router.transportFor(message.scope) : undefined
  return own ? own.status() : statusInForce(deps.chain)
}
