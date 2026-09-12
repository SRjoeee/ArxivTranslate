import type { Config } from '@/config/schema'
import { chainConfigChanged, type TranslationTransport } from '@/providers/transport'

export interface Built {
  config: Config
  transport: TranslationTransport
}

export interface ChainHolderDeps {
  /** Build the chain from a configuration, or from the stored one when none is given */
  load: (config?: Config) => Promise<Built>
  /**
   * Whether a session is still on this chain — the router knows. Required: a superseded chain nobody is on and
   * with no call inside is let go, and without this answer a chain with pages on it would be let go too
   */
  owned: (transport: TranslationTransport) => boolean
}

/**
 * The chain in force — one per worker, shared by every tab (§8.2's cross-tab budget). Built lazily: the worker
 * is rebuilt on every wake-up, and probing the engines just to clear a cache is not worth it.
 *
 * Builds overlap: a rebuild can start while another is still probing engines. `current()` therefore answers
 * with the build in force **at the moment it resolves**, not the one in force when it was asked — a mover that
 * awaited a superseded build would move the sessions back onto it and retire the chain actually in force
 * (the local review of ADR-0005, sixth pass)
 */
export interface ChainHolder {
  current(): Promise<TranslationTransport>
  /**
   * Retire every build but the one in force, and forget them. A service was deleted: the sessions have just been
   * moved onto the chain in force by the router, and every other chain — including one only a connection test
   * used, which no session leads to — must refuse whatever wakes or retries inside it (ADR-0005)
   */
  retireOthers(inForce: TranslationTransport): void
  /** Rebuild and make the result the chain in force: the reader's explicit actions (`axt:engine-ready`) */
  activate(config?: Config): Promise<Built>
  /**
   * A configuration change. Only the fields that shape the chain rebuild it: the content script writes the
   * configuration on every display-mode switch, usually while a page is translating, and an indiscriminate
   * rebuild would clear the token bucket and the hand-over records with it (`chainConfigChanged` has the table).
   * A failed build is retried by the next change. Nothing happens before the first build — that one reads the
   * stored configuration itself
   */
  onConfig(next: Config): void
}

export function createChainHolder(deps: ChainHolderDeps): ChainHolder {
  let active: Promise<Built> | null = null
  /**
   * Every chain built and neither retired nor let go: the one in force, the ones sessions are still on, the ones
   * with a call still inside (a connection test in its retry backoff) that nothing else leads to. Superseded
   * chains with none of that are let go at the next `current()` — a worker that lives through many configuration
   * changes must not keep every chain it ever built, with its queues and native translator sessions
   * (the local review of ADR-0005, eighth pass)
   */
  const built = new Set<TranslationTransport>()
  const build = (config?: Config): Promise<Built> =>
    deps.load(config).then(result => {
      built.add(result.transport)
      return result
    })
  const activate = (config?: Config): Promise<Built> => {
    active = build(config)
    return active
  }
  const sweep = (inForce: TranslationTransport): void => {
    for (const transport of built) {
      if (transport === inForce || transport.busy?.() || deps.owned(transport)) continue
      built.delete(transport)
    }
  }
  return {
    activate,
    async current() {
      for (;;) {
        const promise = active ?? activate()
        try {
          const result = await promise
          if (promise === active) {
            sweep(result.transport)
            return result.transport
          }
        } catch (e) {
          // A build that failed after being superseded is nobody's answer; only the one in force may fail the caller
          if (promise === active) throw e
        }
      }
    },
    onConfig(next) {
      if (!active) return
      active = active.then(
        result => (chainConfigChanged(result.config, next) ? build(next) : { config: next, transport: result.transport }),
        () => build(next),
      )
    },
    retireOthers(inForce) {
      for (const transport of built) {
        if (transport === inForce) continue
        transport.retire?.()
        built.delete(transport)
      }
    },
  }
}
