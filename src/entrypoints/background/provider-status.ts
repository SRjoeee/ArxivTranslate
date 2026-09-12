import type { Config } from '@/config/schema'
import type { ProviderStatus } from '@/providers/transport'
import type { ChainHolder } from './chain'
import type { SessionRouter } from './sessions'

export interface ProviderStatusDeps {
  chain: Pick<ChainHolder, 'current' | 'onConfig'>
  router: Pick<SessionRouter, 'transportFor'>
  /** The stored configuration, as the pages saved it */
  loadConfig: () => Promise<Config>
}

/**
 * `axt:provider-status`. A page asking about its own session gets its session's chain; everyone else the chain in
 * force. `fresh` — what the popup sends right after saving a setting, before restarting the page on it — makes the
 * answer come from a chain built from what is stored **now**: the save is committed before the page asks, but the
 * storage event that rebuilds the chain races the page's message (Codex on #157), so the handler reads the
 * configuration itself and offers it to the holder. An offer that matches what the chain was last built from
 * starts nothing (`onConfig` compares the chain fields), and `current()` waits for the build in force to land.
 * Until INVENTORY P4 the popup polled this message ten times, comparing a field of its own choosing each time
 */
export async function providerStatus(deps: ProviderStatusDeps, message: { scope?: string; fresh?: boolean }): Promise<ProviderStatus> {
  if (message.fresh) deps.chain.onConfig(await deps.loadConfig())
  const transport = (!message.fresh && message.scope && deps.router.transportFor(message.scope)) || await deps.chain.current()
  return transport.status()
}
