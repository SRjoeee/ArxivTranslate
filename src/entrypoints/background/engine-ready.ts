import type { ChainHolder } from './chain'
import type { SessionRouter } from './sessions'

/**
 * `axt:engine-ready`: an engine became available (a language pack downloaded, §8.5, Codex on #50) or a service
 * was deleted. The chain is rebuilt so the engine takes part — or the service is gone — and the sender decides
 * who moves (Codex on #59 / #157): a downloaded pack moves only the tab the popup promised it to; a deleted
 * service must stop everywhere, so every session moves; anything else rebuilds and leaves the pages on the
 * chains they started on. A passive configuration change never moves anyone (see sessions.ts).
 *
 * Whatever becomes of **this** rebuild, the movers act on the chain in force: a rebuild that fails after a newer
 * one succeeded must not skip the deletion's clean-up, or the deleted service's chain stays alive (the local
 * review of ADR-0005, eighth pass); and this rebuild is not waited for at all — `current()` answers with the
 * build in force and stops waiting for one the moment it is superseded, so a build that never settles cannot
 * hold the clean-up up once another one takes over (tenth pass). `reset` says whether the engine is on the chain
 * in force
 */
export async function engineReady(chain: ChainHolder, router: SessionRouter, message: { id: string; scope?: string; rebindAll?: boolean }): Promise<{ reset: boolean }> {
  void chain.activate().catch(() => undefined)
  try {
    if (message.rebindAll) await router.dropAndRebindAll()
    else if (message.scope) await router.rebind(message.scope)
    const status = await (await chain.current()).status()
    return { reset: status.chain.includes(message.id) }
  } catch {
    return { reset: false }
  }
}
